import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string(), interval: v.number() },
  handler: async (ctx, { room, user, interval }) => {
    // TODO: Add your auth checks here.
    console.log("sending heartbeat for room", room, "user", user, "with interval", interval);
    return await presence.heartbeat(ctx, room, user, interval);
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
  args: { presenceToken: v.string() },
  handler: async (ctx, { presenceToken }) => {
    console.log("disconnecting presence token", presenceToken);
    return await presence.disconnect(ctx, presenceToken);
  },
});
