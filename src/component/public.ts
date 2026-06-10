// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../client/index.ts for the Presence class that
// can be used in Convex server functions.

import { v } from "convex/values";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";

// A session is disconnected once this many heartbeat intervals elapse with no
// heartbeat (the disconnect timeout fires).
const TIMEOUT_INTERVAL_MULTIPLIER = 2.5;

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
    const now = Date.now();

    // Update or create the session. No per-beat write in the steady state: an
    // existing session for the same room/user is left untouched here (the
    // disconnect timeout below is what gets pushed out).
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      await ctx.db.insert("sessions", { roomId, userId, sessionId });
    } else if (session.roomId !== roomId || session.userId !== userId) {
      throw new Error(
        `sessionId ${sessionId} must be unique for a given room/user`,
      );
    }

    // Set user online if needed.
    //
    // Fast path: check whether the user is already online via a *snapshot*
    // query, which does not add the shared per-user presence row to this
    // mutation's read set. Reading that row directly here is the main source of
    // heartbeat OCC contention, because a concurrent `disconnect` writes it. In
    // the overwhelmingly common case (already online) we then do nothing, taking
    // no dependency on it at all.
    //
    // Only when we are not already online do we fall back to a tracked read and
    // create/patch the row under normal OCC protection — the snapshot result
    // alone must never drive the write, or two concurrent first beats could both
    // insert a presence row and break the `getUserPresence` uniqueness.
    const alreadyOnline = await runSnapshotQuery(ctx, { userId, roomId });
    if (!alreadyOnline) {
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

    // Maintain a single disconnect timeout for this session, scheduled to fire
    // `window` ahead. To keep the steady-state heartbeat cheap we do NOT
    // reschedule on every beat: the armed timeout is only pushed out when it is
    // getting close to firing — within a jittered fraction of the interval, so
    // concurrent sessions don't all reschedule on the same beat — or when a
    // shrunk interval needs it to fire sooner. Rescheduling updates the row in
    // place rather than deleting and re-inserting. The timeout itself rarely
    // runs: a graceful disconnect (sendBeacon on unload) cancels it first.
    const window = interval * TIMEOUT_INTERVAL_MULTIPLIER;
    const deadline = now + window;
    const existingTimeout = await ctx.db
      .query("sessionTimeouts")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .first();
    if (!existingTimeout) {
      const scheduledFunctionId = await ctx.scheduler.runAfter(
        window,
        internal.public.disconnectStaleSession,
        { sessionId },
      );
      await ctx.db.insert("sessionTimeouts", {
        sessionId,
        scheduledFunctionId,
        deadline,
      });
    } else {
      const armedDeadline = existingTimeout.deadline ?? 0;
      // Re-arm when the timeout is within ~1–1.5 intervals of firing (jittered,
      // so concurrent sessions don't all reschedule on the same beat), or when
      // the new window would fire sooner than what's armed. The lower bound of
      // one full interval guarantees a heartbeat lands inside the re-arm window
      // before the timeout could fire for a live session.
      const rearmWithin = interval * (1 + Math.random() * 0.5);
      if (armedDeadline - now <= rearmWithin || deadline < armedDeadline) {
        await ctx.scheduler.cancel(existingTimeout.scheduledFunctionId);
        const scheduledFunctionId = await ctx.scheduler.runAfter(
          window,
          internal.public.disconnectStaleSession,
          { sessionId },
        );
        await ctx.db.patch("sessionTimeouts", existingTimeout._id, {
          scheduledFunctionId,
          deadline,
        });
      }
    }

    return { roomToken, sessionToken: sessionToken };
  },
});

// The session's disconnect timeout, armed (and pushed out) by `heartbeat`. It
// fires only when heartbeats stop without a graceful disconnect — in the common
// case the sendBeacon `disconnect` on unload cancels it first. Unlike graceful
// `disconnect`, it must not cancel its own scheduled function (it is the one
// running), so it passes `cancelScheduled: false`.
export const disconnectStaleSession = internalMutation({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      // Already gone (e.g. graceful disconnect raced us). Clear any stray
      // timeout row so it can't strand a future session.
      const timeouts = await ctx.db
        .query("sessionTimeouts")
        .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
        .collect();
      for (const timeout of timeouts) {
        await ctx.db.delete("sessionTimeouts", timeout._id);
      }
      return null;
    }
    await removeSession(ctx, session, { cancelScheduled: false });
    return null;
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
      return;
    }
    const { sessionId } = sessionTokenRecord;

    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      console.error(
        "Should not have a session token",
        sessionToken,
        "without a session",
      );
      // Still clear the orphaned token.
      await ctx.db.delete("sessionTokens", sessionTokenRecord._id);
      return;
    }

    // Graceful disconnect cancels the still-pending timeout (it isn't firing us).
    await removeSession(ctx, session, { cancelScheduled: true });
  },
});

// Remove a session and its satellite rows (disconnect token and timeout),
// marking the user offline when it was their last session in the room. Shared
// by graceful `disconnect` (cancelScheduled: true) and the
// `disconnectStaleSession` timeout (cancelScheduled: false — the job firing it
// is already running, so there is nothing to cancel).
async function removeSession(
  ctx: MutationCtx,
  session: Doc<"sessions">,
  { cancelScheduled }: { cancelScheduled: boolean },
) {
  const { roomId, userId, sessionId } = session;
  await ctx.db.delete("sessions", session._id);

  const sessionTokenRecord = await ctx.db
    .query("sessionTokens")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .unique();
  if (sessionTokenRecord) {
    await ctx.db.delete("sessionTokens", sessionTokenRecord._id);
  }

  // Mark user offline if they don't have any remaining sessions.
  const userPresence = await getUserPresence(ctx, userId, roomId);
  if (userPresence?.online) {
    const remainingSession = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) =>
        q.eq("roomId", roomId).eq("userId", userId),
      )
      .first();
    if (!remainingSession) {
      await ctx.db.patch("presence", userPresence._id, {
        online: false,
        lastDisconnected: Date.now(),
      });
    }
  }

  // Clear the session's disconnect timeout(s). Normally there is exactly one;
  // collect to also clear any stray duplicate rather than throwing.
  const timeouts = await ctx.db
    .query("sessionTimeouts")
    .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
    .collect();
  for (const timeout of timeouts) {
    if (cancelScheduled) {
      await ctx.scheduler.cancel(timeout.scheduledFunctionId);
    }
    await ctx.db.delete("sessionTimeouts", timeout._id);
  }
}

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

    // Remove the user from all sessions.
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
      const timeout = await ctx.db
        .query("sessionTimeouts")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (timeout) {
        await ctx.scheduler.cancel(timeout.scheduledFunctionId);
        await ctx.db.delete("sessionTimeouts", timeout._id);
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

      const timeout = await ctx.db
        .query("sessionTimeouts")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (timeout) {
        await ctx.scheduler.cancel(timeout.scheduledFunctionId);
        await ctx.db.delete("sessionTimeouts", timeout._id);
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

// Whether the user is currently online in the room. Read by `heartbeat` via a
// snapshot query (see `runSnapshotQuery`) so the read does not enter the
// heartbeat's read set.
export const userPresenceOnline = internalQuery({
  args: { userId: v.string(), roomId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, roomId }) => {
    const presence = await getUserPresence(ctx, userId, roomId);
    return presence?.online === true;
  },
});

// `ctx.runSnapshotQuery` runs a query without recording its reads in the calling
// mutation's read set, so OCC won't retry the mutation when the queried rows
// change concurrently. It isn't in the generated `MutationCtx` type yet, so we
// narrow `ctx` to just the method we use.
type SnapshotQueryCtx = {
  runSnapshotQuery: (
    ref: typeof internal.public.userPresenceOnline,
    args: { userId: string; roomId: string },
  ) => Promise<boolean>;
};

function runSnapshotQuery(
  ctx: MutationCtx,
  args: { userId: string; roomId: string },
): Promise<boolean> {
  return (ctx as MutationCtx & SnapshotQueryCtx).runSnapshotQuery(
    internal.public.userPresenceOnline,
    args,
  );
}

// TODO: rotate the room tokens
