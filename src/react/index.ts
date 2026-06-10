"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useConvex } from "convex/react";
import type { FunctionReference } from "convex/server";
import useSingleFlight from "./useSingleFlight.js";
import useTabLeader, { hasOtherContenders } from "./useTabLeader.js";

// Interface in your Convex app /convex directory that implements these
// functions by calling into the presence component, e.g., like this:
//
// export const presence = new Presence(components.presence);
//
// export const heartbeat = mutation({
//   args: { roomId: v.string(), userId: v.string(), sessionId: v.string(), interval: v.number() },
//   handler: async (ctx, { roomId, userId, sessionId, interval }) => {
//     // TODO: Add your auth checks here.
//     return await presence.heartbeat(ctx, roomId, userId, sessionId, interval);
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
//     // Can't check auth here because it's called over http from sendBeacon.
//     return await presence.disconnect(ctx, sessionToken);
//   },
// });
export interface PresenceAPI {
  list: FunctionReference<
    "query",
    "public",
    { roomToken: string },
    PresenceState[]
  >;
  heartbeat: FunctionReference<
    "mutation",
    "public",
    { roomId: string; userId: string; sessionId: string; interval: number },
    { roomToken: string; sessionToken: string }
  >;
  disconnect: FunctionReference<"mutation", "public", { sessionToken: string }>;
}

// Presence state for a user within the given room.
export interface PresenceState {
  userId: string;
  online: boolean;
  lastDisconnected: number;
  data?: unknown;
  // Set these accordingly in your Convex app.
  // See ../../example-with-auth/convex/presence.ts for an example.
  name?: string;
  image?: string;
}

// Options for `usePresence`.
export interface UsePresenceOptions {
  // Coordinate across browser tabs so that only one *visible* tab heartbeats on
  // behalf of the user, using Web Locks leader election. This collapses N open
  // tabs into a single session + heartbeat stream, avoiding the database
  // contention that independent per-tab heartbeats cause. The user is considered
  // present while at least one tab is visible; presence is handed between tabs
  // as they are shown/hidden/closed.
  //
  // Defaults to false, preserving the original behavior where every visible tab
  // heartbeats on its own. Falls back to that behavior automatically where the
  // Web Locks API is unavailable.
  coordinateTabs?: boolean;
}

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
  roomId: string,
  userId: string,
  interval: number = 10000,
  convexUrl?: string,
  options?: UsePresenceOptions,
): PresenceState[] | undefined {
  const hasMounted = useRef(false);
  const convex = useConvex();
  const baseUrl = convexUrl ?? convex.url;

  // Each session (browser tab etc) has a unique ID and a token used to disconnect it.
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const [roomToken, setRoomToken] = useState<string | null>(null);
  const roomTokenRef = useRef<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const heartbeat = useSingleFlight(useMutation(presence.heartbeat));
  const disconnect = useSingleFlight(useMutation(presence.disconnect));

  // Tab coordination. Only enabled when requested and supported; otherwise this
  // collapses to the original per-tab behavior (`active` === `visible`).
  const canCoordinate =
    (options?.coordinateTabs ?? false) &&
    typeof navigator !== "undefined" &&
    !!navigator.locks;
  const lockName = `convex-presence-leader:${roomId}:${userId}`;

  // Track whether this tab is visible.
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || !document.hidden,
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // Contend for leadership only while visible (so presence reflects "any visible
  // tab"). The leader is the single tab that heartbeats.
  const isLeader = useTabLeader(lockName, canCoordinate && visible);

  // This tab heartbeats when it is the visible leader (coordinating) or simply
  // while it is visible (not coordinating — the original per-tab behavior).
  const active = canCoordinate ? isLeader : visible;

  useEffect(() => {
    // Reset session state when roomId or userId changes.
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (sessionTokenRef.current) {
      void disconnect({ sessionToken: sessionTokenRef.current });
    }
    setSessionId(crypto.randomUUID());
    setSessionToken(null);
    setRoomToken(null);
  }, [roomId, userId, disconnect]);

  useEffect(() => {
    // Update refs whenever tokens change.
    sessionTokenRef.current = sessionToken;
    roomTokenRef.current = roomToken;
  }, [sessionToken, roomToken]);

  useEffect(() => {
    // Heartbeat while this tab is the active presence owner.
    if (!active) return;

    const sendHeartbeat = async () => {
      const result = await heartbeat({ roomId, userId, sessionId, interval });
      setRoomToken(result.roomToken);
      setSessionToken(result.sessionToken);
    };

    void sendHeartbeat();
    const id = setInterval(() => void sendHeartbeat(), interval);
    intervalRef.current = id;

    // On page unload without coordination, beacon a disconnect (the original
    // behavior). When coordinating we let the browser release the Web Lock — a
    // waiting tab takes over, or the server-side timeout marks the last tab
    // offline — so no beacon is needed.
    const handleUnload = () => {
      if (canCoordinate) return;
      if (sessionTokenRef.current) {
        const blob = new Blob(
          [
            JSON.stringify({
              path: "presence:disconnect",
              args: { sessionToken: sessionTokenRef.current },
            }),
          ],
          { type: "application/json" },
        );
        navigator.sendBeacon(`${baseUrl}/api/mutation`, blob);
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(id);
      if (intervalRef.current === id) {
        intervalRef.current = null;
      }
      window.removeEventListener("beforeunload", handleUnload);

      const token = sessionTokenRef.current;
      // Don't disconnect on the throwaway first cleanup in strict mode.
      if (!token || !hasMounted.current) return;

      if (!canCoordinate) {
        // Per-tab behavior: disconnect whenever this tab stops being active
        // (hidden or unmounted).
        void disconnect({ sessionToken: token });
        return;
      }
      // Coordinating: this tab is stepping down as leader. Disconnect only if no
      // other tab is waiting to take over (we were the last visible tab).
      // Otherwise hand off silently — the next leader keeps the user online and
      // this tab's now-orphaned session is reaped by the server-side timeout.
      void hasOtherContenders(lockName).then((others) => {
        if (!others) {
          void disconnect({ sessionToken: token });
        }
      });
    };
  }, [
    active,
    heartbeat,
    disconnect,
    roomId,
    userId,
    sessionId,
    interval,
    baseUrl,
    canCoordinate,
    lockName,
  ]);

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  const state = useQuery(presence.list, roomToken ? { roomToken } : "skip");
  return useMemo(
    () =>
      state?.slice().sort((a, b) => {
        if (a.userId === userId) return -1;
        if (b.userId === userId) return 1;
        return 0;
      }),
    [state, userId],
  );
}
