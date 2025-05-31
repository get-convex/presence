import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
// TODO change to "@convex-dev/presence"
import { Presence } from "../../src/client";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string(), sessionId: v.string(), interval: v.number() },
  handler: async (ctx, { room, user, sessionId, interval }) => {
    // TODO: Add your auth checks here.
    console.log(
      "sending heartbeat for room",
      room,
      "user",
      user,
      "session",
      sessionId,
      "with interval",
      interval
    );
    return await presence.heartbeat(ctx, room, user, sessionId, interval);
  },
});

export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => {
    // Avoid adding per-user reads so all subscriptions can share same cache.
    console.log("listing presence for room token", roomToken);
    return await presence.list(ctx, roomToken);
  },
});

// This gets called over the websocket but also over http from sendBeacon.
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, { sessionToken }) => {
    console.log("disconnecting session token", sessionToken);
    return await presence.disconnect(ctx, sessionToken);
  },
});
