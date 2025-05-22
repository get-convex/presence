// Presence component.
//
// See ../client/index.ts for the public API.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

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

// TODO: make sure we don't hit limits
export const list = query({
  args: {
    room: v.string(),
  },
  handler: async (ctx, { room }) => {
    return await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room))
      .collect();
  },
});
