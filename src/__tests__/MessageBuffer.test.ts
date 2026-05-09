import { describe, it, expect, beforeEach } from 'vitest';
import { MessageBuffer } from '../MessageBuffer';

describe('MessageBuffer', () => {
  let buffer: MessageBuffer<{ id: number }>;

  beforeEach(() => {
    buffer = new MessageBuffer();
  });

  it('starts empty', () => {
    expect(buffer.hasNew()).toBe(false);
    expect(buffer.getLast()).toBeNull();
    expect(buffer.getPrevious()).toBeNull();
  });

  it('stores the first message', () => {
    buffer.push({ id: 1 });
    expect(buffer.hasNew()).toBe(true);
    expect(buffer.getLast()).toEqual({ id: 1 });
    expect(buffer.getPrevious()).toBeNull();
  });

  it('keeps last 2 messages with correct order', () => {
    buffer.push({ id: 1 });
    buffer.push({ id: 2 });
    expect(buffer.getLast()).toEqual({ id: 2 });
    expect(buffer.getPrevious()).toEqual({ id: 1 });
  });

  it('overwrites previous when 3+ messages pushed', () => {
    buffer.push({ id: 1 });
    buffer.push({ id: 2 });
    buffer.push({ id: 3 });
    expect(buffer.getLast()).toEqual({ id: 3 });
    expect(buffer.getPrevious()).toEqual({ id: 2 });
  });

  it('resets to empty state', () => {
    buffer.push({ id: 1 });
    buffer.push({ id: 2 });
    buffer.reset();
    expect(buffer.hasNew()).toBe(false);
    expect(buffer.getLast()).toBeNull();
    expect(buffer.getPrevious()).toBeNull();
  });
});
