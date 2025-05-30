import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { Presence } from "@convex-dev/presence";
import { getAuthUserId } from "@convex-dev/auth/server";

export const presence = new Presence(components.presence);

export const getUserId = query({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    return await getAuthUserId(ctx);
  },
});

// TODO if a user joins a room twice they'll be marked as offline when they leave once

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string(), interval: v.number() },
  handler: async (ctx, { room, user, interval }) => {
    console.log("sending heartbeat for room", room, "user", user, "with interval", interval);

    const userId = await getAuthUserId(ctx);
    if (userId === null || userId !== user) {
      // We should probably handle this more gracefully.
      throw new Error("Unauthorized");
    }

    return await presence.heartbeat(ctx, room, user, interval);
  },
});

export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, { roomToken }) => {
    console.log("listing presence for room token", roomToken);

    // Join presence state with user info.
    const presenceList = await presence.list(ctx, roomToken);
    const listWithUserInfo = await Promise.all(
      presenceList.map(async (entry) => {
        const user = await ctx.db.get(entry.user as Id<"users">);
        if (!user) {
          return entry;
        }
        return {
          ...entry,
          name: user?.name,
          image: user?.image,
        };
      })
    );

    return listWithUserInfo;
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
