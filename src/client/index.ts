// Wrapper around Presence component for us in Convex server functions.
// TODO main docs here

import { api } from "../component/_generated/api.js";
import { RunMutationCtx, RunQueryCtx, UseApi } from "./utils.js";
import { httpActionGeneric, HttpRouter } from "convex/server";

export class Presence {
  constructor(private component: UseApi<typeof api>) {}

  async heartbeat(ctx: RunMutationCtx, room: string, user: string, interval: number) {
    return ctx.runMutation(this.component.public.heartbeat, { room, user, interval });
  }

  async list(ctx: RunQueryCtx, room: string, limit: number = 104) {
    return ctx.runQuery(this.component.public.list, { room, limit });
  }

  async disconnect(ctx: RunMutationCtx, room: string, user: string) {
    return ctx.runMutation(this.component.public.disconnect, { room, user });
  }

  registerRoutes(http: HttpRouter) {
    http.route({
      path: "/presence/disconnect",
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        console.log("http disconnect");
        const { room, user } = await request.json();
        await this.disconnect(ctx, room, user);
        return new Response(null, { status: 200 });
      }),
    });
  }
}
