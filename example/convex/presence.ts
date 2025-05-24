import { mutation, query } from "./_generated/server";
import { Presence } from "../../src/client";
import { components } from "./_generated/api";
import { v } from "convex/values";

export const presence = new Presence(components.presence);

// TODO: we should just allow you to call component functions directly from the
// client so you don't have to redefine all this stuff

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string(), interval: v.number() },
  handler: async (ctx, { room, user, interval }) => {
    return await presence.heartbeat(ctx, { room, user, interval });
  },
});

export const list = query({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    return await presence.list(ctx, {
      room,
    });
  },
});

export const disconnect = mutation({
  args: { room: v.string(), user: v.string() },
  handler: async (ctx, { room, user }) => {
    return await presence.disconnect(ctx, { room, user });
  },
});
