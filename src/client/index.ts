import type { RunMutationCtx, RunQueryCtx } from "./utils.js";
import type { ComponentApi } from "../component/_generated/component.js";

export class Presence<RoomId extends string = string, UserId extends string = string> {
  /**
   * The Presence component tracks the presence of users in a room.
   * A "room" is a unit of presence state, e.g., a chat room, document, game
   * etc. Rooms need a unique string ID that in many applications will just be a
   * Convex ID.
   *
   * See [../react/index.ts](../react/index.ts) for the usePresence hook that
   * maintains presence in a client-side React component and
   * [public.ts](../component/public.ts) for the implementation of these
   * functions.
   */
  constructor(private component: ComponentApi) {}

  /**
   * ============================================================================
   * MAIN PRESENCE FUNCTIONS
   * ============================================================================
   *
   * These functions are the core API for maintaining presence state.
   * They will typically be exposed directly to end users, with heartbeat
   * wrapped in authentication.
   */

  /**
   * Keepalive heartbeat mutation. Session ID must be unique for a given
   * room/user. Interval is the time between heartbeats. User will be
   * disconnected if no heartbeat is received for 2.5x the interval or if a
   * graceful disconnect message is received. Returns room and session tokens.
   */
  async heartbeat(
    ctx: RunMutationCtx,
    roomId: RoomId,
    userId: UserId,
    sessionId: string,
    interval: number
  ): Promise<{ roomToken: string; sessionToken: string }> {
    return ctx.runMutation(this.component.public.heartbeat, {
      roomId,
      userId,
      sessionId,
      interval,
    });
  }

  /**
   * List presence state for all users in the room, up to the limit of users.
   */
  async list(
    ctx: RunQueryCtx,
    roomToken: string,
    limit: number = 104
  ): Promise<Array<{ userId: UserId; online: boolean; lastDisconnected: number; data?: unknown }>> {
    return ctx.runQuery(this.component.public.list, { roomToken, limit }) as Promise<
      { userId: UserId; online: boolean; lastDisconnected: number; data?: unknown }[]
    >;
  }

  /**
   * Updates a users presence data in a room.
   */
  async updateRoomUser(
    ctx: RunMutationCtx,
    roomId: RoomId,
    userId: UserId,
    data?: unknown
  ): Promise<null> {
    return ctx.runMutation(this.component.public.updateRoomUser, { roomId, userId, data });
  }

  // Gracefully disconnect a user.
  async disconnect(ctx: RunMutationCtx, sessionToken: string): Promise<null> {
    return ctx.runMutation(this.component.public.disconnect, { sessionToken });
  }

  /**
   * ============================================================================
   * HELPERS AND MAINTENANCE FUNCTIONS
   * ============================================================================
   *
   * These functions are convenient to use within your parent application but
   * don't include their own authentication so you should be careful about exposing
   * them directly to end users.
   */

  /**
   * List all users in a room.
   */
  async listRoom(
    ctx: RunQueryCtx,
    roomId: RoomId,
    onlineOnly: boolean = false, // only show users online in the room
    limit: number = 104
  ): Promise<Array<{ userId: UserId; online: boolean; lastDisconnected: number }>> {
    return ctx.runQuery(this.component.public.listRoom, { roomId, onlineOnly, limit }) as Promise<
      { userId: UserId; online: boolean; lastDisconnected: number }[]
    >;
  }

  /**
   * List all rooms a user is in.
   */
  async listUser(
    ctx: RunQueryCtx,
    userId: UserId,
    onlineOnly: boolean = false, // only show rooms the user is online in
    limit: number = 104
  ): Promise<Array<{ roomId: RoomId; online: boolean; lastDisconnected: number }>> {
    return ctx.runQuery(this.component.public.listUser, { userId, onlineOnly, limit }) as Promise<
      { roomId: RoomId; online: boolean; lastDisconnected: number }[]
    >;
  }

  /**
   * Remove a user from a room.
   */
  async removeRoomUser(ctx: RunMutationCtx, roomId: RoomId, userId: UserId): Promise<null> {
    return ctx.runMutation(this.component.public.removeRoomUser, { roomId, userId });
  }

  /**
   * Remove a room.
   */
  async removeRoom(ctx: RunMutationCtx, roomId: RoomId): Promise<null> {
    return ctx.runMutation(this.component.public.removeRoom, { roomId });
  }
}
