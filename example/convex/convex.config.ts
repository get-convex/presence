import { defineApp } from "convex/server";
import presence from "../../src/component/convex.config";

const app = defineApp();
app.use(presence);
export default app;
