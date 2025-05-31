"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import { FunctionReference } from "convex/server";
import useSingleFlight from "./useSingleFlight.js";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
}

// Interface in your Convex app /convex directory that implements these
// functions by calling into the presence component, e.g., like this:
//
// export const presence = new Presence(components.presence);
//
// export const heartbeat = mutation({
//   args: { room: v.string(), user: v.string(), sessionId: v.string(), interval: v.number() },
//   handler: async (ctx, { room, user, sessionId, interval }) => {
//     // TODO: Add your auth checks here.
//     return await presence.heartbeat(ctx, room, user, sessionId, interval);
//   },
// });
//
// export const list = query({
//   args: { roomToken: v.string() },
//   handler: async (ctx, { roomToken }) => {
//     // Avoid adding per-user reads so all subscriptions can share same cache.
//     return await presence.list(ctx, roomToken);
//   },
// });
//
// export const disconnect = mutation({
//   args: { sessionToken: v.string() },
//   handler: async (ctx, { sessionToken }) => {
//     return await presence.disconnect(ctx, sessionToken);
//   },
// });
export interface PresenceAPI {
  list: FunctionReference<"query", "public", { roomToken: string }, State[]>;
  heartbeat: FunctionReference<
    "mutation",
    "public",
    { room: string; user: string; sessionId: string; interval: number },
    { roomToken: string; sessionToken: string }
  >;
  disconnect: FunctionReference<"mutation", "public", { sessionToken: string }>;
}

// Presence state for a user within the given room.
export interface State {
  user: string;
  online: boolean;
  lastDisconnected: number;
  // Set these accordingly in your Convex app.
  // See ../../example-with-auth/convex/presence.ts for an example.
  name?: string;
  image?: string;
}

// Generate a unique session ID for this browser tab
const generateSessionId = () => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
};

// React hook for maintaining presence state.
//
// This hook is designed to be efficient and only sends a message to users
// whenever a member joins or leaves the room, not on every heartbeat.
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
  const hasMounted = useRef(false);
  const convex = useConvex();
  const baseUrl = convexUrl ?? convex.url;

  // Generate a unique session ID for this browser tab that persists for the lifetime of the component
  const [sessionId] = useState(() => generateSessionId());

  const [roomToken, setRoomToken] = useState<string | null>(null);
  const roomTokenRef = useRef<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const heartbeat = useSingleFlight(useMutation(presence.heartbeat));
  const disconnect = useSingleFlight(useMutation(presence.disconnect));

  useEffect(() => {
    // Update refs whenever tokens change.
    sessionTokenRef.current = sessionToken;
    roomTokenRef.current = roomToken;
  }, [sessionToken, roomToken]);

  useEffect(() => {
    // Periodic heartbeats.
    const sendHeartbeat = async () => {
      const result = await heartbeat({ room, user, sessionId, interval });
      setRoomToken(result.roomToken);
      setSessionToken(result.sessionToken);
    };
    intervalRef.current = setInterval(sendHeartbeat, interval);
    void sendHeartbeat();

    // Handle page unload.
    const handleUnload = () => {
      if (sessionTokenRef.current) {
        const blob = new Blob(
          [
            JSON.stringify({
              path: "presence:disconnect",
              args: { sessionToken: sessionTokenRef.current },
            }),
          ],
          {
            type: "application/json",
          }
        );
        navigator.sendBeacon(`${baseUrl}/api/mutation`, blob);
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    // Handle visibility changes.
    const handleVisibility = async () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (sessionTokenRef.current) {
          await disconnect({ sessionToken: sessionTokenRef.current });
        }
      } else {
        void sendHeartbeat();
        intervalRef.current = setInterval(sendHeartbeat, interval);
      }
    };
    const wrappedHandleVisibility = () => {
      handleVisibility().catch(console.error);
    };
    document.addEventListener("visibilitychange", wrappedHandleVisibility);

    // Cleanup.
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", wrappedHandleVisibility);
      window.removeEventListener("beforeunload", handleUnload);
      // Don't disconnect on first render in strict mode.
      if (hasMounted.current) {
        if (sessionTokenRef.current) {
          void disconnect({ sessionToken: sessionTokenRef.current });
        }
      }
    };
  }, [heartbeat, disconnect, room, user, baseUrl, interval, sessionId]);

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  const state = useQuery(presence.list, { roomToken: roomTokenRef.current ?? "" });
  return useMemo(
    () =>
      state?.slice().sort((a, b) => {
        if (a.user === user) return -1;
        if (b.user === user) return 1;
        return 0;
      }),
    [state, user]
  );
}
