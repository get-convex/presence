/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as presence from "../presence.js";

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
  presence: typeof presence;
}>;
declare const fullApiWithMounts: typeof fullApi;

export declare const api: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApiWithMounts,
  FunctionReference<any, "internal">
>;

export declare const components: {
  presence: {
    public: {
      deregister: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        any
      >;
      disconnect: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        any
      >;
      heartbeat: FunctionReference<
        "mutation",
        "internal",
        { interval?: number; token: string },
        any
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number; token: string },
        any
      >;
      register: FunctionReference<
        "mutation",
        "internal",
        { expiresAfterMs?: number; room: string; user: string },
        any
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { room: string; user: string },
        any
      >;
      removeRoom: FunctionReference<
        "mutation",
        "internal",
        { room: string },
        any
      >;
      removeUser: FunctionReference<
        "mutation",
        "internal",
        { user: string },
        any
      >;
    };
  };
};
