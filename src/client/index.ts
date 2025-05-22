// Client side implementation of the Presence component.

import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";

export class Presence {
  constructor(private component: UseApi<typeof api>) {}

  async heartbeat(
    ctx: RunMutationCtx,
    { room, user }: { room: string; user: string }
  ) {
    return ctx.runMutation(this.component.public.heartbeat, { room, user });
  }

  async list(ctx: RunQueryCtx, { room }: { room: string }) {
    return ctx.runQuery(this.component.public.list, { room });
  }
}
