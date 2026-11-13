interface Waiter<T> {
  readonly resolve: (r: IteratorResult<T, void>) => void;
  readonly reject: (e: Error) => void;
}

export type LiveStream = Pick<AsyncGenerator<unknown, void, unknown>, "return">;

export class Channel<T> implements AsyncGenerator<T, void, unknown> {
  private readonly queue: T[] = [];
  private readonly waiters: Waiter<T>[] = [];
  private closed = false;
  private failure: Error | undefined;

  constructor(
    private readonly onClose?: () => void,
    private readonly coalesce?: (pending: T, incoming: T) => T,
  ) {}

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve({ value, done: false });
      return;
    }
    if (this.coalesce !== undefined && this.queue.length > 0) {
      this.queue[this.queue.length - 1] = this.coalesce(this.queue[this.queue.length - 1]!, value);
    } else {
      this.queue.push(value);
    }
  }

  fail(error: Error): void {
    if (this.closed) return;
    const parked = this.waiters.splice(0);
    this.failure = parked.length > 0 ? undefined : error;
    this.close();
    for (const waiter of parked) waiter.reject(error);
  }

  next(): Promise<IteratorResult<T, void>> {
    if (this.queue.length > 0) {
      return Promise.resolve({ value: this.queue.shift()!, done: false });
    }
    if (this.failure !== undefined) {
      const err = this.failure;
      this.failure = undefined;
      return Promise.reject(err);
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
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
    this.queue.length = 0;
    for (const waiter of this.waiters.splice(0)) waiter.resolve({ value: undefined, done: true });
    this.onClose?.();
  }

  [Symbol.asyncIterator](): AsyncGenerator<T, void, unknown> {
    return this;
  }
}

export function streamAfter<T>(
  ready: Promise<void>,
  open: () => AsyncGenerator<T, void, unknown>,
  live?: Set<LiveStream>,
): AsyncGenerator<T, void, unknown> {
  let stream: AsyncGenerator<T, void, unknown> | undefined;
  let closed = false;
  let release!: () => void;
  const left = new Promise<void>((resolve) => {
    release = resolve;
  });
  const leave = () => {
    closed = true;
    release();
    live?.delete(deferred);
  };
  const deferred: AsyncGenerator<T, void, unknown> = {
    async next() {
      if (closed) return { value: undefined, done: true };
      try {
        await Promise.race([ready, left]);
        if (closed) return { value: undefined, done: true };
        if (stream === undefined) {
          stream = open();
          live?.delete(deferred);
        }
        return stream.next();
      } catch (error) {
        if (closed) return { value: undefined, done: true };
        leave();
        throw error;
      }
    },
    async return() {
      leave();
      return stream === undefined ? { value: undefined, done: true } : stream.return();
    },
    async throw(error?: unknown) {
      leave();
      if (stream !== undefined) return stream.throw(error);
      throw error instanceof Error ? error : new Error(String(error));
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
  live?.add(deferred);
  return deferred;
}
