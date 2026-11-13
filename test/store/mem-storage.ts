import type { StorageLike } from "../../src/store/local-storage.js";

export class MemStorage implements StorageLike {
  private map = new Map<string, string>();

  constructor(private readonly quotaBytes = Infinity) {}

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    let bytes = key.length + value.length;
    for (const [k, v] of this.map) if (k !== key) bytes += k.length + v.length;
    if (bytes > this.quotaBytes) {
      throw new DOMException("the quota has been exceeded", "QuotaExceededError");
    }
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
