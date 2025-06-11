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
    disconnect: FunctionReference<
      "mutation",
      "public",
      { sessionToken: string },
      null
    >;
    heartbeat: FunctionReference<
      "mutation",
      "public",
      { interval?: number; roomId: string; sessionId: string; userId: string },
      { roomToken: string; sessionToken: string }
    >;
    list: FunctionReference<
      "query",
      "public",
      { limit?: number; roomToken: string },
      Array<{ lastDisconnected: number; online: boolean; userId: string }>
    >;
    listRoom: FunctionReference<
      "query",
      "public",
      { limit?: number; roomId: string },
      Array<{ lastDisconnected: number; online: boolean; userId: string }>
    >;
    listRoomOnline: FunctionReference<
      "query",
      "public",
      { limit?: number; roomId: string },
      Array<string>
    >;
    listUser: FunctionReference<
      "query",
      "public",
      { limit?: number; userId: string },
      Array<{ lastDisconnected: number; online: boolean; roomId: string }>
    >;
    listUserOnline: FunctionReference<
      "query",
      "public",
      { limit?: number; userId: string },
      Array<string>
    >;
    removeRoom: FunctionReference<
      "mutation",
      "public",
      { roomId: string },
      null
    >;
    removeRoomUser: FunctionReference<
      "mutation",
      "public",
      { roomId: string; userId: string },
      null
    >;
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
