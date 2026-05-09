import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArrowParentEmitter } from '../ArrowParentEmitter';
import { State, MessageType, PROTOCOL_VERSION } from '../constants';

function makeIframe(): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  Object.defineProperty(iframe, 'contentWindow', {
    value: {
      postMessage: vi.fn(),
    },
    writable: true,
  });
  return iframe;
}

function dispatchMessage(data: unknown, origin = '*') {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

describe('ArrowParentEmitter', () => {
  let iframe: HTMLIFrameElement;
  let emitter: ArrowParentEmitter;

  beforeEach(() => {
    vi.useFakeTimers();
    iframe = makeIframe();
  });

  afterEach(() => {
    emitter?.close();
    vi.useRealTimers();
  });

  it('throws if iframeElement is not an HTMLIFrameElement', () => {
    expect(() => new ArrowParentEmitter(null as unknown as HTMLIFrameElement)).toThrow(
      'iframeElement must be a valid HTMLIFrameElement'
    );
  });

  it('starts in CONNECTING state', () => {
    emitter = new ArrowParentEmitter(iframe);
    expect(emitter.getState()).toBe(State.CONNECTING);
  });

  it('transitions to READY on CHILD_READY message', () => {
    const readyCb = vi.fn();
    emitter = new ArrowParentEmitter(iframe).onReady(readyCb);

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    expect(emitter.getState()).toBe(State.READY);
    expect(emitter.isReady()).toBe(true);
    expect(readyCb).toHaveBeenCalledOnce();
  });

  it('sends PARENT_ACK after CHILD_READY', () => {
    emitter = new ArrowParentEmitter(iframe);
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.PARENT_ACK }),
      '*'
    );
  });

  it('fires handshake timeout error if child never responds', () => {
    const errorCb = vi.fn();
    emitter = new ArrowParentEmitter(iframe, { handshakeTimeout: 1000 }).onError(errorCb);

    vi.advanceTimersByTime(1001);

    expect(errorCb).toHaveBeenCalledWith(expect.objectContaining({ message: 'Handshake timeout' }));
    expect(emitter.getState()).toBe(State.ERROR);
  });

  it('does not fire timeout if CHILD_READY arrives before timeout', () => {
    const errorCb = vi.fn();
    emitter = new ArrowParentEmitter(iframe, { handshakeTimeout: 1000 }).onError(errorCb);

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });
    vi.advanceTimersByTime(2000);

    expect(errorCb).not.toHaveBeenCalled();
  });

  it('ignores messages from disallowed origins', () => {
    const readyCb = vi.fn();
    emitter = new ArrowParentEmitter(iframe, { allowedOrigins: ['https://trusted.com'] }).onReady(readyCb);

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION }, 'https://evil.com');
    expect(readyCb).not.toHaveBeenCalled();
  });

  it('fires error on protocol version mismatch', () => {
    const errorCb = vi.fn();
    emitter = new ArrowParentEmitter(iframe).onError(errorCb);

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: '99.0.0', messageId: 'x', timestamp: Date.now(), source: 'child' });

    expect(errorCb).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('version mismatch') }));
  });

  it('throws if trying to send before READY', async () => {
    emitter = new ArrowParentEmitter(iframe);
    await expect(emitter.sendJSON({ foo: 'bar' })).rejects.toThrow('Parent not ready');
  });

  it('sendJSON sends DATA_TRANSFER message and resolves on ACK', async () => {
    emitter = new ArrowParentEmitter(iframe, { ackTimeout: 3000 });
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    const sendPromise = emitter.sendJSON({ hello: 'world' });

    const sentMsg = postMessage.mock.calls.find(([msg]) => msg.type === MessageType.DATA_TRANSFER)?.[0] as Record<string, unknown> | undefined;
    expect(sentMsg).toBeDefined();
    expect(sentMsg!.format).toBe('json');

    dispatchMessage({
      type: MessageType.DATA_RECEIVED,
      messageId: sentMsg!.messageId,
      success: true,
      format: 'json',
      rows: 1,
      cols: 1,
      processingTime: 5,
      isZeroCopy: false,
    });

    const ack = await sendPromise;
    expect(ack.success).toBe(true);
    expect(ack.format).toBe('json');
  });

  it('sendArrowCopy sends DATA_TRANSFER with arrow-copy format', async () => {
    emitter = new ArrowParentEmitter(iframe);
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    const buf = new Uint8Array([1, 2, 3]);
    const sendPromise = emitter.sendArrowCopy(buf);

    const sentMsg = postMessage.mock.calls.find(([msg]) => msg.type === MessageType.DATA_TRANSFER)?.[0] as Record<string, unknown> | undefined;
    expect(sentMsg!.format).toBe('arrow-copy');

    dispatchMessage({ type: MessageType.DATA_RECEIVED, messageId: sentMsg!.messageId, success: true, format: 'arrow-copy', rows: 0, cols: 0, processingTime: 1, isZeroCopy: false });
    await sendPromise;
  });

  it('ACK timeout rejects the send promise', async () => {
    emitter = new ArrowParentEmitter(iframe, { ackTimeout: 500 });
    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    const sendPromise = emitter.sendJSON({ data: 'x' });
    vi.advanceTimersByTime(600);

    await expect(sendPromise).rejects.toThrow('ACK timeout');
  });

  it('close rejects pending ACKs', async () => {
    emitter = new ArrowParentEmitter(iframe);
    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    const sendPromise = emitter.sendJSON({ data: 'x' });
    emitter.close();

    await expect(sendPromise).rejects.toThrow('Connection closed');
    expect(emitter.getState()).toBe(State.CLOSED);
  });

  it('onStateChange fires when CHILD_READY received', () => {
    const cb = vi.fn();
    emitter = new ArrowParentEmitter(iframe).onStateChange(cb);

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    expect(cb).toHaveBeenCalledWith(State.READY, State.CONNECTING);
  });

  it('send() auto-selects json for non-Uint8Array data', async () => {
    emitter = new ArrowParentEmitter(iframe);
    const postMessage = iframe.contentWindow!.postMessage as ReturnType<typeof vi.fn>;

    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    const sendPromise = emitter.send([{ id: 1 }]);
    const sentMsg = postMessage.mock.calls.find(([msg]) => msg.type === MessageType.DATA_TRANSFER)?.[0] as Record<string, unknown>;
    expect(sentMsg.format).toBe('json');

    dispatchMessage({ type: MessageType.DATA_RECEIVED, messageId: sentMsg.messageId, success: true, format: 'json', rows: 1, cols: 1, processingTime: 1, isZeroCopy: false });
    await sendPromise;
  });

  it('send() throws on unknown format', async () => {
    emitter = new ArrowParentEmitter(iframe);
    dispatchMessage({ type: MessageType.CHILD_READY, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'child' });

    await expect(emitter.send({}, { format: 'xml' as never })).rejects.toThrow('Unknown format');
  });
});
