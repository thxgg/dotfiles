import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentCapacityPool } from "../concurrency.ts";

test("capacity is reserved synchronously and queued callers cannot race past the limit", async () => {
  const pool = new AgentCapacityPool(2);
  const first = await pool.acquire();
  const second = await pool.acquire();
  let acquiredThird = false;
  const thirdPromise = pool.acquire().then((lease) => { acquiredThird = true; return lease; });
  await Promise.resolve();
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.queuedCount, 1);
  assert.equal(acquiredThird, false);
  first.release();
  const third = await thirdPromise;
  assert.equal(acquiredThird, true);
  assert.equal(pool.activeCount, 2);
  first.release();
  second.release();
  third.release();
  assert.equal(pool.activeCount, 0);
});

test("aborted waiters are removed without consuming capacity", async () => {
  const pool = new AgentCapacityPool(1);
  const lease = await pool.acquire();
  const controller = new AbortController();
  const waiting = pool.acquire(controller.signal);
  controller.abort(new Error("cancelled"));
  await assert.rejects(waiting, /cancelled/);
  assert.equal(pool.queuedCount, 0);
  lease.release();
  assert.equal(pool.activeCount, 0);
});
