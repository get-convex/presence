import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Main presence state for users in rooms.
  presence: defineTable({
    roomId: v.string(), // Unit of presence, e.g., chat room, document, etc.
    userId: v.string(), // Unique identifier for a user in the room.
    online: v.boolean(), // Whether any user session is online.
    lastDisconnected: v.number(), // Timestamp of last disconnect.
  })
    .index("room_user", ["roomId", "userId"])
    .index("room_order", ["roomId", "online", "lastDisconnected"]),

  // Individual sessions for each browser tab/connection.
  sessions: defineTable({
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
  })
    .index("room_user_session", ["roomId", "userId", "sessionId"])
    .index("sessionId", ["sessionId"]),

  // Temporary tokens to list presence in a room. These allow all members to
  // share the same cached query while offering some security.
  roomTokens: defineTable({
    token: v.string(),
    roomId: v.string(),
  })
    .index("token", ["token"])
    .index("room", ["roomId"]),

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
