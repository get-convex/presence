import { presence } from "./example";
import { httpRouter } from "convex/server";

const http = httpRouter();
presence.registerRoutes(http);
export default http;
