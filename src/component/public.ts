// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../client/index.ts for the Presence class that
// can be used in Convex server functions.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";

// TODO: reinstate all the user management functions
// TODO: rotate the room tokens

// // Remove the user from the room.
// // This typically shouldn't be exposed to end users
// export const remove = mutation({
//   args: {
//     room: v.string(),
//     user: v.string(),
//   },
//   handler: async (ctx, { room, user }) => {
//     const state = await ctx.db
//       .query("presence")
//       .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
//       .unique();
//     if (!state) {
//       throw new ConvexError("User not in room");
//     }
//     await ctx.db.delete(state._id);
//     const scheduledDisconnect = await ctx.db
//       .query("sessionTimeouts")
//       .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
//       .unique();
//     if (scheduledDisconnect) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledFunctionId);
//       await ctx.db.delete(scheduledDisconnect._id);
//     }
//   },
// });

// // Remove user from all rooms.
// // TODO invalidate tokens
// export const removeUser = mutation({
//   args: {
//     user: v.string(),
//   },
//   handler: async (ctx, { user }) => {
//     const states = await ctx.db
//       .query("presence")
//       .withIndex("user", (q) => q.eq("user", user))
//       .collect();
//     for (const state of states) {
//       await ctx.db.delete(state._id);
//     }
//     const scheduledDisconnects = await ctx.db
//       .query("sessionTimeouts")
//       .withIndex("user", (q) => q.eq("user", user))
//       .collect();
//     for (const scheduledDisconnect of scheduledDisconnects) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledFunctionId);
//       await ctx.db.delete(scheduledDisconnect._id);
//     }
//   },
// });

// // Remove room.
// // TODO invalidate tokens
// export const removeRoom = mutation({
//   args: {
//     room: v.string(),
//   },
//   handler: async (ctx, { room }) => {
//     // TODO paginate
//     const states = await ctx.db
//       .query("presence")
//       .withIndex("room_user", (q) => q.eq("room", room))
//       .collect();
//     for (const state of states) {
//       await ctx.db.delete(state._id);
//     }
//     const scheduledDisconnects = await ctx.db
//       .query("sessionTimeouts")
//       .withIndex("room_user", (q) => q.eq("room", room))
//       .collect();
//     for (const scheduledDisconnect of scheduledDisconnects) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledFunctionId);
//       await ctx.db.delete(scheduledDisconnect._id);
//     }
//   },
// });

export const heartbeat = mutation({
  args: {
    room: v.string(),
    user: v.string(),
    sessionId: v.string(),
    interval: v.optional(v.number()),
  },
  returns: v.object({
    roomToken: v.string(),
    sessionToken: v.string(),
  }),
  handler: async (ctx, { room, user, sessionId, interval = 10000 }) => {
    // Update or create session
    const session = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) =>
        q.eq("room", room).eq("user", user).eq("sessionId", sessionId)
      )
      .unique();
    if (!session) {
      await ctx.db.insert("sessions", { room, user, sessionId });
    }

    // Set user online if needed.
    const userPresence = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!userPresence) {
      await ctx.db.insert("presence", { room, user, online: true, lastDisconnected: 0 });
    } else if (!userPresence.online) {
      await ctx.db.patch(userPresence._id, { online: true, lastDisconnected: 0 });
    }

    // Cancel any existing timeout for session.
    const existingTimeout = await ctx.db
      .query("sessionTimeouts")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (existingTimeout) {
      await ctx.scheduler.cancel(existingTimeout.scheduledFunctionId);
      await ctx.db.delete(existingTimeout._id);
    }

    // Generate token to list room presence.
    let roomToken: string;
    const roomTokenRecord = await ctx.db
      .query("roomTokens")
      .withIndex("room", (q) => q.eq("room", room))
      .unique();
    if (roomTokenRecord) {
      roomToken = roomTokenRecord.token;
    } else {
      roomToken = crypto.randomUUID();
      await ctx.db.insert("roomTokens", { room, token: roomToken });
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

    // Schedule timeout heartbeat for 2.5x heartbeat period.
    const timeout = await ctx.scheduler.runAfter(interval * 2.5, api.public.disconnect, {
      sessionToken: sessionToken,
    });
    await ctx.db.insert("sessionTimeouts", { sessionId, scheduledFunctionId: timeout });

    return { roomToken, sessionToken: sessionToken };
  },
});

export const list = query({
  args: {
    roomToken: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      user: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
    })
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
    const { room } = roomTokenRecord;

    // Order by online, then lastDisconnected.
    const online = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("room", room).eq("online", true))
      .take(limit);
    const offline = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("room", room).eq("online", false))
      .order("desc")
      .take(limit - online.length);
    const results = [...online, ...offline];
    return results.map(({ user, online, lastDisconnected }) => ({
      user,
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
    await ctx.db.delete(sessionTokenRecord._id);
    const { sessionId } = sessionTokenRecord;

    // Remove the session
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      console.error("Should not have a session token", sessionToken, "without a session");
      return;
    }

    const { room, user } = session;
    await ctx.db.delete(session._id);

    const userPresence = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!userPresence) {
      console.error("Should not have a session token", sessionToken, "without a user presence");
      return;
    }

    // Mark user offline if they don't have any remaining sessions.
    const remainingSessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("room", room).eq("user", user))
      .collect();
    if (userPresence.online && remainingSessions.length === 0) {
      await ctx.db.patch(userPresence._id, { online: false, lastDisconnected: Date.now() });
    }

    // Cancel timeout for this session.
    const timeout = await ctx.db
      .query("sessionTimeouts")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (timeout) {
      await ctx.scheduler.cancel(timeout.scheduledFunctionId);
      await ctx.db.delete(timeout._id);
    }
  },
});
