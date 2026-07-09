// The Channel's protocol promises, pinned: FIFO service for concurrent readers, rejection (not
// silence) for a failed stream even while parked, immediate leave-ability, and coalescence for
// the undrained.

import { describe, expect, it } from "vitest";
import { Channel } from "../../src/gateway/channel.js";

describe("Channel", () => {
  it("serves concurrent parked readers in FIFO order", async () => {
    const ch = new Channel<number>();
    const first = ch.next();
    const second = ch.next();
    ch.push(1);
    ch.push(2);
    expect(await first).toEqual({ value: 1, done: false });
    expect(await second).toEqual({ value: 2, done: false });
    await ch.return();
  });

  it("fail() rejects every parked reader with the error — a dead stream says so", async () => {
    let closed = 0;
    const ch = new Channel<number>(() => {
      closed += 1;
    });
    const parkedA = ch.next();
    const parkedB = ch.next();
    ch.fail(new Error("the ground gave way"));
    await expect(parkedA).rejects.toThrow(/ground gave way/);
    await expect(parkedB).rejects.toThrow(/ground gave way/);
    expect((await ch.next()).done).toBe(true); // after the error, simply done
    expect(closed).toBe(1); // onClose fired exactly once
  });

  it("fail() with nobody parked rejects the next read once, then is done", async () => {
    const ch = new Channel<number>();
    ch.fail(new Error("quietly broken"));
    await expect(ch.next()).rejects.toThrow(/quietly broken/);
    expect((await ch.next()).done).toBe(true);
  });

  it("return() wakes every parked reader with done and pushes are ignored after", async () => {
    const ch = new Channel<number>();
    const parked = ch.next();
    await ch.return();
    expect((await parked).done).toBe(true);
    ch.push(9);
    expect((await ch.next()).done).toBe(true);
  });

  it("coalesces onto the undrained value; a waiting reader preempts the queue", async () => {
    const ch = new Channel<number>(undefined, (pending, incoming) => pending + incoming);
    ch.push(1);
    ch.push(2);
    ch.push(3); // 1+2+3 coalesce: nobody was reading
    expect(await ch.next()).toEqual({ value: 6, done: false });
    const parked = ch.next();
    ch.push(4); // a parked reader is served directly, no coalescing detour
    expect(await parked).toEqual({ value: 4, done: false });
    await ch.return();
  });
});
