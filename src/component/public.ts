// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";

// Keepalive hearbeat mutation. The interval is the time between heartbeats. The
// user will be disconnected if no heartbeat is received for 2.5x the interval
// or if a graceful disconnect message is received.
export const heartbeat = mutation({
  args: {
    room: v.string(),
    user: v.string(),
    interval: v.optional(v.number()),
  },
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
      if (!scheduledDisconnect) {
        throw new Error("state online with no scheduled disconnect");
      }
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
      await ctx.db.delete(scheduledDisconnect._id);
    }

    // Schedule disconnect if no heartbeat for 2.5x heartbeat period and no graceful disconnect.
    const scheduledDisconnect = await ctx.scheduler.runAfter(
      interval * 2.5,
      api.public.disconnect,
      {
        room,
        user,
      }
    );
    await ctx.db.insert("scheduledDisconnections", {
      room,
      user,
      scheduledDisconnect,
    });
  },
});

// List presence state for all users in the room, up to the limit of users.
export const list = query({
  args: {
    room: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { room, limit = 104 }) => {
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

// Gracefully disconnect a user.
export const disconnect = mutation({
  args: {
    room: v.string(),
    user: v.string(),
  },
  handler: async (ctx, { room, user }) => {
    const state = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!state) {
      return;
    }
    if (!state.online) {
      return;
    }

    const scheduledDisconnect = await ctx.db
      .query("scheduledDisconnections")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!scheduledDisconnect) {
      throw new Error("state online with no scheduled disconnect");
    }
    await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
    await ctx.db.delete(scheduledDisconnect._id);

    await ctx.db.patch(state._id, {
      online: false,
      lastDisconnected: Date.now(),
    });
  },
});
