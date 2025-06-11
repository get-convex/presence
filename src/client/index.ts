import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";

export class Presence<RoomId extends string = string, UserId extends string = string> {
  /**
   * The Presence component tracks the presence of users in a room.
   * A "room" can be anything - a chat room, a document, a game, etc.
   * It is usually, but need not be, a Convex ID.
   *
   * See [../react/index.ts](../react/index.ts) for the usePresence hook that
   * maintains presence in a client-side React component and
   * [public.ts](../component/public.ts) for the implementation of these
   * functions.
   */
  constructor(private component: UseApi<typeof api>) {}

  /**
   * Keepalive heartbeat mutation. Session ID must be unique for a given room/user.
   * Interval is the time between heartbeats. User will be disconnected if no
   * heartbeat is received for 2.5x the interval or if a graceful disconnect
   * message is received. Returns room and session tokens.
   */
  async heartbeat(
    ctx: RunMutationCtx,
    roomId: RoomId,
    userId: UserId,
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

  /** List presence state for all users in the room, up to the limit of users. */
  async list(ctx: RunQueryCtx, roomToken: string, limit: number = 104) {
    return ctx.runQuery(this.component.public.list, { roomToken, limit }) as Promise<
      { userId: UserId; online: boolean; lastDisconnected: number }[]
    >;
  }

  /** Gracefully disconnect a user. */
  async disconnect(ctx: RunMutationCtx, sessionToken: string) {
    return ctx.runMutation(this.component.public.disconnect, { sessionToken });
  }

  /**
   * Remove a user from a room. If you need to track which rooms a user is in
   * you can store this in your calling application.
   */
  async removeRoomUser(ctx: RunMutationCtx, roomId: RoomId, userId: UserId) {
    return ctx.runMutation(this.component.public.removeRoomUser, { roomId, userId });
  }

  /** Remove a room. */
  async removeRoom(ctx: RunMutationCtx, roomId: RoomId) {
    return ctx.runMutation(this.component.public.removeRoom, { roomId });
  }
}
