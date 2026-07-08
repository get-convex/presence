/// <reference types="vite/client" />
import { v } from "convex/values";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  anyApi,
  type ApiFromModules,
  mutationGeneric,
  queryGeneric,
} from "convex/server";
import { Presence } from "./index.js";
import { components, initConvexTest } from "./setup.test.js";

const presence = new Presence(components.presence);

export const heartbeat = mutationGeneric({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, userId, sessionId, interval = 1000 }) =>
    presence.heartbeat(ctx, roomId, userId, sessionId, interval),
});

export const list = queryGeneric({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => presence.list(ctx, roomToken),
});

export const listRoom = queryGeneric({
  args: { roomId: v.string(), onlineOnly: v.optional(v.boolean()) },
  handler: async (ctx, { roomId, onlineOnly }) =>
    presence.listRoom(ctx, roomId, onlineOnly),
});

export const listUser = queryGeneric({
  args: { userId: v.string(), onlineOnly: v.optional(v.boolean()) },
  handler: async (ctx, { userId, onlineOnly }) =>
    presence.listUser(ctx, userId, onlineOnly),
});

export const disconnect = mutationGeneric({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) =>
    presence.disconnect(ctx, sessionToken),
});

export const updateRoomUser = mutationGeneric({
  args: { roomId: v.string(), userId: v.string(), data: v.any() },
  handler: async (ctx, { roomId, userId, data }) =>
    presence.updateRoomUser(ctx, roomId, userId, data),
});

export const removeRoomUser = mutationGeneric({
  args: { roomId: v.string(), userId: v.string() },
  handler: async (ctx, { roomId, userId }) =>
    presence.removeRoomUser(ctx, roomId, userId),
});

export const removeRoom = mutationGeneric({
  args: { roomId: v.string() },
  handler: async (ctx, { roomId }) => presence.removeRoom(ctx, roomId),
});

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "index.test": {
      heartbeat: typeof heartbeat;
      list: typeof list;
      listRoom: typeof listRoom;
      listUser: typeof listUser;
      disconnect: typeof disconnect;
      updateRoomUser: typeof updateRoomUser;
      removeRoomUser: typeof removeRoomUser;
      removeRoom: typeof removeRoom;
    };
  }>
)["index.test"];

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
    const t = initConvexTest();
    // Two tabs for the same user.
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    const { sessionToken } = await t.mutation(
      testApi.heartbeat,
      hb("room1", "user1", "tab2"),
    );

    // Keep tab2 alive well past tab1's timeout: tab1 gets disconnected by the
    // worker but the user stays online through tab2.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(2000);
      await t.finishInProgressScheduledFunctions();
      await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab2"));
    }
    let users = await t.query(testApi.listRoom, { roomId: "room1" });
    expect(users).toMatchObject([{ userId: "user1", online: true }]);

    // Disconnecting the last session takes the user offline.
    await t.mutation(testApi.disconnect, { sessionToken });
    users = await t.query(testApi.listRoom, { roomId: "room1" });
    expect(users).toMatchObject([{ userId: "user1", online: false }]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("timed-out user comes back online on the next heartbeat", async () => {
    const t = initConvexTest();
    const first = await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toMatchObject([
      { userId: "user1", online: false },
    ]);

    const second = await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toMatchObject([
      { userId: "user1", online: true },
    ]);
    // Room tokens are stable; the timed-out session's token was invalidated.
    expect(second.roomToken).toBe(first.roomToken);
    expect(second.sessionToken).not.toBe(first.sessionToken);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("mass expiry drains across multiple worker batches", async () => {
    const t = initConvexTest();
    // More sessions than DISCONNECT_BATCH so the worker needs several rounds.
    for (let i = 0; i < 70; i++) {
      await t.mutation(testApi.heartbeat, hb("room1", `user${i}`, `session${i}`));
    }
    let users = await t.query(testApi.listRoom, { roomId: "room1" });
    expect(users).toHaveLength(70);
    expect(users.every((u) => u.online)).toBe(true);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    users = await t.query(testApi.listRoom, { roomId: "room1" });
    expect(users).toHaveLength(70);
    expect(users.every((u) => !u.online)).toBe(true);
  });

  test("list requires a valid room token", async () => {
    const t = initConvexTest();
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    expect(await t.query(testApi.list, { roomToken: "bogus" })).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("updateRoomUser data shows up in list", async () => {
    const t = initConvexTest();
    const { roomToken } = await t.mutation(
      testApi.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    await t.mutation(testApi.updateRoomUser, {
      roomId: "room1",
      userId: "user1",
      data: { typing: true },
    });
    expect(await t.query(testApi.list, { roomToken })).toMatchObject([
      { userId: "user1", online: true, data: { typing: true } },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("removeRoomUser removes the user entirely, not just offline", async () => {
    const t = initConvexTest();
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    await t.mutation(testApi.heartbeat, hb("room1", "user2", "tab2"));

    await t.mutation(testApi.removeRoomUser, {
      roomId: "room1",
      userId: "user1",
    });
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toMatchObject([
      { userId: "user2", online: true },
    ]);

    // The worker wakes on user1's stale deadline and finds nothing to do.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toMatchObject([
      { userId: "user2", online: false },
    ]);
  });

  test("removeRoom removes all users and sessions", async () => {
    const t = initConvexTest();
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    await t.mutation(testApi.heartbeat, hb("room1", "user2", "tab2"));

    await t.mutation(testApi.removeRoom, { roomId: "room1" });
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toEqual([]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(testApi.listRoom, { roomId: "room1" })).toEqual([]);
  });

  test("listUser lists a user's rooms with onlineOnly filtering", async () => {
    const t = initConvexTest();
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    const { sessionToken } = await t.mutation(
      testApi.heartbeat,
      hb("room2", "user1", "tab2"),
    );
    await t.mutation(testApi.disconnect, { sessionToken });

    expect(await t.query(testApi.listUser, { userId: "user1" })).toMatchObject([
      { roomId: "room1", online: true },
      { roomId: "room2", online: false },
    ]);
    expect(
      await t.query(testApi.listUser, { userId: "user1", onlineOnly: true }),
    ).toMatchObject([{ roomId: "room1", online: true }]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("sessionId must be unique for a given room/user", async () => {
    const t = initConvexTest();
    await t.mutation(testApi.heartbeat, hb("room1", "user1", "tab1"));
    await expect(
      t.mutation(testApi.heartbeat, hb("room2", "user1", "tab1")),
    ).rejects.toThrow(/unique/);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("disconnect with an unknown token is a no-op", async () => {
    const t = initConvexTest();
    const { roomToken } = await t.mutation(
      testApi.heartbeat,
      hb("room1", "user1", "tab1"),
    );
    await t.mutation(testApi.disconnect, { sessionToken: "bogus" });
    expect(await t.query(testApi.list, { roomToken })).toMatchObject([
      { userId: "user1", online: true },
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });
});
