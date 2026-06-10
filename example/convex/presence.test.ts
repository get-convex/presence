/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { initConvexTest } from "./setup.test";

const ROOM = "room-1";
const USER = "user-1";

describe("presence heartbeat / timeout", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("graceful disconnect marks the user offline immediately", async () => {
    const t = initConvexTest();
    const { roomToken, sessionToken } = await t.mutation(
      api.presence.heartbeat,
      { roomId: ROOM, userId: USER, sessionId: "s1", interval: 10000 },
    );
    await t.mutation(api.presence.disconnect, { sessionToken });
    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: false }]);
  });

  // Exercises the snapshot fast-path's fallback: when the snapshot says the user
  // is not online, the heartbeat takes a tracked read and flips them back online.
  test("a heartbeat after disconnect brings the user back online", async () => {
    const t = initConvexTest();
    const first = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval: 10000,
    });
    await t.mutation(api.presence.disconnect, {
      sessionToken: first.sessionToken,
    });

    const { roomToken } = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval: 10000,
    });
    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: true }]);
  });

  // Continued heartbeats keep the disconnect timeout pushed out (without
  // rescheduling on every beat), so the user stays online across several
  // timeout windows as long as heartbeats continue.
  test("continued heartbeats keep the user online across timeout windows", async () => {
    vi.useFakeTimers();
    const t = initConvexTest();
    const interval = 1000; // disconnect window = 2.5 * interval = 2500ms

    const { roomToken } = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval,
    });

    for (let i = 0; i < 5; i++) {
      // Advance toward the armed deadline, then heartbeat — the debounced
      // re-arm pushes the timeout out before it can fire for a live session.
      vi.advanceTimersByTime(interval);
      await t.finishInProgressScheduledFunctions();
      await t.mutation(api.presence.heartbeat, {
        roomId: ROOM,
        userId: USER,
        sessionId: "s1",
        interval,
      });
    }

    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: true }]);
  });

  test("a silent session is reaped after the timeout window", async () => {
    vi.useFakeTimers();
    const t = initConvexTest();
    const interval = 1000; // window = 2500ms

    const { roomToken } = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval,
    });

    // No further heartbeats: advance past the 2.5x window so the armed
    // disconnect timeout fires and marks the session offline.
    vi.advanceTimersByTime(interval * 3);
    await t.finishInProgressScheduledFunctions();

    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: false }]);
  });

  // Shrinking the interval must bring the disconnect deadline forward: a
  // session armed on a long interval, then heartbeating on a short one, should
  // be reaped on the short window — not left online until the original deadline.
  test("a shorter interval brings the disconnect deadline forward", async () => {
    vi.useFakeTimers();
    const t = initConvexTest();

    const { roomToken } = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval: 10000, // window = 25000ms
    });
    await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval: 1000, // window = 2500ms
    });

    // Advance past the short window but well short of the original long one.
    vi.advanceTimersByTime(3000);
    await t.finishInProgressScheduledFunctions();

    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: false }]);
  });

  test("one of two sessions timing out keeps the user online", async () => {
    vi.useFakeTimers();
    const t = initConvexTest();
    const interval = 1000;

    const { roomToken } = await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s1",
      interval,
    });
    await t.mutation(api.presence.heartbeat, {
      roomId: ROOM,
      userId: USER,
      sessionId: "s2",
      interval,
    });

    // Keep s2 alive while s1 goes silent: heartbeat s2 every interval and let
    // time march past s1's window.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(interval);
      await t.finishInProgressScheduledFunctions();
      await t.mutation(api.presence.heartbeat, {
        roomId: ROOM,
        userId: USER,
        sessionId: "s2",
        interval,
      });
    }

    // s1 should have been reaped, but the user stays online because s2 is live.
    const list = await t.query(api.presence.list, { roomToken });
    expect(list).toMatchObject([{ userId: USER, online: true }]);
  });
});
