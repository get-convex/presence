"use client";

/// React helpers for presence.

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { FunctionReference } from "convex/server";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
}

const HEARTBEAT_PERIOD = 15000;
const OLD_MS = 10000;

interface State {
  _id: string;
  user: string;
  room: string;
  updated: number;
}

export default function usePresence(
  listFn: FunctionReference<"query", "public", { room: string }, State[]>,
  heartbeatFn: FunctionReference<"mutation", "public", { room: string; user: string }>,
  disconnectFn: FunctionReference<"mutation", "public", { room: string; user: string }>,
  room: string,
  user: string
): State[] | undefined {
  const state = useQuery(listFn, { room });
  const heartbeat = useMutation(heartbeatFn);
  const disconnect = useMutation(disconnectFn);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const startHeartbeat = () => {
      void heartbeat({ room, user });
      if (intervalId) {
        clearInterval(intervalId);
      }
      intervalId = setInterval(() => {
        void heartbeat({ room, user });
      }, HEARTBEAT_PERIOD);
    };

    const stopHeartbeat = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    if (!document.hidden) {
      startHeartbeat();
    }

    // Handle visibility changes
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
      // TODO: fetch the URL programmatically
      const url = "https://shocking-parrot-141.convex.site/presence/disconnect";
      navigator.sendBeacon(url, JSON.stringify({ room, user }));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup
    return () => {
      stopHeartbeat();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);

      // Also disconnect when component unmounts (user navigates away)
      void disconnect({ room, user });
    };
  }, [heartbeat, disconnect, room, user]);

  return state;
}

/**
 * isOnline determines a user's online status by how recently they've updated.
 *
 * @param state - The presence data for one user returned from usePresence.
 * @returns True if the user has updated their presence recently.
 */
export const isOnline = (state: State): boolean => {
  return Date.now() - state.updated < OLD_MS;
};
