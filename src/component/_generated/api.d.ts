/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as public from "../public.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  public: typeof public;
}>;
export type Mounts = {
  public: {
    deregister: FunctionReference<"mutation", "public", { token: string }, any>;
    disconnect: FunctionReference<"mutation", "public", { token: string }, any>;
    heartbeat: FunctionReference<
      "mutation",
      "public",
      { interval?: number; token: string },
      any
    >;
    list: FunctionReference<
      "query",
      "public",
      { limit?: number; token: string },
      any
    >;
    register: FunctionReference<
      "mutation",
      "public",
      { expiresAfterMs?: number; room: string; user: string },
      any
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { room: string; user: string },
      any
    >;
    removeRoom: FunctionReference<"mutation", "public", { room: string }, any>;
    removeUser: FunctionReference<"mutation", "public", { user: string }, any>;
  };
};
// For now fullApiWithMounts is only fullApi which provides
// jump-to-definition in component client code.
// Use Mounts for the same type without the inference.
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {};
