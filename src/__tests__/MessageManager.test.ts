import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageManager } from '../MessageManager';

describe('MessageManager', () => {
  let manager: MessageManager;

  beforeEach(() => {
    manager = new MessageManager();
  });

  afterEach(() => {
    manager.reset();
  });

  it('marks and detects processed messages', () => {
    expect(manager.hasProcessed('msg-1')).toBe(false);
    manager.markProcessed('msg-1');
    expect(manager.hasProcessed('msg-1')).toBe(true);
  });

  it('handles multiple independent messages', () => {
    manager.markProcessed('msg-1');
    manager.markProcessed('msg-2');
    expect(manager.hasProcessed('msg-1')).toBe(true);
    expect(manager.hasProcessed('msg-2')).toBe(true);
    expect(manager.hasProcessed('msg-3')).toBe(false);
  });

  it('cleans up expired messages', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    manager.markProcessed('old-msg');
    expect(manager.hasProcessed('old-msg')).toBe(true);

    vi.advanceTimersByTime(61_000);
    manager.cleanup();

    expect(manager.hasProcessed('old-msg')).toBe(false);
    vi.useRealTimers();
  });

  it('does not clean up messages within expiry window', () => {
    vi.useFakeTimers();
    manager.markProcessed('recent-msg');
    vi.advanceTimersByTime(30_000);
    manager.cleanup();
    expect(manager.hasProcessed('recent-msg')).toBe(true);
    vi.useRealTimers();
  });

  it('resets all state', () => {
    manager.markProcessed('msg-1');
    manager.reset();
    expect(manager.hasProcessed('msg-1')).toBe(false);
  });

  it('startAutoCleanup does not create multiple intervals', () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.spyOn(manager, 'cleanup');
    manager.startAutoCleanup(1000);
    manager.startAutoCleanup(1000);
    manager.startAutoCleanup(1000);

    vi.advanceTimersByTime(1000);
    expect(cleanupSpy).toHaveBeenCalledTimes(1);

    manager.stopAutoCleanup();
    vi.useRealTimers();
  });

  it('stopAutoCleanup prevents further cleanups', () => {
    vi.useFakeTimers();
    const cleanupSpy = vi.spyOn(manager, 'cleanup');
    manager.startAutoCleanup(1000);
    manager.stopAutoCleanup();

    vi.advanceTimersByTime(5000);
    expect(cleanupSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
