"use client";

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { FunctionReference } from "convex/server";
import useSingleFlight from "./useSingleFlight.js";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
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
// It's easy to accidentally implement presence inefficiently, by rerunning the
// list query every time a user sends a heartbeat message. Of course this can be
// even more inefficient without Convex because you need to poll for the latest
// state. This hook is designed to be efficient and only sends a message to the
// client over a websocket whenever a user joins or leaves the room.
//
// Use of this hook requires instantiating the Convex presence component and
// then passing in the list, heartbeat and disconnect functions, plus the URL
// for a disconnect http action that will gracefully disconnect a user when the
// tab is closed.
//
// See ../../example for an example of how to incorporate this hook into your
// application.
export default function usePresence(
  listFn: FunctionReference<"query", "public", { room: string }, State[]>,
  heartbeatFn: FunctionReference<
    "mutation",
    "public",
    { room: string; user: string; interval: number }
  >,
  disconnectFn: FunctionReference<"mutation", "public", { room: string; user: string }>,
  disconnectUrl: string,
  room: string, // room to join
  user: string, // unique id for the current user
  interval: number = 10000 // interval between heartbeats
): State[] | undefined {
  const state = useQuery(listFn, { room });
  const heartbeat = useSingleFlight(useMutation(heartbeatFn));
  const disconnect = useMutation(disconnectFn);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Continually schedule heartbeats.
    const startHeartbeat = () => {
      void heartbeat({ room, user, interval });
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(() => {
        void heartbeat({ room, user, interval });
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
      navigator.sendBeacon(disconnectUrl, JSON.stringify({ room, user }));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup on unmount.
    return () => {
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      void disconnect({ room, user });
    };
  }, [heartbeat, disconnect, room, user]);

  // Move own user to the front.
  return state?.sort((a, b) => {
    if (a.user === user) return -1;
    if (b.user === user) return 1;
    return 0;
  });
}
