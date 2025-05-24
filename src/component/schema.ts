import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  presence: defineTable({
    room: v.string(),
    user: v.string(),
    online: v.boolean(),
    lastDisconnected: v.number(),
  })
    .index("room_user", ["room", "user"])
    .index("room_order", ["room", "online", "lastDisconnected"]),

  scheduledDisconnections: defineTable({
    room: v.string(),
    user: v.string(),
    scheduledDisconnect: v.id("_scheduled_functions"),
  }).index("room_user", ["room", "user"]),
});
