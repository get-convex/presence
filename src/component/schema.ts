import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // XXX instead of using room and user as unique keys use tokens
  // XXX add metadata

  // Main presence state for users in rooms. Room is a unique identifier for a
  // "room" which is a presence group, e.g., a chat room, a document, etc. User
  // is a unique identifier for a user in the room.
  presence: defineTable({
    room: v.string(),
    user: v.string(),
    online: v.boolean(),
    lastDisconnected: v.number(), // Timestamp of last disconnect.
  })
    .index("user", ["user"])
    .index("room_user", ["room", "user"])
    .index("room_order", ["room", "online", "lastDisconnected"]),

  // A record of secret tokens used to identify users in a room. This allows us
  // to avoid auth for the list, heartbeat and disconnect functions.
  tokens: defineTable({
    token: v.string(),
    room: v.string(),
    user: v.string(),
  }).index("token", ["token"]),

  // A record of scheduled jobs that are used to disconnect users that have
  // transitioned to offline. This is stored as a separate table so queries
  // can subscribe to the `presence` table and not get woken up unless a user
  // transitions to online or offline.
  scheduledDisconnections: defineTable({
    room: v.string(),
    user: v.string(),
    scheduledDisconnect: v.id("_scheduled_functions"),
  })
    .index("user", ["user"])
    .index("room_user", ["room", "user"]),
});
