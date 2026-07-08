/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { initConvexTest } from "./setup.test.js";

// The disconnect worker runs on scheduled functions inside the nested
// batch-worker component, so these tests drive it with fake timers.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const HEARTBEAT = {
  roomId: "room1",
  userId: "user1",
  sessionId: "session1",
  interval: 1000,
};

test("session times out and user goes offline without heartbeats", async () => {
  const t = initConvexTest();
  const { roomToken } = await t.mutation(api.presence.heartbeat, HEARTBEAT);

  let users = await t.query(api.presence.list, { roomToken });
  expect(users).toMatchObject([{ userId: "user1", online: true }]);

  // Send no more heartbeats: the worker's loop wakes at the session deadline
  // (2.5x the heartbeat interval) and marks the user offline.
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  users = await t.query(api.presence.list, { roomToken });
  expect(users).toMatchObject([{ userId: "user1", online: false }]);
  expect(users[0].lastDisconnected).toBeGreaterThan(0);
});

test("heartbeats keep the session alive", async () => {
  const t = initConvexTest();
  const { roomToken } = await t.mutation(api.presence.heartbeat, HEARTBEAT);

  // Keep heartbeating past the original 2.5s deadline; the worker wakes at
  // the stale deadline, finds nothing expired, and goes back to sleep.
  for (let i = 0; i < 3; i++) {
    vi.advanceTimersByTime(2000);
    await t.finishInProgressScheduledFunctions();
    await t.mutation(api.presence.heartbeat, HEARTBEAT);
  }
  const users = await t.query(api.presence.list, { roomToken });
  expect(users).toMatchObject([{ userId: "user1", online: true }]);

  // Then stop: the session times out.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.presence.list, { roomToken })).toMatchObject([
    { userId: "user1", online: false },
  ]);
});

test("graceful disconnect takes effect immediately", async () => {
  const t = initConvexTest();
  const { roomToken, sessionToken } = await t.mutation(
    api.presence.heartbeat,
    HEARTBEAT,
  );

  await t.mutation(api.presence.disconnect, { sessionToken });
  expect(await t.query(api.presence.list, { roomToken })).toMatchObject([
    { userId: "user1", online: false },
  ]);

  // The worker's loop still wakes at the now-deleted session's deadline,
  // finds nothing to do, and goes idle without erroring.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.query(api.presence.list, { roomToken })).toMatchObject([
    { userId: "user1", online: false },
  ]);
});
