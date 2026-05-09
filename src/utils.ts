import { PROTOCOL_VERSION } from './constants';

export class BridgeUtils {
  static generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  static now(): number {
    return Date.now();
  }

  static isVersionCompatible(remoteVersion: string): boolean {
    const [remoteMajor] = remoteVersion.split('.').map(Number);
    const [localMajor] = PROTOCOL_VERSION.split('.').map(Number);
    return remoteMajor === localMajor;
  }

  static checkSABSupport(): boolean {
    try {
      new SharedArrayBuffer(1);
      return true;
    } catch {
      return false;
    }
  }

  static async compress(data: unknown): Promise<unknown> {
    // TODO: implement with CompressionStream or pako
    return data;
  }

  static async decompress(data: unknown): Promise<unknown> {
    // TODO: implement with DecompressionStream or pako
    return data;
  }

  static isExpired(timestamp: number, ttl: number | null | undefined): boolean {
    if (!ttl || ttl <= 0) return false;
    return Date.now() - timestamp > ttl;
  }
}
