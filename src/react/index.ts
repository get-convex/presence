"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { FunctionReference } from "convex/server";
import useSingleFlight from "./useSingleFlight.js";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
}

// XXX fix comment

// Interface in your Convex app /convex directory that implements these
// functions by calling into the presence component, e.g., like this:
//
// export const presence = new Presence(components.presence);
//
// export const heartbeat = mutation({
//   args: { room: v.string(), user: v.string(), interval: v.number() },
//   handler: async (ctx, { room, user, interval }) => {
//     return await presence.heartbeat(ctx, room, user, interval);
//   },
// });
//
// export const list = query({
//   args: { room: v.string() },
//   handler: async (ctx, { room }) => {
//     return await presence.list(ctx, room);
//   },
// });
//
// export const disconnect = mutation({
//   args: { room: v.string(), user: v.string() },
//   handler: async (ctx, { room, user }) => {
//     return await presence.disconnect(ctx, room, user);
//   },
// });
export interface PresenceAPI {
  list: FunctionReference<"query", "public", { token: string }, State[]>;
  heartbeat: FunctionReference<"mutation", "public", { token: string; interval: number }>;
  disconnect: FunctionReference<"mutation", "public", { token: string }>;
  register: FunctionReference<"mutation", "public", { room: string; user: string }, string>;
}

// Presence state for a user within the given room.
export interface State {
  user: string;
  online: boolean;
  lastDisconnected: number;
}

// Hook to register a user within a room and get a token.
function useToken(
  presence: PresenceAPI,
  room: string,
  user: string
): [string | null, (token: string) => void] {
  const register = useMutation(presence.register);
  const [token, setToken] = useState<string | null>(null);
  const hasRegistered = useRef(false);

  useEffect(() => {
    if (hasRegistered.current) return;
    hasRegistered.current = true;
    void register({ room, user }).then(setToken);
  }, [register, room, user]);

  return [token, setToken];
}

// Hook for managing heartbeats and cleanup.
function useHeartbeat(
  presence: PresenceAPI,
  token: string | null,
  interval: number,
  baseUrl: string
) {
  const heartbeat = useSingleFlight(useMutation(presence.heartbeat));
  const disconnect = useMutation(presence.disconnect);

  useEffect(() => {
    if (!token) return;

    // Send heartbeat and set up interval.
    const sendHeartbeat = () => void heartbeat({ token, interval });
    const intervalId = setInterval(sendHeartbeat, interval);
    void sendHeartbeat();

    // Handle page unload.
    const handleUnload = () => {
      const blob = new Blob([JSON.stringify({ path: "presence:disconnect", args: { token } })], {
        type: "application/json",
      });
      navigator.sendBeacon(`${baseUrl}/api/mutation`, blob);
    };

    // Handle visibility changes.
    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(intervalId);
        void disconnect({ token });
      } else {
        void sendHeartbeat();
        setInterval(sendHeartbeat, interval);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleUnload);

    // Cleanup.
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleUnload);
      void disconnect({ token });
    };
  }, [heartbeat, disconnect, token, baseUrl, interval]);
}

// React hook for maintaining presence state.
//
// This hook is designed to be efficient and only sends a message to users
// whenever a member joins or leaves the room.
//
// Use of this hook requires passing in a reference to the Convex presence
// component defined in your Convex app. See ../../example/src/App.tsx for an
// example of how to incorporate this hook into your application.
export default function usePresence(
  presence: PresenceAPI,
  room: string,
  user: string,
  interval: number = 10000,
  convexUrl?: string
): State[] | undefined {
  const convex = useConvex();
  const baseUrl = convexUrl ?? convex.url;

  const [token] = useToken(presence, room, user);
  useHeartbeat(presence, token, interval, baseUrl);

  const state = useQuery(presence.list, { token: token ?? "" });
  // Move own user to the front.
  return state?.sort((a, b) => {
    if (a.user === user) return -1;
    if (b.user === user) return 1;
    return 0;
  });
}
