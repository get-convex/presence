import { defineComponent } from "convex/server";
import batchWorker from "@convex-dev/batch-worker/convex.config.js";

const component = defineComponent("presence");
// Runs the singleton disconnect worker (see public.ts) so session timeouts
// don't need a scheduled function per session.
component.use(batchWorker);

export default component;
