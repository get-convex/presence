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
//       .query("scheduledDisconnections")
//       .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
//       .unique();
//     if (scheduledDisconnect) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
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
//       .query("scheduledDisconnections")
//       .withIndex("user", (q) => q.eq("user", user))
//       .collect();
//     for (const scheduledDisconnect of scheduledDisconnects) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
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
//       .query("scheduledDisconnections")
//       .withIndex("room_user", (q) => q.eq("room", room))
//       .collect();
//     for (const scheduledDisconnect of scheduledDisconnects) {
//       await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
//       await ctx.db.delete(scheduledDisconnect._id);
//     }
//   },
// });

export const heartbeat = mutation({
  args: {
    room: v.string(),
    user: v.string(),
    interval: v.optional(v.number()),
  },
  returns: v.object({
    roomToken: v.string(),
    presenceToken: v.string(),
  }),
  handler: async (ctx, { room, user, interval = 10000 }) => {
    const state = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();

    if (!state) {
      await ctx.db.insert("presence", {
        room,
        user,
        online: true,
        lastDisconnected: 0,
      });
    } else if (!state.online) {
      await ctx.db.patch(state._id, {
        online: true,
        lastDisconnected: 0,
      });
    } else {
      const scheduledDisconnect = await ctx.db
        .query("scheduledDisconnections")
        .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
        .unique();
      if (scheduledDisconnect) {
        await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
        await ctx.db.delete(scheduledDisconnect._id);
      } else {
        console.error(`Expected scheduled disconnect for online user ${user} in room ${room}`);
      }
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
      .query("presenceTokens")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (presenceTokenRecord) {
      presenceToken = presenceTokenRecord.token;
    } else {
      presenceToken = crypto.randomUUID();
      await ctx.db.insert("presenceTokens", { user, room, token: presenceToken });
    }

    // Schedule disconnect if no heartbeat for 2.5x heartbeat period and no graceful disconnect.
    const scheduledDisconnect = await ctx.scheduler.runAfter(
      interval * 2.5,
      api.public.disconnect,
      { presenceToken }
    );
    await ctx.db.insert("scheduledDisconnections", {
      room,
      user,
      scheduledDisconnect,
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
      .query("presenceTokens")
      .withIndex("token", (q) => q.eq("token", presenceToken))
      .unique();
    if (!presenceTokenRecord) {
      return;
    }
    await ctx.db.delete(presenceTokenRecord._id);
    const { room, user } = presenceTokenRecord;

    const state = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!state || !state.online) {
      return;
    }
    await ctx.db.patch(state._id, {
      online: false,
      lastDisconnected: Date.now(),
    });

    const scheduledDisconnect = await ctx.db
      .query("scheduledDisconnections")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (scheduledDisconnect) {
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
      await ctx.db.delete(scheduledDisconnect._id);
    } else {
      console.error(`Expected scheduled disconnect for online user ${user} in room ${room}`);
    }
  },
});
