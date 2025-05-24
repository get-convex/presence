"use client";

/// React hook for maintaining presence state.

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { FunctionReference } from "convex/server";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
}

export interface State {
  _id: string;
  user: string;
  room: string;
  online: boolean;
  lastDisconnected: number;
}

export default function usePresence(
  listFn: FunctionReference<"query", "public", { room: string }, State[]>,
  heartbeatFn: FunctionReference<
    "mutation",
    "public",
    { room: string; user: string; interval: number }
  >,
  disconnectFn: FunctionReference<"mutation", "public", { room: string; user: string }>,
  disconnectUrl: string,
  room: string,
  user: string,
  interval: number = 10000
): State[] | undefined {
  const state = useQuery(listFn, { room });
  const heartbeat = useMutation(heartbeatFn);
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

  return state?.sort((a, b) => {
    if (a.user === user) return -1;
    if (b.user === user) return 1;
    return 0;
  });
}
