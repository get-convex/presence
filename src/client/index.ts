// Wrapper around Presence component for use in Convex server functions.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component.

import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";

// XXX move comments over here
export class Presence {
  constructor(private component: UseApi<typeof api>) {}

  async register(ctx: RunMutationCtx, room: string, user: string, expiresAfterMs: number) {
    return ctx.runMutation(this.component.public.register, { room, user, expiresAfterMs });
  }

  async deregister(ctx: RunMutationCtx, token: string) {
    return ctx.runMutation(this.component.public.deregister, { token });
  }

  async remove(ctx: RunMutationCtx, user: string, room: string) {
    return ctx.runMutation(this.component.public.remove, { room, user });
  }

  async removeUser(ctx: RunMutationCtx, user: string) {
    return ctx.runMutation(this.component.public.removeUser, { user });
  }

  async removeRoom(ctx: RunMutationCtx, room: string) {
    return ctx.runMutation(this.component.public.removeRoom, { room });
  }

  async heartbeat(ctx: RunMutationCtx, token: string, interval: number) {
    return ctx.runMutation(this.component.public.heartbeat, { token, interval });
  }

  async list(ctx: RunQueryCtx, token: string, limit: number = 104) {
    return ctx.runQuery(this.component.public.list, { token, limit });
  }

  async disconnect(ctx: RunMutationCtx, token: string) {
    return ctx.runMutation(this.component.public.disconnect, { token });
  }
}
