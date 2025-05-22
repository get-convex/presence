import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  presence: defineTable({
    room: v.string(),
    user: v.string(),
    updated: v.number(),
  }).index("room_user", ["room", "user"]),
});
