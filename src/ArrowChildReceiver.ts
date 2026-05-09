import { tableFromIPC } from 'apache-arrow';
import { PROTOCOL_VERSION, State, ListenMode, MessageType } from './constants';
import type { StateValue, ListenModeValue, StateChangeCallback, ErrorCallback, DataCallback, DataResult, ChildReceiverConfig } from './types';
import { BridgeUtils } from './utils';
import { MessageManager } from './MessageManager';
import { MessageBuffer } from './MessageBuffer';

export class ArrowChildReceiver {
  private state: StateValue;
  private config: Required<ChildReceiverConfig>;
  private messageManager: MessageManager;
  private messageBuffer: MessageBuffer<Record<string, unknown>>;
  private listenActive = true;
  private processingDelayTimeout: ReturnType<typeof setTimeout> | null = null;

  private onDataCallback: DataCallback | null = null;
  private onStateChangeCallback: StateChangeCallback | null = null;
  private onErrorCallback: ErrorCallback | null = null;

  constructor(config: ChildReceiverConfig = {}) {
    this.state = State.INIT;
    this.config = {
      listenMode: config.listenMode ?? ListenMode.CONTINUOUS,
      listenDelay: config.listenDelay ?? 0,
      sourceId: config.sourceId ?? `child-${BridgeUtils.generateUUID().slice(0, 8)}`,
      allowedOrigins: config.allowedOrigins ?? ['*'],
      compression: config.compression ?? false,
    };

    this.messageManager = new MessageManager();
    this.messageBuffer = new MessageBuffer();

    this._changeState(State.CONNECTING);
    this._initMessageListener();
    this._initHandshake();
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

  private _initHandshake(): void {
    this._sendMessage(MessageType.CHILD_READY, {});
  }

  private _sendMessage(type: string, payload: Record<string, unknown>, options: { messageId?: string; correlationId?: string | null } = {}): string {
    const message = {
      type,
      protocolVersion: PROTOCOL_VERSION,
      messageId: options.messageId ?? BridgeUtils.generateUUID(),
      timestamp: BridgeUtils.now(),
      source: this.config.sourceId,
      correlationId: options.correlationId ?? null,
      ...payload,
    };

    window.parent.postMessage(message, '*');
    return message.messageId;
  }

  private _initMessageListener(): void {
    window.addEventListener('message', async (event: MessageEvent) => {
      if (!this._isOriginAllowed(event.origin)) return;

      const { type, protocolVersion, messageId, timestamp, ttl } = event.data as Record<string, unknown>;

      if (protocolVersion && !BridgeUtils.isVersionCompatible(String(protocolVersion))) {
        this.onErrorCallback?.(
          new Error(`Protocol version mismatch: ${protocolVersion} vs ${PROTOCOL_VERSION}`)
        );
        return;
      }

      if (type === MessageType.PARENT_ACK) {
        this._changeState(State.READY);
      }

      if (type === MessageType.DATA_TRANSFER) {
        if (BridgeUtils.isExpired(Number(timestamp), ttl as number | null)) return;
        if (this.messageManager.hasProcessed(String(messageId))) return;
        if (!this.listenActive) return;

        this.messageManager.markProcessed(String(messageId));

        if (this.config.listenMode === ListenMode.FIRST_MESSAGE) {
          await this._processMessage(event.data as Record<string, unknown>);
          this.listenActive = false;
        } else {
          this.messageBuffer.push(event.data as Record<string, unknown>);

          if (this.processingDelayTimeout) {
            clearTimeout(this.processingDelayTimeout);
          }

          if (this.config.listenDelay > 0) {
            this.processingDelayTimeout = setTimeout(() => {
              void this._processBufferedMessage();
              this.processingDelayTimeout = null;
            }, this.config.listenDelay);
          } else {
            await this._processBufferedMessage();
          }
        }
      }
    });
  }

  private async _processBufferedMessage(): Promise<void> {
    const message = this.messageBuffer.getLast();
    if (message) await this._processMessage(message);
  }

  private async _processMessage(messageData: Record<string, unknown>): Promise<void> {
    this._changeState(State.RECEIVING);

    const { messageId, timestamp, correlationId, data, format, sharedBuffer, offset, length, compressed, schema } = messageData;
    const startTime = performance.now();

    try {
      let result: DataResult;

      if (format === 'arrow-zerocopy') {
        const sharedView = new Uint8Array(sharedBuffer as SharedArrayBuffer, Number(offset), Number(length));
        const table = tableFromIPC(sharedView);
        result = {
          table,
          format: 'arrow-zerocopy',
          rows: table.numRows,
          cols: table.numCols,
          size: Number(length),
          isZeroCopy: true,
          schema: schema as string | null,
          messageId: String(messageId),
          timestamp: Number(timestamp),
          correlationId: (correlationId as string | null) ?? null,
        };

      } else if (format === 'arrow-copy') {
        let buffer: unknown = data;
        if (compressed) buffer = await BridgeUtils.decompress(data);

        const uint8Buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);
        const table = tableFromIPC(uint8Buffer);
        result = {
          table,
          format: 'arrow-copy',
          rows: table.numRows,
          cols: table.numCols,
          size: uint8Buffer.length,
          isZeroCopy: false,
          schema: schema as string | null,
          messageId: String(messageId),
          timestamp: Number(timestamp),
          correlationId: (correlationId as string | null) ?? null,
        };

      } else if (format === 'json') {
        let jsonData: unknown = data;
        if (compressed) {
          const decompressed = await BridgeUtils.decompress(data);
          jsonData = JSON.parse(String(decompressed));
        }

        const arr = Array.isArray(jsonData) ? jsonData : [];
        result = {
          data: jsonData,
          format: 'json',
          rows: arr.length,
          cols: arr.length > 0 ? Object.keys(arr[0] as object).length : 0,
          size: JSON.stringify(jsonData).length,
          isZeroCopy: false,
          messageId: String(messageId),
          timestamp: Number(timestamp),
          correlationId: (correlationId as string | null) ?? null,
        };

      } else {
        throw new Error('Unknown format: ' + format);
      }

      const processingTime = Math.round(performance.now() - startTime);
      result.processingTime = processingTime;

      this.onDataCallback?.(result);

      this._sendMessage(MessageType.DATA_RECEIVED, {
        success: true,
        format: result.format,
        rows: result.rows,
        cols: result.cols,
        processingTime,
        isZeroCopy: result.isZeroCopy,
      }, { messageId: String(messageId), correlationId: (correlationId as string | null) ?? null });

      this._changeState(State.READY);

    } catch (error) {
      this._sendMessage(MessageType.DATA_RECEIVED, {
        success: false,
        error: (error as Error).message,
      }, { messageId: String(messageId), correlationId: (correlationId as string | null) ?? null });

      this.onErrorCallback?.(error as Error);
      this._changeState(State.ERROR);
    }
  }

  onData(callback: DataCallback): this {
    this.onDataCallback = callback;
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

  getState(): StateValue {
    return this.state;
  }

  resumeListening(): void {
    this.listenActive = true;
    this.messageBuffer.reset();
  }

  close(): void {
    if (this.processingDelayTimeout) {
      clearTimeout(this.processingDelayTimeout);
      this.processingDelayTimeout = null;
    }
    this._changeState(State.CLOSED);
    this.messageManager.reset();
    this.messageBuffer.reset();
    this.listenActive = false;
  }

  /** @internal exposed for testing only */
  _getListenMode(): ListenModeValue {
    return this.config.listenMode;
  }
}
