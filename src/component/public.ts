// Presence component.
//
// See ../client/index.ts for the public API.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";

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
