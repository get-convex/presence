import { mutation, query } from "./_generated/server";
import { Presence } from "../../src/client";
import { components } from "./_generated/api";
import { v } from "convex/values";

const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string() },
  handler: async (ctx, { room, user }) => {
    return await presence.heartbeat(ctx, { room, user });
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
