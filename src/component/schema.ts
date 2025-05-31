import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// TODO: rotate room tokens

export default defineSchema({
  // Main presence state for users in rooms.
  presence: defineTable({
    room: v.string(), // Unit of presence, e.g., chat room, document, etc.
    user: v.string(), // Unique identifier for a user in the room.
    online: v.boolean(), // Whether any user session is online.
    lastDisconnected: v.number(), // Timestamp of last disconnect.
  })
    .index("room_user", ["room", "user"])
    .index("room_order", ["room", "online", "lastDisconnected"]),

  // Individual sessions for each browser tab/connection.
  sessions: defineTable({
    room: v.string(),
    user: v.string(),
    sessionId: v.string(),
  })
    .index("room_user_session", ["room", "user", "sessionId"])
    .index("sessionId", ["sessionId"]),

  // Temporary tokens to list presence in a room. These allow all members to
  // share the same cached query while offering some security.
  roomTokens: defineTable({
    token: v.string(),
    room: v.string(),
  })
    .index("token", ["token"])
    .index("room", ["room"]),

  // Temporary tokens to disconnect individual sessions.
  sessionTokens: defineTable({
    token: v.string(),
    sessionId: v.string(),
  })
    .index("token", ["token"])
    .index("sessionId", ["sessionId"]),

  // Scheduled jobs to disconnect sessions after timeout.
  sessionTimeouts: defineTable({
    sessionId: v.string(),
    scheduledFunctionId: v.id("_scheduled_functions"),
  }).index("sessionId", ["sessionId"]),
});
