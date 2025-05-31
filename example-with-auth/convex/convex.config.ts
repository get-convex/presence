import { defineApp } from "convex/server";
// TODO change to "@convex-dev/presence/convex.config";
import presence from "../../src/component/convex.config";

const app = defineApp();
app.use(presence);
export default app;
