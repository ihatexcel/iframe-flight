export class MessageManager {
  private processedMessages = new Map<string, number>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxCacheSize = 1000;
  private readonly cacheExpiry = 60_000;

  hasProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  markProcessed(messageId: string): void {
    this.processedMessages.set(messageId, Date.now());
    if (this.processedMessages.size > this.maxCacheSize) {
      this.cleanup();
    }
  }

  cleanup(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.cacheExpiry) {
        this.processedMessages.delete(id);
      }
    }
  }

  startAutoCleanup(interval = 30_000): void {
    if (this.cleanupInterval) return;
    this.cleanupInterval = setInterval(() => this.cleanup(), interval);
  }

  stopAutoCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  reset(): void {
    this.processedMessages.clear();
    this.stopAutoCleanup();
  }
}
