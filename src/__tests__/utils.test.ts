import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BridgeUtils } from '../utils';

describe('BridgeUtils', () => {
  describe('generateUUID', () => {
    it('generates a UUID v4 format string', () => {
      const uuid = BridgeUtils.generateUUID();
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('generates unique UUIDs', () => {
      const uuids = new Set(Array.from({ length: 100 }, () => BridgeUtils.generateUUID()));
      expect(uuids.size).toBe(100);
    });
  });

  describe('now', () => {
    it('returns a number close to Date.now()', () => {
      const before = Date.now();
      const result = BridgeUtils.now();
      const after = Date.now();
      expect(result).toBeGreaterThanOrEqual(before);
      expect(result).toBeLessThanOrEqual(after);
    });
  });

  describe('isVersionCompatible', () => {
    it('returns true for same major version', () => {
      expect(BridgeUtils.isVersionCompatible('1.0.0')).toBe(true);
      expect(BridgeUtils.isVersionCompatible('1.5.3')).toBe(true);
      expect(BridgeUtils.isVersionCompatible('1.99.99')).toBe(true);
    });

    it('returns false for different major version', () => {
      expect(BridgeUtils.isVersionCompatible('2.0.0')).toBe(false);
      expect(BridgeUtils.isVersionCompatible('0.9.9')).toBe(false);
    });
  });

  describe('isExpired', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns false when ttl is null', () => {
      expect(BridgeUtils.isExpired(Date.now(), null)).toBe(false);
    });

    it('returns false when ttl is 0', () => {
      expect(BridgeUtils.isExpired(Date.now(), 0)).toBe(false);
    });

    it('returns false when message is within ttl', () => {
      const timestamp = Date.now();
      vi.advanceTimersByTime(500);
      expect(BridgeUtils.isExpired(timestamp, 1000)).toBe(false);
    });

    it('returns true when message has expired', () => {
      const timestamp = Date.now();
      vi.advanceTimersByTime(2000);
      expect(BridgeUtils.isExpired(timestamp, 1000)).toBe(true);
    });
  });

  describe('checkSABSupport', () => {
    it('returns a boolean', () => {
      const result = BridgeUtils.checkSABSupport();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('compress / decompress', () => {
    it('compress returns data as-is (passthrough placeholder)', async () => {
      const data = { foo: 'bar' };
      const result = await BridgeUtils.compress(data);
      expect(result).toBe(data);
    });

    it('decompress returns data as-is (passthrough placeholder)', async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await BridgeUtils.decompress(data);
      expect(result).toBe(data);
    });
  });
});
