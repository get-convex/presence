// Client side implementation of the Presence component.

import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";
import { httpActionGeneric, HttpRouter } from "convex/server";

export class Presence {
  constructor(private component: UseApi<typeof api>) {}

  async heartbeat(
    ctx: RunMutationCtx,
    { room, user, interval }: { room: string; user: string; interval: number }
  ) {
    return ctx.runMutation(this.component.public.heartbeat, { room, user, interval });
  }

  async list(ctx: RunQueryCtx, { room }: { room: string }) {
    return ctx.runQuery(this.component.public.list, { room });
  }

  async disconnect(ctx: RunMutationCtx, { room, user }: { room: string; user: string }) {
    return ctx.runMutation(this.component.public.disconnect, { room, user });
  }

  registerRoutes(http: HttpRouter) {
    http.route({
      path: "/presence/disconnect", // TODO: might need a custom prefix
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        console.log("http disconnect");
        const { room, user } = await request.json();
        await this.disconnect(ctx, { room, user });
        return new Response(null, { status: 200 });
      }),
    });
  }
}
