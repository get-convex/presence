// Wrapper around Presence component for use in Convex server functions.
//
// See ../react/index.ts for the usePresence hook that maintains presence in a
// client-side React component.

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

  // The sendBeacon API that's used to gracefully disconnect users can only talk
  // http not websockets so we need a separate handler just for this.
  registerRoutes(http: HttpRouter) {
    http.route({
      path: "/presence/disconnect",
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        const { room, user } = await request.json();
        await this.disconnect(ctx, room, user);
        return new Response(null, { status: 200 });
      }),
    });
  }
}
