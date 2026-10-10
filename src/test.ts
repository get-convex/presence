/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import {
  componentsGeneric,
  type GenericSchema,
  type SchemaDefinition,
} from "convex/server";
import batchWorker from "@convex-dev/batch-worker/test";
import type { ComponentApi } from "./component/_generated/component.js";
import schema from "./component/schema.js";
const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the component with the test convex instance.
 * @param t - The test convex instance, e.g. from calling `convexTest`.
 * @param name - The name of the component, as registered in convex.config.ts.
 * @returns a component api to test via ctx.runMutation or for thick client
 *   usage. Also provides types for convex-test's defineTestApp.
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "presence",
) {
  t.registerComponent(name, schema, modules);
  // Also register the nested batch-worker component that runs the disconnect
  // worker. convex-test addresses nested components by slash-joined path.
  batchWorker.register(t, `${name}/batchWorker`);
  return componentsGeneric()[name] as unknown as ComponentApi;
}
export default { register, schema, modules };
