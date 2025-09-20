// Convex presence component implementation.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../client/index.ts for the Presence class that
// can be used in Convex server functions.

import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { Id } from "./_generated/dataModel.js";

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
    // Update or create session
    const session = await ctx.db
      .query("sessions")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) {
      await ctx.db.insert("sessions", { roomId, userId, sessionId });
    } else if (session.roomId !== roomId || session.userId !== userId) {
      throw new Error(`sessionId ${sessionId} must be unique for a given room/user`);
    }

    // Set user online if needed.
    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      await ctx.db.insert("presence", { roomId, userId, online: true, lastDisconnected: 0 });
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
      userId: v.string(),
      online: v.boolean(),
      lastDisconnected: v.number(),
      data: v.optional(v.any()),
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
    const { roomId } = roomTokenRecord;

    // Order by online, then lastDisconnected.
    const online = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("roomId", roomId).eq("online", true))
      .take(limit);
    const offline = await ctx.db
      .query("presence")
      .withIndex("room_order", (q) => q.eq("roomId", roomId).eq("online", false))
      .order("desc")
      .take(limit - online.length);
    const results = [...online, ...offline];
    return results.map(({ userId, online, lastDisconnected, data }) => ({
      userId,
      online,
      lastDisconnected,
      data,
    })) as Array<{ userId: string, online: boolean, lastDisconnected: number, data?: unknown }>;
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
    })
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
        .withIndex("room_order", (q) => q.eq("roomId", roomId).eq("online", false))
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

export const listAllUsers = query({
  args: {
    onlineOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
    limitRooms: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      userId: v.string(),
      rooms: v.array(v.object({
        online: v.boolean(),
        lastDisconnected: v.number(),
        roomId: v.string()
      }))
    })
  ),
  handler: async (ctx, { onlineOnly = false, limit = 104, limitRooms = 10 }) => {
    const online = await ctx.db
      .query("presence")
      .take(limit);

    const offline = onlineOnly
      ? []
      : await ctx.db
        .query("presence")
        .order("desc")
        .take(limit - online.length);


    const results = [...online, ...offline];

    const seen = new Set<string>();
    const duplicates = new Set<string>();


    for (const item of results) {
      if (seen.has(item.userId)) {
        duplicates.add(item.userId);
      } else {
        seen.add(item.userId);
      }
    }

    const userIds = Array.from(duplicates);

    const result: {
      userId: string,
      rooms: {
        roomId: string;
        online: boolean;
        lastDisconnected: number;
      }[]
    }[] = []

    userIds.forEach((userId) => {
      const rooms = results.filter((room) => room.userId === userId).map((room) => ({ roomId: room.roomId, online: room.online, lastDisconnected: room.lastDisconnected }));

      result.push({ userId, rooms: rooms.slice(0, limitRooms) })
    });

    return result;
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
    })
  ),
  handler: async (ctx, { userId, onlineOnly = false, limit = 104 }) => {
    const online = await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) => q.eq("userId", userId).eq("online", true))
      .take(limit);
    const offline = onlineOnly
      ? []
      : await ctx.db
        .query("presence")
        .withIndex("user_online_room", (q) => q.eq("userId", userId).eq("online", false))
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

    const { roomId, userId } = session;
    await ctx.db.delete(session._id);

    const userPresence = await getUserPresence(ctx, userId, roomId);
    if (!userPresence) {
      console.error("Should not have a session token", sessionToken, "without a user presence");
      return;
    }

    // Mark user offline if they don't have any remaining sessions.
    const remainingSessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("roomId", roomId).eq("userId", userId))
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
    await ctx.db.patch(userPresence._id, { data });
    return null
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
    await ctx.db.delete(userPresence._id);

    // Remove the user from all sessions.
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
      const sessionToken = await ctx.db
        .query("sessionTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (sessionToken) {
        await ctx.db.delete(sessionToken._id);
      }
      const timeout = await ctx.db
        .query("sessionTimeouts")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (timeout) {
        await ctx.scheduler.cancel(timeout.scheduledFunctionId);
        await ctx.db.delete(timeout._id);
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
      await ctx.db.delete(presence._id);
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("room_user_session", (q) => q.eq("roomId", roomId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);

      const sessionToken = await ctx.db
        .query("sessionTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (sessionToken) {
        await ctx.db.delete(sessionToken._id);
      }

      const timeout = await ctx.db
        .query("sessionTimeouts")
        .withIndex("sessionId", (q) => q.eq("sessionId", session.sessionId))
        .unique();
      if (timeout) {
        await ctx.scheduler.cancel(timeout.scheduledFunctionId);
        await ctx.db.delete(timeout._id);
      }
    }

    const roomToken = await ctx.db
      .query("roomTokens")
      .withIndex("room", (q) => q.eq("roomId", roomId))
      .unique();
    if (roomToken) {
      await ctx.db.delete(roomToken._id);
    }
  },
});

async function getUserPresence(ctx: QueryCtx, userId: string, roomId: string) {
  return (
    (await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) =>
        q.eq("userId", userId).eq("online", true).eq("roomId", roomId)
      )
      .unique()) ||
    (await ctx.db
      .query("presence")
      .withIndex("user_online_room", (q) =>
        q.eq("userId", userId).eq("online", false).eq("roomId", roomId)
      )
      .unique())
  );
}

// TODO: rotate the room tokens
