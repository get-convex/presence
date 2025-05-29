// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";

// XXX deregister other tokens
// Register the user in the room and get a token. An optional expiresAfterMs
// delay will auto-expire the token and require the user to re-register. This
// typically shouldn't be exposed to end users and should be wrapped in some
// code that performs auth checks before allowing the user into the room.
export const register = mutation({
  args: {
    room: v.string(),
    user: v.string(),
    expiresAfterMs: v.optional(v.number()),
  },
  handler: async (ctx, { room, user, expiresAfterMs }) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("tokens", { token, room, user });
    if (expiresAfterMs) {
      await ctx.scheduler.runAfter(expiresAfterMs, api.public.deregister, { token });
    }
    return token;
  },
});

// Remove the ability to use the token to identify the user in the room.
export const deregister = mutation({
  args: {
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const tokenRecord = await ctx.db
      .query("tokens")
      .withIndex("token", (q) => q.eq("token", token))
      .unique();
    if (!tokenRecord) {
      throw new Error("Invalid token");
    }
    await ctx.db.delete(tokenRecord._id);
  },
});

// Remove the user from the room.
// This typically shouldn't be exposed to end users
export const remove = mutation({
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
      throw new Error("User not in room");
    }
    await ctx.db.delete(state._id);
    const scheduledDisconnect = await ctx.db
      .query("scheduledDisconnections")
      .withIndex("room_user", (q) => q.eq("room", room).eq("user", user))
      .unique();
    if (scheduledDisconnect) {
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
      await ctx.db.delete(scheduledDisconnect._id);
    }
  },
});

// Remove user from all rooms.
// XXX invalidate tokens
export const removeUser = mutation({
  args: {
    user: v.string(),
  },
  handler: async (ctx, { user }) => {
    const states = await ctx.db
      .query("presence")
      .withIndex("user", (q) => q.eq("user", user))
      .collect();
    for (const state of states) {
      await ctx.db.delete(state._id);
    }
    const scheduledDisconnects = await ctx.db
      .query("scheduledDisconnections")
      .withIndex("user", (q) => q.eq("user", user))
      .collect();
    for (const scheduledDisconnect of scheduledDisconnects) {
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
      await ctx.db.delete(scheduledDisconnect._id);
    }
  },
});

// Remove room.
// XXX invalidate tokens
export const removeRoom = mutation({
  args: {
    room: v.string(),
  },
  handler: async (ctx, { room }) => {
    // XXX paginate
    const states = await ctx.db
      .query("presence")
      .withIndex("room_user", (q) => q.eq("room", room))
      .collect();
    for (const state of states) {
      await ctx.db.delete(state._id);
    }
    const scheduledDisconnects = await ctx.db
      .query("scheduledDisconnections")
      .withIndex("room_user", (q) => q.eq("room", room))
      .collect();
    for (const scheduledDisconnect of scheduledDisconnects) {
      await ctx.scheduler.cancel(scheduledDisconnect.scheduledDisconnect);
      await ctx.db.delete(scheduledDisconnect._id);
    }
  },
});

// Keepalive hearbeat mutation. The interval is the time between heartbeats. The
// user will be disconnected if no heartbeat is received for 2.5x the interval
// or if a graceful disconnect message is received.
export const heartbeat = mutation({
  args: {
    token: v.string(),
    interval: v.optional(v.number()),
  },
  handler: async (ctx, { token, interval = 10000 }) => {
    const tokenRecord = await ctx.db
      .query("tokens")
      .withIndex("token", (q) => q.eq("token", token))
      .unique();
    if (!tokenRecord) {
      throw new Error("Invalid token");
    }
    const { room, user } = tokenRecord;

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
      { token }
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
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { token, limit = 104 }) => {
    // Gracefully handle first renders where the token is not yet set.
    if (!token) {
      console.log("ignoring missing token");
      return [];
    }

    const tokenRecord = await ctx.db
      .query("tokens")
      .withIndex("token", (q) => q.eq("token", token))
      .unique();
    if (!tokenRecord) {
      throw new Error("Invalid token");
    }
    const { room } = tokenRecord;

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
    token: v.string(),
  },
  handler: async (ctx, { token }) => {
    const tokenRecord = await ctx.db
      .query("tokens")
      .withIndex("token", (q) => q.eq("token", token))
      .unique();
    if (!tokenRecord) {
      throw new Error("Invalid token");
    }
    const { room, user } = tokenRecord;

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
