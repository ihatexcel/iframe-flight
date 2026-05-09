export class MessageBuffer<T = unknown> {
  private previous: T | null = null;
  private current: T | null = null;

  push(message: T): void {
    this.previous = this.current;
    this.current = message;
  }

  getLast(): T | null {
    return this.current;
  }

  getPrevious(): T | null {
    return this.previous;
  }

  hasNew(): boolean {
    return this.current !== null;
  }

  reset(): void {
    this.previous = null;
    this.current = null;
  }
}
