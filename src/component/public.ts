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
// TODO: make sure this works with user metadata

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
    presenceToken: v.string(),
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
      await ctx.db.insert("sessions", {
        room,
        user,
        sessionId,
      });
    }

    // Update user presence - since we have at least one active session, user should be online
    const userPresence = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();

    if (!userPresence) {
      await ctx.db.insert("presence", {
        room,
        user,
        online: true,
        lastDisconnected: 0,
      });
    } else if (!userPresence.online) {
      await ctx.db.patch(userPresence._id, {
        online: true,
        lastDisconnected: 0,
      });
    }

    // Cancel any existing scheduled disconnect for this session
    const existingScheduledDisconnect = await ctx.db
      .query("sessionTimeouts")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();

    if (existingScheduledDisconnect) {
      await ctx.scheduler.cancel(existingScheduledDisconnect.scheduledFunctionId);
      await ctx.db.delete(existingScheduledDisconnect._id);
    }

    // Generate tokens to list and disconnect.
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

    let presenceToken: string;
    const presenceTokenRecord = await ctx.db
      .query("sessionTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (presenceTokenRecord) {
      presenceToken = presenceTokenRecord.token;
    } else {
      presenceToken = crypto.randomUUID();
      await ctx.db.insert("sessionTokens", {
        sessionId,
        token: presenceToken,
      });
    }

    // Schedule disconnect for this session if no heartbeat for 2.5x heartbeat period
    const scheduledDisconnect = await ctx.scheduler.runAfter(
      interval * 2.5,
      api.public.disconnect,
      { presenceToken }
    );
    await ctx.db.insert("sessionTimeouts", {
      sessionId,
      scheduledFunctionId: scheduledDisconnect,
    });

    return { roomToken, presenceToken };
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
    presenceToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { presenceToken }) => {
    const presenceTokenRecord = await ctx.db
      .query("sessionTokens")
      .withIndex("token", (q) => q.eq("token", presenceToken))
      .unique();
    if (!presenceTokenRecord) {
      return;
    }
    await ctx.db.delete(presenceTokenRecord._id);
    const { sessionId } = presenceTokenRecord;

    // Remove the session
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();

    if (!session) {
      return;
    }

    const { room, user } = session;
    await ctx.db.delete(session._id);

    // Check if user has any remaining active sessions
    const remainingSessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("room", room).eq("user", user))
      .collect();

    // Update user presence based on remaining sessions
    const userPresence = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();

    if (userPresence && userPresence.online && remainingSessions.length === 0) {
      // User has no more active sessions, mark them as offline
      await ctx.db.patch(userPresence._id, {
        online: false,
        lastDisconnected: Date.now(),
      });
    }

    // Cancel scheduled disconnect for this session
    const scheduledDisconnect = await ctx.db
      .query("sessionTimeouts")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();

    if (scheduledDisconnect) {
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledFunctionId);
      await ctx.db.delete(scheduledDisconnect._id);
    }
  },
});
