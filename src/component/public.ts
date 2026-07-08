// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../client/index.ts for the Presence class that
// can be used in Convex server functions.
//
// Heartbeats bump a disconnect deadline for a session and a background
// batch-worker loop disconnects sessions that pass their deadline.

import { v } from "convex/values";
import { ping, vBatchQueryArgs, vBatchResult } from "@convex-dev/batch-worker";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import { components, internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";

// Max sessions to disconnect per worker transaction.
const DISCONNECT_BATCH = 64;

// Longest the worker loop sleeps between checks while any session exists.
// Kept at or below the loop's pollIntervalMs so the loop sleeps in its
// "running" state, where heartbeat pings are read-only no-ops: a burst of
// room joins neither interrupts nor OCC-conflicts with the sleeping loop.
// The cost is one cheap wakeup per 30s while the deployment has sessions,
// and up to 30s of extra disconnect latency for a session whose deadline
// lands earlier than all existing ones (only possible when a client shrinks
// its heartbeat interval). With the default 10s interval, deadlines are at
// most 25s out, so wakeups land exactly on the earliest deadline.
const MAX_WORKER_SLEEP_MS = 30_000;

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.optional(v.number()),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, { roomId, userId, sessionId, interval = 10000 }) => {
    // Time out session if no heartbeat again within 2.5x interval.
    const deadline = Date.now() + interval * 2.5;

    // Create session or bump deadline.
    let sessionToken: string;
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      sessionToken = crypto.randomUUID();
      await ctx.db.insert("sessions", {
        roomId,
        userId,
        sessionId,
        deadline,
        token: sessionToken,
      });
      // Wake disconnect worker if fully idle.
      await ping(ctx, components.batchWorker, {
        name: "disconnect",
        workQuery: internal.public.getExpiredSessions,
        workerMutation: internal.public.disconnectExpired,
      });
    } else if (session.roomId !== roomId || session.userId !== userId) {
      throw new Error(
        `sessionId ${sessionId} must be unique for a given room/user`,
      );
    } else {
      sessionToken = session.token;
      await ctx.db.patch("sessions", session._id, { deadline });
    }

    // Set user online if needed.
    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      await ctx.db.insert("presence", {
        roomId,
        userId,
        online: true,
        lastDisconnected: 0,
      });
    } else if (!userPresence.online) {
      await ctx.db.patch("presence", userPresence._id, {
        online: true,
        lastDisconnected: 0,
      });
    }

    // Fetch/generate token to list room presence.
    let roomToken: string;
    const roomTokenRecord = await ctx.db
      .query("roomTokens")
      .withIndex("room", (q) => q.eq("roomId", roomId))
      .unique();
    if (roomTokenRecord) {
      roomToken = roomTokenRecord.token;
    } else {
      roomToken = crypto.randomUUID();
      await ctx.db.insert("roomTokens", { roomId, token: roomToken });
    }

    return { roomToken, sessionToken };
  },
});

// Work query for the disconnect worker: reports whether any session is past
// its deadline and, if not, when the earliest one could expire. The worker
// mutation finds the expired sessions itself, so the batch carries no data.
export const getExpiredSessions = internalQuery({
  args: vBatchQueryArgs,
  returns: vBatchResult(v.object({})),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .withIndex("deadline", (q) => q.lte("deadline", now))
      .first();
    if (expired) {
      return { kind: "work" as const, batch: {} };
    }

    // Nothing expired: sleep until the earliest deadline could pass (capped
    // at MAX_WORKER_SLEEP_MS to stay in the ping-absorbing running state).
    // With no sessions at all, go fully idle — the next session-creating
    // heartbeat pings the loop awake. Since extend-only heartbeats don't
    // ping, the loop wakes at most once per heartbeat interval (sleeping on
    // a deadline that has since been extended) plus once per actual
    // disconnect, no matter how many sessions exist.
    const earliest = await ctx.db
      .query("sessions")
      .withIndex("deadline")
      .order("asc")
      .first();
    return {
      kind: "idle" as const,
      // Skip the post-work cooldown polling: go straight back to sleep.
      cooldownMs: 0,
      pollIntervalMs: MAX_WORKER_SLEEP_MS,
      timeoutMs: earliest
        ? Math.min(earliest.deadline - now, MAX_WORKER_SLEEP_MS)
        : undefined,
    };
  },
});

// Worker mutation for the disconnect worker: disconnects a batch of expired
// sessions. It reads them itself rather than taking them from the work query,
// so it only ever acts on state read in this transaction.
export const disconnectExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("sessions")
      .withIndex("deadline", (q) => q.lte("deadline", Date.now()))
      .take(DISCONNECT_BATCH);
    for (const session of expired) {
      await disconnectSession(ctx, session);
    }
    return null; // rerun immediately; the loop re-queries for more
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, { roomToken, limit = 104 }) => {
    if (!roomToken) {
      return [];
    }
    const roomTokenRecord = await ctx.db
      .query("roomTokens")
      .withIndex("token", (q) => q.eq("token", roomToken))
      .unique();
    if (!roomTokenRecord) {
      return [];
    }
    const { roomId } = roomTokenRecord;

    // Order by online, then lastDisconnected.
    const online = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("roomId", roomId).eq("online", true))
      .take(limit);
    const offline = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) =>
        q.eq("roomId", roomId).eq("online", false),
      )
      .order("desc")
      .take(limit - online.length);
    const results = [...online, ...offline];
    return results.map(({ userId, online, lastDisconnected, data }) => ({
      userId,
      online,
      lastDisconnected,
      data,
    })) as Array<{
      userId: string;
      online: boolean;
      lastDisconnected: number;
      data?: unknown;
    }>;
  },
});

export const listRoom = query({
  args: {
    roomId: v.string(),
    onlineOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
    }),
  ),
  handler: async (ctx, { roomId, onlineOnly = false, limit = 104 }) => {
    const online = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("roomId", roomId).eq("online", true))
      .take(limit);
    const offline = onlineOnly
      ? []
      : await ctx.db
          .query("presence")
          .withIndex("room_order", (q) =>
            q.eq("roomId", roomId).eq("online", false),
          )
          .order("desc")
          .take(limit - online.length);
    const results = [...online, ...offline];
    return results.map(({ userId, online, lastDisconnected }) => ({
      userId,
      online,
      lastDisconnected,
    }));
  },
});

export const listUser = query({
  args: {
    userId: v.string(),
    onlineOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      roomId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
    }),
  ),
  handler: async (ctx, { userId, onlineOnly = false, limit = 104 }) => {
    const online = await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) =>
        q.eq("userId", userId).eq("online", true),
      )
      .take(limit);
    const offline = onlineOnly
      ? []
      : await ctx.db
          .query("presence")
          .withIndex("user_online_room", (q) =>
            q.eq("userId", userId).eq("online", false),
          )
          .order("desc")
          .take(limit - online.length);
    const results = [...online, ...offline];
    return results.map(({ roomId, online, lastDisconnected }) => ({
      roomId,
      online,
      lastDisconnected,
    }));
  },
});

export const disconnect = mutation({
  args: {
    sessionToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("token", (q) => q.eq("token", sessionToken))
      .unique();
    // Idempotent: the session may already have timed out or disconnected.
    if (session) {
      await disconnectSession(ctx, session);
    }
    return null;
  },
});

export const updateRoomUser = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    data: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, userId, data }) => {
    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      console.warn("User not in room", roomId, userId);
      return null;
    }
    await ctx.db.patch("presence", userPresence._id, { data });
    return null;
  },
});

export const removeRoomUser = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { roomId, userId }) => {
    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      console.warn("User not in room", roomId, userId);
      return null;
    }
    await ctx.db.delete("presence", userPresence._id);

    // Remove the user from all sessions. No timeout bookkeeping needed: if
    // one of these held the earliest deadline, the worker wakes at the stale
    // time, finds nothing expired, and re-schedules.
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) =>
        q.eq("roomId", roomId).eq("userId", userId),
      )
      .collect();
    for (const session of sessions) {
      await ctx.db.delete("sessions", session._id);
    }
    return null;
  },
});

// TODO: this could hit limits and should return a continuation token
export const removeRoom = mutation({
  args: {
    roomId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { roomId }) => {
    const presenceRecords = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("roomId", roomId))
      .collect();
    for (const presence of presenceRecords) {
      await ctx.db.delete("presence", presence._id);
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("roomId", roomId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete("sessions", session._id);
    }

    const roomToken = await ctx.db
      .query("roomTokens")
      .withIndex("room", (q) => q.eq("roomId", roomId))
      .unique();
    if (roomToken) {
      await ctx.db.delete("roomTokens", roomToken._id);
    }
  },
});

async function getUserPresence(ctx: QueryCtx, userId: string, roomId: string) {
  return (
    (await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) =>
        q.eq("userId", userId).eq("online", true).eq("roomId", roomId),
      )
      .unique()) ||
    (await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) =>
        q.eq("userId", userId).eq("online", false).eq("roomId", roomId),
      )
      .unique())
  );
}

// Disconnect a session, marking its user offline if it was their last session
// in the room. Shared by graceful disconnects and worker timeouts.
async function disconnectSession(ctx: MutationCtx, session: Doc<"sessions">) {
  const { roomId, userId, sessionId } = session;
  await ctx.db.delete("sessions", session._id);

  // Mark user offline if they don't have any remaining sessions.
  const remainingSession = await ctx.db
    .query("sessions")
    .withIndex("room_user_session", (q) =>
      q.eq("roomId", roomId).eq("userId", userId),
    )
    .first();
  if (!remainingSession) {
    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      console.error("Session", sessionId, "had no presence record");
      return;
    }
    if (userPresence.online) {
      await ctx.db.patch("presence", userPresence._id, {
        online: false,
        lastDisconnected: Date.now(),
      });
    }
  }
}

// TODO: rotate the room tokens
