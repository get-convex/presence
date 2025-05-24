import { presence } from "./presence";
import { httpRouter } from "convex/server";

const http = httpRouter();
presence.registerRoutes(http);
export default http;
