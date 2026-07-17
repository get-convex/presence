/// <reference types="vite/client" />
import batchWorker from "@convex-dev/batch-worker/test";
import { anyApi, type ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as publicFunctions from "./component/public.js";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");
const componentApi = (
  anyApi as unknown as ApiFromModules<{ public: typeof publicFunctions }>
).public;

function initComponentTest() {
  const t = convexTest(schema, modules);
  batchWorker.register(t, "batchWorker");
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test("a legacy scheduled disconnect removes a deadline-less session", async () => {
  const t = initComponentTest();
  await t.run(async (ctx) => {
    await ctx.db.insert("presence", {
      roomId: "room1",
      userId: "user1",
      online: true,
      lastDisconnected: 0,
    });
    await ctx.db.insert("sessions", {
      roomId: "room1",
      userId: "user1",
      sessionId: "session1",
    });
    await ctx.db.insert("sessionTokens", {
      sessionId: "session1",
      token: "legacy-token",
    });
  });

  await t.mutation(componentApi.disconnect, {
    sessionToken: "legacy-token",
    scheduled: true,
  });

  await t.run(async (ctx) => {
    expect(await ctx.db.query("sessions").first()).toBeNull();
    expect(await ctx.db.query("sessionTokens").first()).toBeNull();
    expect(await ctx.db.query("presence").first()).toMatchObject({
      online: false,
    });
  });
});

test("a legacy scheduled disconnect ignores a migrated session", async () => {
  const t = initComponentTest();
  const { sessionToken } = await t.mutation(componentApi.heartbeat, {
    roomId: "room1",
    userId: "user1",
    sessionId: "session1",
    interval: 1000,
  });

  await t.mutation(componentApi.disconnect, {
    sessionToken,
    scheduled: true,
  });

  await t.run(async (ctx) => {
    expect(await ctx.db.query("sessions").first()).not.toBeNull();
    expect(await ctx.db.query("sessionTokens").first()).not.toBeNull();
    expect(await ctx.db.query("presence").first()).toMatchObject({
      online: true,
    });
  });
});
