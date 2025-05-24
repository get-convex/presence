// Presence component.
//
// See ../client/index.ts for the public API.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

// TODO: send expires at to be 2.5x the heartbeat period
// TODO: have a global presence/beacon handler across components

export const heartbeat = mutation({
  args: {
    room: v.string(),
    user: v.string(),
  },
  handler: async (ctx, { room, user }) => {
    const presence = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (!presence) {
      await ctx.db.insert("presence", {
        room,
        user,
        updated: Date.now(),
      });
    } else {
      await ctx.db.patch(presence._id, {
        updated: Date.now(),
      });
    }
  },
});

// TODO: we don't want to subscribe on last updated since that changes all the time. just subscribe on online + last seen
// TODO: also don't read updated in the query since that'll get invalidated a lot. have a scheduled job to update the online status
export const list = query({
  args: {
    room: v.string(),
  },
  handler: async (ctx, { room }) => {
    return await ctx.db
      .query("presence")
      .withIndex("room_updated", (q) => q.eq("room", room))
      .order("desc")
      .take(100);
  },
});

export const disconnect = mutation({
  args: {
    room: v.string(),
    user: v.string(),
  },
  handler: async (_ctx, { room, user }) => {
    // TODO implementation of disconnect
    console.log("disconnect", room, user);
  },
});
