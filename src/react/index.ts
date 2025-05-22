"use client";

/// React helpers for presence.

import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { FunctionReference } from "convex/server";

if (typeof window === "undefined") {
  throw new Error("this is frontend code, but it's running somewhere else!");
}

const HEARTBEAT_PERIOD = 5000;
const OLD_MS = 10000;

interface State {
  _id: string;
  user: string;
  room: string;
  updated: number;
}

// TODO: it's kinda ugly you have to pass in both functions rn
export default function usePresence(
  listFn: FunctionReference<"query", "public", { room: string }, State[]>,
  heartbeatFn: FunctionReference<"mutation", "public", { room: string; user: string }>,
  room: string,
  user: string
): State[] | undefined {
  const state = useQuery(listFn, { room });
  const heartbeat = useMutation(heartbeatFn);

  useEffect(() => {
    void heartbeat({ room, user });
    const intervalId = setInterval(() => {
      void heartbeat({ room, user });
    }, HEARTBEAT_PERIOD);
    // Whenever we have any data change, it will get cleared.
    return () => clearInterval(intervalId);
  }, [heartbeat, room, user]);

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
