// A push-to-pull adapter that can always be left. An async generator suspended on a pending
// promise cannot process return() until that promise settles — so a subscription built on one
// would hang whoever tries to leave it. This channel implements the AsyncGenerator protocol
// directly: push() feeds it, next() drains it (or parks), and return() resolves immediately —
// waking any parked reader with done — no matter what is or is not flowing.

export class Channel<T> implements AsyncGenerator<T, void, unknown> {
  private readonly queue: T[] = [];
  private parked: ((r: IteratorResult<T, void>) => void) | undefined;
  private closed = false;

  // Called exactly once, when the channel is left or ends. Detach sinks here.
  constructor(private readonly onClose?: () => void) {}

  push(value: T): void {
    if (this.closed) return;
    if (this.parked !== undefined) {
      const wake = this.parked;
      this.parked = undefined;
      wake({ value, done: false });
    } else {
      this.queue.push(value);
    }
  }

  next(): Promise<IteratorResult<T, void>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.parked = resolve;
    });
  }

  return(): Promise<IteratorResult<T, void>> {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }

  throw(error?: unknown): Promise<IteratorResult<T, void>> {
    this.close();
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;
    this.parked?.({ value: undefined, done: true });
    this.parked = undefined;
    this.onClose?.();
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    return this;
  }
}
