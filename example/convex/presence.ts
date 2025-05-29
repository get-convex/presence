import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";

export const presence = new Presence(components.presence);

export const register = mutation({
  args: { room: v.string(), user: v.string() },
  handler: async (ctx, { room, user }) => {
    // XXX do we need a custom callback for auth?

    // TODO: This is where you should perform auth, decide whether to let the
    // user into the room, etc.

    console.log("registering user", room, user);
    const token = await presence.register(ctx, room, user, 1000 * 60 * 60 * 24);
    console.log("received token", token);
    return token;
  },
});

export const heartbeat = mutation({
  args: { token: v.string(), interval: v.number() },
  handler: async (ctx, { token, interval }) => {
    console.log("sending heartbeat for token", token, "with interval", interval);
    return await presence.heartbeat(ctx, token, interval);
  },
});

export const list = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    console.log("listing presence for token", token);
    return await presence.list(ctx, token);
  },
});

export const disconnect = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    console.log("disconnecting token", token);
    return await presence.disconnect(ctx, token);
  },
});
