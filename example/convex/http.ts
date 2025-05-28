import { httpRouter } from "convex/server";
import { presence } from "./presence";

const http = httpRouter();
presence.registerRoutes(http);
export default http;
