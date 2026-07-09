// A push-to-pull adapter that can always be left. An async generator suspended on a pending
// promise cannot process return() until that promise settles — so a subscription built on one
// would hang whoever tries to leave it. This channel implements the AsyncGenerator protocol
// directly: push() feeds it, next() drains it (or parks), and return() resolves immediately —
// waking any parked reader with done — no matter what is or is not flowing.
//
// Backpressure is coalescence, not growth: when a coalesce function is given, a push landing on
// an undrained value merges into it instead of queueing behind it — a slow reader holds at most
// one pending value, and the merge preserves whatever continuity the payload carries.

export class Channel<T> implements AsyncGenerator<T, void, unknown> {
  private readonly queue: T[] = [];
  private parked:
    { resolve: (r: IteratorResult<T, void>) => void; reject: (e: Error) => void } | undefined;
  private closed = false;
  private failure: Error | undefined;

  constructor(
    // Called exactly once, when the channel is left, fails, or ends. Detach sinks here.
    private readonly onClose?: () => void,
    // Merge a new value into an undrained one (slow reader): (pending, incoming) → kept.
    private readonly coalesce?: (pending: T, incoming: T) => T,
  ) {}

  push(value: T): void {
    if (this.closed) return;
    if (this.parked !== undefined) {
      const { resolve } = this.parked;
      this.parked = undefined;
      resolve({ value, done: false });
      return;
    }
    if (this.coalesce !== undefined && this.queue.length > 0) {
      this.queue[this.queue.length - 1] = this.coalesce(this.queue[this.queue.length - 1]!, value);
    } else {
      this.queue.push(value);
    }
  }

  // End the stream with an error: the parked (or next) reader gets a rejection, then done.
  fail(error: Error): void {
    if (this.closed) return;
    this.failure = error;
    const parked = this.parked;
    this.close();
    parked?.reject(error);
  }

  next(): Promise<IteratorResult<T, void>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.failure !== undefined) {
      const err = this.failure;
      this.failure = undefined; // reject once; after that the stream is simply done
      return Promise.reject(err);
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.parked = { resolve, reject };
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
    this.parked?.resolve({ value: undefined, done: true });
    this.parked = undefined;
    this.onClose?.();
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    return this;
  }
}
