import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ArrowChildReceiver } from '../ArrowChildReceiver';
import { State, MessageType, ListenMode, PROTOCOL_VERSION } from '../constants';

function dispatchMessage(data: unknown, origin = '*') {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function makeDataTransferMsg(overrides: Record<string, unknown> = {}) {
  return {
    type: MessageType.DATA_TRANSFER,
    protocolVersion: PROTOCOL_VERSION,
    messageId: `msg-${Math.random()}`,
    timestamp: Date.now(),
    source: 'parent',
    correlationId: null,
    format: 'json',
    data: [{ id: 1 }],
    compressed: false,
    ...overrides,
  };
}

// Advance fake timers just enough for async message processing
async function flush() {
  await vi.advanceTimersByTimeAsync(50);
}

describe('ArrowChildReceiver', () => {
  let receiver: ArrowChildReceiver;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    receiver?.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts in CONNECTING state', () => {
    receiver = new ArrowChildReceiver();
    expect(receiver.getState()).toBe(State.CONNECTING);
  });

  it('transitions to READY on PARENT_ACK', () => {
    receiver = new ArrowChildReceiver();
    dispatchMessage({ type: MessageType.PARENT_ACK, protocolVersion: PROTOCOL_VERSION, messageId: 'ack-1', timestamp: Date.now(), source: 'parent' });
    expect(receiver.getState()).toBe(State.READY);
    expect(receiver.isReady()).toBe(true);
  });

  it('ignores messages from disallowed origins', () => {
    receiver = new ArrowChildReceiver({ allowedOrigins: ['https://trusted.com'] });
    const dataCb = vi.fn();
    receiver.onData(dataCb);

    dispatchMessage(makeDataTransferMsg(), 'https://evil.com');
    expect(dataCb).not.toHaveBeenCalled();
  });

  it('fires error on protocol version mismatch', () => {
    const errorCb = vi.fn();
    receiver = new ArrowChildReceiver().onError(errorCb);

    dispatchMessage({ type: MessageType.PARENT_ACK, protocolVersion: '99.0.0', messageId: 'x', timestamp: Date.now(), source: 'parent' });
    expect(errorCb).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('version mismatch') }));
  });

  it('deduplicates messages with same messageId', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver().onData(dataCb);

    const msg = makeDataTransferMsg({ messageId: 'dedup-test' });
    dispatchMessage(msg);
    await flush();
    dispatchMessage(msg);
    await flush();

    expect(dataCb).toHaveBeenCalledTimes(1);
  });

  it('ignores expired messages (TTL)', async () => {
    vi.setSystemTime(new Date('2024-01-01T00:00:01.000Z'));
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver().onData(dataCb);

    const msg = makeDataTransferMsg({
      timestamp: new Date('2024-01-01T00:00:00.000Z').getTime(),
      ttl: 100,
    });
    dispatchMessage(msg);
    await flush();

    expect(dataCb).not.toHaveBeenCalled();
  });

  it('processes JSON data and calls onData', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver().onData(dataCb);

    const msg = makeDataTransferMsg({ data: [{ id: 1, name: 'Alice' }] });
    dispatchMessage(msg);
    await flush();

    expect(dataCb).toHaveBeenCalledOnce();
    const result = dataCb.mock.calls[0][0];
    expect(result.format).toBe('json');
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(2);
    expect(result.isZeroCopy).toBe(false);
  });

  it('sends DATA_RECEIVED ACK to parent after processing', async () => {
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    receiver = new ArrowChildReceiver();

    const msg = makeDataTransferMsg();
    dispatchMessage(msg);
    await flush();

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.DATA_RECEIVED, success: true }),
      '*'
    );
  });

  it('FIRST_MESSAGE mode stops listening after first message', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver({ listenMode: ListenMode.FIRST_MESSAGE }).onData(dataCb);

    dispatchMessage(makeDataTransferMsg({ messageId: 'first' }));
    await flush();
    dispatchMessage(makeDataTransferMsg({ messageId: 'second' }));
    await flush();

    expect(dataCb).toHaveBeenCalledTimes(1);
  });

  it('resumeListening re-enables listening in FIRST_MESSAGE mode', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver({ listenMode: ListenMode.FIRST_MESSAGE }).onData(dataCb);

    dispatchMessage(makeDataTransferMsg({ messageId: 'first' }));
    await flush();

    receiver.resumeListening();

    dispatchMessage(makeDataTransferMsg({ messageId: 'second' }));
    await flush();

    expect(dataCb).toHaveBeenCalledTimes(2);
  });

  it('CONTINUOUS mode with debounce processes only latest message', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver({ listenMode: ListenMode.CONTINUOUS, listenDelay: 200 }).onData(dataCb);

    dispatchMessage(makeDataTransferMsg({ messageId: 'a', data: [{ x: 1 }] }));
    await vi.advanceTimersByTimeAsync(50);
    dispatchMessage(makeDataTransferMsg({ messageId: 'b', data: [{ x: 2 }] }));
    await vi.advanceTimersByTimeAsync(50);
    dispatchMessage(makeDataTransferMsg({ messageId: 'c', data: [{ x: 3 }] }));

    await vi.advanceTimersByTimeAsync(250);

    expect(dataCb).toHaveBeenCalledTimes(1);
    expect(dataCb.mock.calls[0][0].data).toEqual([{ x: 3 }]);
  });

  it('fires onError and sends failure ACK on unknown format', async () => {
    const errorCb = vi.fn();
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    receiver = new ArrowChildReceiver().onError(errorCb);

    const msg = makeDataTransferMsg({ format: 'xml' });
    dispatchMessage(msg);
    await flush();

    expect(errorCb).toHaveBeenCalledOnce();
    expect(errorCb.mock.calls[0][0].message).toContain('Unknown format');
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: MessageType.DATA_RECEIVED, success: false }),
      '*'
    );
    expect(receiver.getState()).toBe(State.ERROR);
  });

  it('close() stops processing and transitions to CLOSED', () => {
    receiver = new ArrowChildReceiver();
    receiver.close();
    expect(receiver.getState()).toBe(State.CLOSED);
  });

  it('handles empty JSON array gracefully', async () => {
    const dataCb = vi.fn();
    receiver = new ArrowChildReceiver().onData(dataCb);

    dispatchMessage(makeDataTransferMsg({ data: [] }));
    await flush();

    const result = dataCb.mock.calls[0][0];
    expect(result.rows).toBe(0);
    expect(result.cols).toBe(0);
  });

  it('onStateChange fires when PARENT_ACK received', () => {
    const cb = vi.fn();
    receiver = new ArrowChildReceiver().onStateChange(cb);

    dispatchMessage({ type: MessageType.PARENT_ACK, protocolVersion: PROTOCOL_VERSION, messageId: 'x', timestamp: Date.now(), source: 'parent' });

    expect(cb).toHaveBeenCalledWith(State.READY, State.CONNECTING);
  });
});
