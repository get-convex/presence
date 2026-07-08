// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../client/index.ts for the Presence class that
// can be used in Convex server functions.
//
// Session timeouts are enforced by a single deployment-wide worker rather than
// per-session scheduled functions. Each heartbeat just bumps a deadline on its
// session row; a singleton @convex-dev/batch-worker loop sleeps until the
// earliest deadline in the deployment and disconnects sessions that pass it
// (see expiredSessions and disconnectExpired below).

import { v } from "convex/values";
import {
  ping,
  vBatchQueryArgs,
  vBatchResult,
  vWorkerResult,
} from "@convex-dev/batch-worker";
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

// Name of the singleton batch-worker loop that disconnects timed-out sessions.
const DISCONNECT_WORKER = "disconnect";

// Max sessions to disconnect per worker transaction, bounding transaction
// size during mass expiry (e.g., a large room dropping offline at once).
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

// Wake the disconnect worker's loop. Called whenever a write could move the
// deployment's earliest deadline *earlier* (a new session, or an interval
// shrink): only then can the loop's scheduled wakeup be too late. Cheap and
// idempotent: a read-only no-op while the loop is already running.
async function pingDisconnectWorker(ctx: MutationCtx) {
  await ping(ctx, components.batchWorker, {
    name: DISCONNECT_WORKER,
    workQuery: internal.public.expiredSessions,
    workerMutation: internal.public.disconnectExpired,
  });
}

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
    // A session times out if no heartbeat arrives within 2.5x the heartbeat
    // period. Bumping this deadline is the entire keepalive mechanism: the
    // disconnect worker watches the earliest deadline in the deployment.
    const deadline = Date.now() + interval * 2.5;

    // Update or create session. Deadlines normally only move later, so an
    // ordinary heartbeat doesn't need to wake the worker — its scheduled
    // wakeup is already early enough. Only a brand-new session (the loop may
    // be fully idle) or a deadline moving earlier (interval shrink) does.
    let needsPing = false;
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      await ctx.db.insert("sessions", { roomId, userId, sessionId, deadline });
      needsPing = true;
    } else if (session.roomId !== roomId || session.userId !== userId) {
      throw new Error(
        `sessionId ${sessionId} must be unique for a given room/user`,
      );
    } else {
      needsPing = deadline < session.deadline;
      await ctx.db.patch("sessions", session._id, { deadline });
    }
    if (needsPing) {
      await pingDisconnectWorker(ctx);
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

    // Generate token to list room presence.
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

    // Generate token to disconnect session.
    let sessionToken: string;
    const sessionTokenRecord = await ctx.db
      .query("sessionTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (sessionTokenRecord) {
      sessionToken = sessionTokenRecord.token;
    } else {
      sessionToken = crypto.randomUUID();
      await ctx.db.insert("sessionTokens", { sessionId, token: sessionToken });
    }

    return { roomToken, sessionToken };
  },
});

// Work query for the disconnect worker: returns the next batch of expired
// sessions, or idle with a hint for when the earliest deadline could expire.
export const expiredSessions = internalQuery({
  args: vBatchQueryArgs,
  returns: vBatchResult(v.object({ sessionIds: v.array(v.id("sessions")) })),
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("sessions")
      .withIndex("deadline", (q) => q.lte("deadline", now))
      .take(DISCONNECT_BATCH);
    if (expired.length > 0) {
      return {
        kind: "work" as const,
        batch: { sessionIds: expired.map((session) => session._id) },
      };
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

// Worker mutation for the disconnect worker: disconnects a batch of sessions
// found by expiredSessions. The batch comes from a snapshot read and may be
// stale, so re-validate every session against current state — it may have
// heartbeated (deadline extended) or disconnected since.
export const disconnectExpired = internalMutation({
  args: { sessionIds: v.array(v.id("sessions")) },
  returns: vWorkerResult,
  handler: async (ctx, { sessionIds }) => {
    for (const sessionId of sessionIds) {
      const session = await ctx.db.get("sessions", sessionId);
      if (!session || session.deadline > Date.now()) {
        continue; // already disconnected, or a heartbeat raced the snapshot
      }
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
    const sessionTokenRecord = await ctx.db
      .query("sessionTokens")
      .withIndex("token", (q) => q.eq("token", sessionToken))
      .unique();
    if (!sessionTokenRecord) {
      // Session already timed out or disconnected; disconnect is idempotent.
      return null;
    }
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) =>
        q.eq("sessionId", sessionTokenRecord.sessionId),
      )
      .unique();
    if (!session) {
      console.error(
        "Should not have a session token",
        sessionToken,
        "without a session",
      );
      await ctx.db.delete("sessionTokens", sessionTokenRecord._id);
      return null;
    }
    await disconnectSession(ctx, session);
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
      const sessionToken = await ctx.db
        .query("sessionTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (sessionToken) {
        await ctx.db.delete("sessionTokens", sessionToken._id);
      }
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

      const sessionToken = await ctx.db
        .query("sessionTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (sessionToken) {
        await ctx.db.delete("sessionTokens", sessionToken._id);
      }
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

  const sessionToken = await ctx.db
    .query("sessionTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
  if (sessionToken) {
    await ctx.db.delete("sessionTokens", sessionToken._id);
  }

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
