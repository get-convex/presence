/// <reference types="vite/client" />
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defineSchema } from "convex/server";
import { defineTestApp } from "convex-test";
import componentTest from "../test.js";
import { Presence } from "./index.js";

const app = defineTestApp({
  schema: defineSchema({}),
  components: {
    presence: componentTest,
  },
});

const presence = new Presence(app.components.presence);

const { api, createTest } = app.defineModules({
  presence: {
    heartbeat: app.mutation({
      args: {
        roomId: v.string(),
        userId: v.string(),
        sessionId: v.string(),
        interval: v.optional(v.number()),
      },
      handler: async (ctx, { roomId, userId, sessionId, interval = 1000 }) =>
        presence.heartbeat(ctx, roomId, userId, sessionId, interval),
    }),
    list: app.query({
      args: { roomToken: v.string() },
      handler: async (ctx, { roomToken }) => presence.list(ctx, roomToken),
    }),
    listRoom: app.query({
      args: { roomId: v.string(), onlineOnly: v.optional(v.boolean()) },
      handler: async (ctx, { roomId, onlineOnly }) =>
        presence.listRoom(ctx, roomId, onlineOnly),
    }),
    listUser: app.query({
      args: { userId: v.string(), onlineOnly: v.optional(v.boolean()) },
      handler: async (ctx, { userId, onlineOnly }) =>
        presence.listUser(ctx, userId, onlineOnly),
    }),
    disconnect: app.mutation({
      args: { sessionToken: v.string() },
      handler: async (ctx, { sessionToken }) =>
        presence.disconnect(ctx, sessionToken),
    }),
    updateRoomUser: app.mutation({
      args: { roomId: v.string(), userId: v.string(), data: v.any() },
      handler: async (ctx, { roomId, userId, data }) =>
        presence.updateRoomUser(ctx, roomId, userId, data),
    }),
    removeRoomUser: app.mutation({
      args: { roomId: v.string(), userId: v.string() },
      handler: async (ctx, { roomId, userId }) =>
        presence.removeRoomUser(ctx, roomId, userId),
    }),
    removeRoom: app.mutation({
      args: { roomId: v.string() },
      handler: async (ctx, { roomId }) => presence.removeRoom(ctx, roomId),
    }),
  },
});

const hb = (roomId: string, userId: string, sessionId: string) => ({
  roomId,
  userId,
  sessionId,
  interval: 1000,
});

describe("presence client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("user stays online while any of their sessions is alive", async () => {
    const t = createTest();
    // Two tabs for the same user.
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    const { sessionToken } = await t.mutation(
      api.presence.heartbeat,
      hb("room1", "user1", "tab2"),
    );

    // Keep tab2 alive well past tab1's timeout: tab1 gets disconnected by the
    // worker but the user stays online through tab2.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(2000);
      await t.finishInProgressScheduledFunctions();
      await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab2"));
    }
    let users = await t.query(api.presence.listRoom, { roomId: "room1" });
    expect(users).toMatchObject([{ userId: "user1", online: true }]);

    // Disconnecting the last session takes the user offline.
    await t.mutation(api.presence.disconnect, { sessionToken });
    users = await t.query(api.presence.listRoom, { roomId: "room1" });
    expect(users).toMatchObject([{ userId: "user1", online: false }]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("timed-out user comes back online on the next heartbeat", async () => {
    const t = createTest();
    const first = await t.mutation(
      api.presence.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await t.query(api.presence.listRoom, { roomId: "room1" }),
    ).toMatchObject([{ userId: "user1", online: false }]);

    const second = await t.mutation(
      api.presence.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    expect(
      await t.query(api.presence.listRoom, { roomId: "room1" }),
    ).toMatchObject([{ userId: "user1", online: true }]);
    // Room tokens are stable; the timed-out session's token was invalidated.
    expect(second.roomToken).toBe(first.roomToken);
    expect(second.sessionToken).not.toBe(first.sessionToken);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("mass expiry drains across multiple worker batches", async () => {
    const t = createTest();
    // More sessions than DISCONNECT_BATCH so the worker needs several rounds.
    for (let i = 0; i < 70; i++) {
      await t.mutation(
        api.presence.heartbeat,
        hb("room1", `user${i}`, `session${i}`),
      );
    }
    let users = await t.query(api.presence.listRoom, { roomId: "room1" });
    expect(users).toHaveLength(70);
    expect(users.every((u) => u.online)).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    users = await t.query(api.presence.listRoom, { roomId: "room1" });
    expect(users).toHaveLength(70);
    expect(users.every((u) => !u.online)).toBe(true);
  });

  test("an earlier deadline interrupts the wait after a completed batch", async () => {
    const t = createTest();
    // At t=1s, short expires while long remains alive until t=100s. Before
    // this fix, the worker debounced directly to long's deadline and ignored
    // pings for sessions created during that wait.
    await t.mutation(api.presence.heartbeat, {
      roomId: "room1",
      userId: "short",
      sessionId: "short",
      interval: 400,
    });
    await t.mutation(api.presence.heartbeat, {
      roomId: "room1",
      userId: "long",
      sessionId: "long",
      interval: 40000,
    });

    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();

    await t.mutation(api.presence.heartbeat, {
      roomId: "room1",
      userId: "new-short",
      sessionId: "new-short",
      interval: 400,
    });
    // Run the immediate post-batch query, then wake at new-short's deadline.
    vi.advanceTimersByTime(0);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(1000);
    await t.finishInProgressScheduledFunctions();

    expect(
      await t.query(api.presence.listRoom, { roomId: "room1" }),
    ).toMatchObject([
      { userId: "long", online: true },
      { userId: "new-short", online: false },
      { userId: "short", online: false },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("list requires a valid room token", async () => {
    const t = createTest();
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    expect(await t.query(api.presence.list, { roomToken: "bogus" })).toEqual(
      [],
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("updateRoomUser data shows up in list", async () => {
    const t = createTest();
    const { roomToken } = await t.mutation(
      api.presence.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    await t.mutation(api.presence.updateRoomUser, {
      roomId: "room1",
      userId: "user1",
      data: { typing: true },
    });
    expect(await t.query(api.presence.list, { roomToken })).toMatchObject([
      { userId: "user1", online: true, data: { typing: true } },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("removeRoomUser removes the user entirely, not just offline", async () => {
    const t = createTest();
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    await t.mutation(api.presence.heartbeat, hb("room1", "user2", "tab2"));

    await t.mutation(api.presence.removeRoomUser, {
      roomId: "room1",
      userId: "user1",
    });
    expect(
      await t.query(api.presence.listRoom, { roomId: "room1" }),
    ).toMatchObject([{ userId: "user2", online: true }]);

    // The worker wakes on user1's stale deadline and finds nothing to do.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await t.query(api.presence.listRoom, { roomId: "room1" }),
    ).toMatchObject([{ userId: "user2", online: false }]);
  });

  test("removeRoom removes all users and sessions", async () => {
    const t = createTest();
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    await t.mutation(api.presence.heartbeat, hb("room1", "user2", "tab2"));

    await t.mutation(api.presence.removeRoom, { roomId: "room1" });
    expect(await t.query(api.presence.listRoom, { roomId: "room1" })).toEqual(
      [],
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.presence.listRoom, { roomId: "room1" })).toEqual(
      [],
    );
  });

  test("listUser lists a user's rooms with onlineOnly filtering", async () => {
    const t = createTest();
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    const { sessionToken } = await t.mutation(
      api.presence.heartbeat,
      hb("room2", "user1", "tab2"),
    );
    await t.mutation(api.presence.disconnect, { sessionToken });

    expect(
      await t.query(api.presence.listUser, { userId: "user1" }),
    ).toMatchObject([
      { roomId: "room1", online: true },
      { roomId: "room2", online: false },
    ]);
    expect(
      await t.query(api.presence.listUser, {
        userId: "user1",
        onlineOnly: true,
      }),
    ).toMatchObject([{ roomId: "room1", online: true }]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("sessionId must be unique for a given room/user", async () => {
    const t = createTest();
    await t.mutation(api.presence.heartbeat, hb("room1", "user1", "tab1"));
    await expect(
      t.mutation(api.presence.heartbeat, hb("room2", "user1", "tab1")),
    ).rejects.toThrow(/unique/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("disconnect with an unknown token is a no-op", async () => {
    const t = createTest();
    const { roomToken } = await t.mutation(
      api.presence.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    await t.mutation(api.presence.disconnect, { sessionToken: "bogus" });
    expect(await t.query(api.presence.list, { roomToken })).toMatchObject([
      { userId: "user1", online: true },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
