import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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

  // Temporary tokens granting access to list presence in a room. These allow
  // all members to share the same cached query while offering some security.
  roomTokens: defineTable({
    token: v.string(),
    room: v.string(),
  })
    .index("token", ["token"])
    .index("room", ["room"]),

  // Temporary tokens granting access to user operations in a room. These allow
  // running disconnect etc without auth.
  presenceTokens: defineTable({
    token: v.string(),
    user: v.string(),
    room: v.string(),
  })
    .index("token", ["token"])
    .index("room_user", ["room", "user"]),

  // A record of scheduled jobs that are used to disconnect users that have
  // transitioned to offline. This is stored as a separate table so queries
  // can subscribe to the `presence` table and not get woken up unless a user
  // transitions to online or offline.
  scheduledDisconnections: defineTable({
    room: v.string(),
    user: v.string(),
    scheduledDisconnect: v.id("_scheduled_functions"),
  }).index("room_user", ["room", "user"]),
});
