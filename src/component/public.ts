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
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      await ctx.db.insert("sessions", { roomId, userId, sessionId, deadline });
    } else if (session.roomId !== roomId || session.userId !== userId) {
      throw new Error(
        `sessionId ${sessionId} must be unique for a given room/user`,
      );
    } else {
      await ctx.db.patch("sessions", session._id, { deadline });
    }

    // Wake disconnect worker if potentially needed. Legacy sessions without
    // a deadline ping like new sessions, starting the worker post-upgrade.
    if (!session || deadline < (session.deadline ?? Infinity)) {
      await ping(ctx, components.batchWorker, {
        name: "disconnect",
        workQuery: internal.public.getExpiredSessions,
        workerMutation: internal.public.disconnectExpired,
        config: { debounceMs: 1000 },
      });
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

// Fetch expired sessions for disconnect BatchWorker.
export const getExpiredSessions = internalQuery({
  args: vBatchQueryArgs,
  returns: vBatchResult(
    v.object({
      sessionIds: v.array(v.id("sessions")),
    }),
  ),
  handler: async (ctx) => {
    const now = Date.now();
    // Return work if it exists.
    const expired = await ctx.db
      .query("sessions")
      .withIndex("deadline", (q) => q.lte("deadline", now))
      .take(DISCONNECT_BATCH);
    if (expired.length > 0) {
      return {
        kind: "work" as const,
        batch: {
          sessionIds: expired.map((session) => session._id),
        },
      };
    }

    // Tell worker to sleep until next deadline. Legacy deadline-less
    // sessions sort first in the index, so they always land in the expired
    // range above and `earliest` here has a deadline.
    const earliest = await ctx.db
      .query("sessions")
      .withIndex("deadline")
      .order("asc")
      .first();
    return {
      kind: "idle" as const,
      // Skip BatchWorker's default cooldown: session deadlines already tell
      // us exactly when to wake, and pings can interrupt this idle wait.
      cooldownMs: 0,
      timeoutMs:
        earliest?.deadline !== undefined ? earliest.deadline - now : undefined,
    };
  },
});

// Process disconnections passed in from BatchWorker. The batch comes from a
// snapshot query, so skip sessions that have since heartbeated or disconnected.
// Rerun immediately afterward so BatchWorker can establish an OCC dependency
// before entering its interruptible idle wait.
export const disconnectExpired = internalMutation({
  args: {
    sessionIds: v.array(v.id("sessions")),
  },
  handler: async (ctx, { sessionIds }) => {
    for (const sessionId of sessionIds) {
      const session = await ctx.db.get("sessions", sessionId);
      if (!session) {
        continue;
      }
      if (session.deadline === undefined) {
        // Legacy pre-worker session: give it one default heartbeat period to
        // check in rather than assuming it's gone.
        await ctx.db.patch("sessions", session._id, {
          deadline: Date.now() + 10000 * 2.5,
        });
      } else if (session.deadline <= Date.now()) {
        await disconnectSession(ctx, session);
      }
    }
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
    // Set by timeouts scheduled by the previous implementation. The worker
    // owns timeouts now, so these are ignored.
    scheduled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { sessionToken, scheduled }) => {
    const sessionTokenRecord = await ctx.db
      .query("sessionTokens")
      .withIndex("token", (q) => q.eq("token", sessionToken))
      .unique();
    if (!sessionTokenRecord) {
      return null;
    }
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) =>
        q.eq("sessionId", sessionTokenRecord.sessionId),
      )
      .unique();
    // Preserve legacy scheduled disconnects for sessions that haven't
    // heartbeated since upgrading. Once a heartbeat assigns a deadline, the
    // worker owns the timeout and the old scheduled call is stale.
    if (scheduled && session?.deadline !== undefined) {
      return null;
    }
    if (session) {
      await disconnectSession(ctx, session);
    } else {
      console.error("Session token without a session", sessionToken);
      await ctx.db.delete("sessionTokens", sessionTokenRecord._id);
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

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) =>
        q.eq("roomId", roomId).eq("userId", userId),
      )
      .collect();
    for (const session of sessions) {
      await deleteSessionAndToken(ctx, session);
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
      await deleteSessionAndToken(ctx, session);
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

async function deleteSessionAndToken(
  ctx: MutationCtx,
  session: Doc<"sessions">,
) {
  await ctx.db.delete("sessions", session._id);
  const sessionToken = await ctx.db
    .query("sessionTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
    .unique();
  if (sessionToken) {
    await ctx.db.delete("sessionTokens", sessionToken._id);
  }
}

// Disconnect a session, marking its user offline if it was their last session
// in the room. Shared by graceful disconnects and worker timeouts.
async function disconnectSession(ctx: MutationCtx, session: Doc<"sessions">) {
  const { roomId, userId, sessionId } = session;
  await deleteSessionAndToken(ctx, session);

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
