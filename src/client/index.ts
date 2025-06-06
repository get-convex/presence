import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";

// Wrapper around Presence component for use in Convex server functions.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component and ../component/public.ts for the implementation
// of these functions.
export class Presence {
  constructor(private component: UseApi<typeof api>) {}

  // Keepalive heartbeat mutation. Interval is the time between heartbeats. User
  // will be disconnected if no heartbeat is received for 2.5x the interval or if
  // a graceful disconnect message is received. Returns room and session tokens.
  async heartbeat(
    ctx: RunMutationCtx,
    roomId: string,
    userId: string,
    sessionId: string,
    interval: number
  ) {
    return ctx.runMutation(this.component.public.heartbeat, {
      roomId,
      userId,
      sessionId,
      interval,
    });
  }

  // List presence state for all users in the room, up to the limit of users.
  async list(ctx: RunQueryCtx, roomToken: string, limit: number = 104) {
    return ctx.runQuery(this.component.public.list, { roomToken, limit });
  }

  // Gracefully disconnect a user.
  async disconnect(ctx: RunMutationCtx, sessionToken: string) {
    return ctx.runMutation(this.component.public.disconnect, { sessionToken });
  }

  // Remove a user from a room. If you need to track which rooms a user is in
  // you can store this in your calling application.
  async removeRoomUser(ctx: RunMutationCtx, roomId: string, userId: string) {
    return ctx.runMutation(this.component.public.removeRoomUser, { roomId, userId });
  }

  // Remove a room.
  async removeRoom(ctx: RunMutationCtx, roomId: string) {
    return ctx.runMutation(this.component.public.removeRoom, { roomId });
  }
}
