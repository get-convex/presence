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

// React hook for maintaining presence state.
//
// This is a simple hook you can use in your application to maintain presence
// state for users in rooms. You may also want to fork this to store metadata or
// add auth state etc.
//
// It's easy to accidentally implement presence inefficiently by rerunning the
// list query every time a user sends a heartbeat message. This hook is designed
// to be efficient and only sends a message to the client over a websocket
// whenever a user joins or leaves the room.
//
// Use of this hook requires passing in a reference to the Convex presence
// component defined in your Convex app. See ../../example/src/App.tsx for an
// example of how to incorporate this hook into your application.
export default function usePresence(
  presence: PresenceAPI,
  room: string, // room to join
  user: string, // unique id for the current user
  interval: number = 10000, // interval between heartbeats
  convexUrl?: string // optional override for backend url
): State[] | undefined {
  const convex = useConvex();
  const baseUrl = convexUrl ?? convex.url;

  // Whenever we load the hook we need to register with the backend to get a
  // token to use to maintain presence state.
  const register = useMutation(presence.register);
  const [token, setToken] = useState<string | null>(null);
  const hasRegistered = useRef(false);

  useEffect(() => {
    const registerUser = async () => {
      if (hasRegistered.current) return;
      hasRegistered.current = true;
      console.log("mount registering user", room, user);
      const newToken = await register({ room, user });
      console.log("registered user", room, user, newToken);
      setToken(newToken);
    };
    void registerUser();
  }, [register, room, user]);

  const state = useQuery(presence.list, { token: token ?? "" });
  const heartbeat = useSingleFlight(useMutation(presence.heartbeat));
  const disconnect = useMutation(presence.disconnect);

  useEffect(() => {
    if (!token) return;
    console.log("using token", token);

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Continually schedule heartbeats.
    const startHeartbeat = () => {
      if (!token) return;

      const sendHeartbeat = async () => {
        try {
          await heartbeat({ token, interval });
        } catch (e) {
          // XXX check if this is the right error
          if (e instanceof Error && e.message.includes("Invalid token")) {
            // Token expired, re-register
            // XXX do we need single flighting?
            console.log("token expired, re-registering user", room, user);
            const newToken = await register({ room, user });
            setToken(newToken);
          } else {
            // Re-throw other errors
            throw e;
          }
        }
      };
      void sendHeartbeat();
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(() => {
        if (!token) return;
        void sendHeartbeat();
      }, interval);
    };

    const stopHeartbeat = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    // Start/stop heartbeats based on visibility.
    if (!document.hidden) {
      startHeartbeat();
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        startHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Disconnect on tab close.
    const handleBeforeUnload = () => {
      if (!token) return;
      const mutationUrl = `${baseUrl}/api/mutation`;
      const json = JSON.stringify({
        path: "presence:disconnect",
        args: { token },
      });
      const blob = new Blob([json], { type: "application/json" });
      navigator.sendBeacon(mutationUrl, blob);
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup on unmount.
    return () => {
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (token) {
        // XXX should we deregister too?
        void disconnect({ token });
      }
    };
  }, [heartbeat, disconnect, token, baseUrl, interval]);

  // Move own user to the front.
  return state?.sort((a, b) => {
    if (a.user === user) return -1;
    if (b.user === user) return 1;
    return 0;
  });
}
