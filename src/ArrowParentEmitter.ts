import { PROTOCOL_VERSION, State, MessageType } from './constants';
import type { StateValue, StateChangeCallback, ErrorCallback, ReadyCallback, SendOptions, AckResult, PendingAck } from './types';
import { BridgeUtils } from './utils';
import { MessageManager } from './MessageManager';
import type { ParentEmitterConfig } from './types';

export class ArrowParentEmitter {
  private iframe: HTMLIFrameElement;
  private state: StateValue;
  private config: Required<ParentEmitterConfig>;
  private sabSupported: boolean;
  private messageManager: MessageManager;
  private pendingAcks = new Map<string, PendingAck>();
  private handshakeTimeout: ReturnType<typeof setTimeout> | null = null;

  private onReadyCallback: ReadyCallback | null = null;
  private onStateChangeCallback: StateChangeCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;

  constructor(iframeElement: HTMLIFrameElement, config: ParentEmitterConfig = {}) {
    if (!iframeElement || !(iframeElement instanceof HTMLIFrameElement)) {
      throw new Error('iframeElement must be a valid HTMLIFrameElement');
    }

    this.iframe = iframeElement;
    this.state = State.INIT;
    this.config = {
      handshakeTimeout: config.handshakeTimeout ?? 5000,
      ackTimeout: config.ackTimeout ?? 3000,
      retryAttempts: config.retryAttempts ?? 0,
      sourceId: config.sourceId ?? `parent-${BridgeUtils.generateUUID().slice(0, 8)}`,
      allowedOrigins: config.allowedOrigins ?? ['*'],
      compression: config.compression ?? false,
    };

    this.sabSupported = BridgeUtils.checkSABSupport();
    this.messageManager = new MessageManager();

    this._changeState(State.CONNECTING);
    this._initMessageListener();
    this._startHandshake();
    this.messageManager.startAutoCleanup();
  }

  private _changeState(newState: StateValue): void {
    const oldState = this.state;
    this.state = newState;
    if (this.onStateChangeCallback && oldState !== newState) {
      this.onStateChangeCallback(newState, oldState);
    }
  }

  private _isOriginAllowed(origin: string): boolean {
    if (this.config.allowedOrigins.includes('*')) return true;
    return this.config.allowedOrigins.includes(origin);
  }

  private _startHandshake(): void {
    this.handshakeTimeout = setTimeout(() => {
      if (this.state !== State.READY) {
        this._changeState(State.ERROR);
        this.onErrorCallback?.(new Error('Handshake timeout'));
      }
    }, this.config.handshakeTimeout);
  }

  private _initMessageListener(): void {
    window.addEventListener('message', (event: MessageEvent) => {
      if (!this._isOriginAllowed(event.origin)) return;

      const { type, protocolVersion, messageId, success, error, format, rows, cols, processingTime, isZeroCopy } =
        event.data as Record<string, unknown>;

      if (protocolVersion && !BridgeUtils.isVersionCompatible(String(protocolVersion))) {
        this.onErrorCallback?.(
          new Error(`Protocol version mismatch: ${protocolVersion} vs ${PROTOCOL_VERSION}`)
        );
        return;
      }

      if (type === MessageType.CHILD_READY) {
        if (this.handshakeTimeout) {
          clearTimeout(this.handshakeTimeout);
          this.handshakeTimeout = null;
        }
        this._sendMessage(MessageType.PARENT_ACK, {});
        this._changeState(State.READY);
        this.onReadyCallback?.();
      }

      if (type === MessageType.DATA_RECEIVED) {
        const pending = this.pendingAcks.get(String(messageId));
        if (pending) {
          clearTimeout(pending.timeout);
          if (success) {
            pending.resolve({ success: true, format: String(format), rows: Number(rows), cols: Number(cols), processingTime: Number(processingTime), isZeroCopy: Boolean(isZeroCopy) });
          } else {
            pending.reject(new Error(String(error ?? 'Unknown error')));
          }
          this.pendingAcks.delete(String(messageId));
        }
      }
    });
  }

  private _sendMessage(type: string, payload: Record<string, unknown>, options: SendOptions = {}): string {
    const message = {
      type,
      protocolVersion: PROTOCOL_VERSION,
      messageId: options.messageId ?? BridgeUtils.generateUUID(),
      timestamp: BridgeUtils.now(),
      source: this.config.sourceId,
      correlationId: options.correlationId ?? null,
      priority: options.priority ?? 0,
      ttl: options.ttl ?? null,
      compressed: options.compressed ?? false,
      ...payload,
    };

    this.iframe.contentWindow!.postMessage(message, '*');
    return message.messageId;
  }

  private _waitForAck(messageId: string): Promise<AckResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(messageId);
        reject(new Error('ACK timeout'));
      }, this.config.ackTimeout);

      this.pendingAcks.set(messageId, { resolve, reject, timeout });
    });
  }

  async sendArrowZeroCopy(arrowBuffer: Uint8Array, options: SendOptions = {}): Promise<AckResult> {
    if (this.state !== State.READY) throw new Error('Parent not ready - current state: ' + this.state);
    if (!this.sabSupported) throw new Error('SharedArrayBuffer not supported - use sendArrowCopy instead');
    if (!(arrowBuffer instanceof Uint8Array)) throw new Error('arrowBuffer must be a Uint8Array');

    this._changeState(State.SENDING);
    try {
      const sharedBuffer = new SharedArrayBuffer(arrowBuffer.length);
      new Uint8Array(sharedBuffer).set(arrowBuffer);

      const messageId = this._sendMessage(MessageType.DATA_TRANSFER, {
        format: 'arrow-zerocopy',
        sharedBuffer,
        offset: 0,
        length: arrowBuffer.length,
        schema: options.schema ?? null,
      }, options);

      this._changeState(State.READY);
      return this._waitForAck(messageId);
    } catch (error) {
      this._changeState(State.ERROR);
      throw error;
    }
  }

  async sendArrowCopy(arrowBuffer: Uint8Array, options: SendOptions = {}): Promise<AckResult> {
    if (this.state !== State.READY) throw new Error('Parent not ready - current state: ' + this.state);
    if (!(arrowBuffer instanceof Uint8Array)) throw new Error('arrowBuffer must be a Uint8Array');

    this._changeState(State.SENDING);
    try {
      let data: unknown = arrowBuffer;
      let compressed = false;

      if (this.config.compression && options.compress !== false) {
        data = await BridgeUtils.compress(arrowBuffer);
        compressed = true;
      }

      const messageId = this._sendMessage(MessageType.DATA_TRANSFER, {
        format: 'arrow-copy',
        data,
        compressed,
        schema: options.schema ?? null,
      }, { ...options, compressed });

      this._changeState(State.READY);
      return this._waitForAck(messageId);
    } catch (error) {
      this._changeState(State.ERROR);
      throw error;
    }
  }

  async sendJSON(jsonData: unknown, options: SendOptions = {}): Promise<AckResult> {
    if (this.state !== State.READY) throw new Error('Parent not ready - current state: ' + this.state);

    this._changeState(State.SENDING);
    try {
      let data: unknown = jsonData;
      let compressed = false;

      if (this.config.compression && options.compress !== false) {
        data = await BridgeUtils.compress(JSON.stringify(jsonData));
        compressed = true;
      }

      const messageId = this._sendMessage(MessageType.DATA_TRANSFER, {
        format: 'json',
        data,
        compressed,
      }, { ...options, compressed });

      this._changeState(State.READY);
      return this._waitForAck(messageId);
    } catch (error) {
      this._changeState(State.ERROR);
      throw error;
    }
  }

  async send(data: Uint8Array | unknown, options: SendOptions = {}): Promise<AckResult> {
    const format = options.format ?? 'auto';

    if (format === 'auto') {
      if (data instanceof Uint8Array && this.sabSupported) return this.sendArrowZeroCopy(data, options);
      if (data instanceof Uint8Array) return this.sendArrowCopy(data, options);
      return this.sendJSON(data, options);
    }
    if (format === 'arrow-zerocopy') return this.sendArrowZeroCopy(data as Uint8Array, options);
    if (format === 'arrow-copy') return this.sendArrowCopy(data as Uint8Array, options);
    if (format === 'json') return this.sendJSON(data, options);
    throw new Error('Unknown format: ' + format);
  }

  onReady(callback: ReadyCallback): this {
    this.onReadyCallback = callback;
    return this;
  }

  onStateChange(callback: StateChangeCallback): this {
    this.onStateChangeCallback = callback;
    return this;
  }

  onError(callback: ErrorCallback): this {
    this.onErrorCallback = callback;
    return this;
  }

  isReady(): boolean {
    return this.state === State.READY;
  }

  isSABSupported(): boolean {
    return this.sabSupported;
  }

  getState(): StateValue {
    return this.state;
  }

  close(): void {
    if (this.handshakeTimeout) {
      clearTimeout(this.handshakeTimeout);
      this.handshakeTimeout = null;
    }
    for (const [, pending] of this.pendingAcks.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Connection closed'));
    }
    this._changeState(State.CLOSED);
    this.messageManager.reset();
    this.pendingAcks.clear();
  }
}
