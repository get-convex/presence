import { useQuery, useMutation, useConvex } from "convex/react";
import { type FunctionReference } from "convex/server";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import useSingleFlight from "../react/useSingleFlight.js";

export type PresenceAPI = {
  list: FunctionReference<"query", "public", { roomToken: string }, PresenceState[]>;
  heartbeat: FunctionReference<
    "mutation",
    "public",
    { roomId: string; userId: string; sessionId: string; interval: number },
    { roomToken: string; sessionToken: string }
  >;
  disconnect: FunctionReference<"mutation", "public", { sessionToken: string }>;
};

// Presence state for a user within the given room.
export type PresenceState = {
  userId: string;
  online: boolean;
  lastDisconnected: number;
};

export function usePresence(
  presence: PresenceAPI,
  roomId: string,
  userId: string,
  interval: number = 10000,
  convexUrl?: string
) {
  const convex = useConvex();
  const baseUrl = convexUrl ?? convex.url;

  const [sessionId, setSessionId] = useState(() => Crypto.randomUUID());
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [roomToken, setRoomToken] = useState<string | null>(null);

  const sessionTokenRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const heartbeat = useSingleFlight(useMutation(presence.heartbeat));
  const disconnect = useSingleFlight(useMutation(presence.disconnect));

  const sendHeartbeat = useCallback(async () => {
    const result = await heartbeat({ roomId, userId, sessionId, interval });
    setRoomToken(result.roomToken);
    setSessionToken(result.sessionToken);
  }, [heartbeat, interval, roomId, sessionId, userId]);

  const fireAndForgetDisconnect = useCallback(
    (token: string) => {
      fetch(`${baseUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "presence:disconnect", args: { sessionToken: token } }),
      }).catch(() => {});
    },
    [baseUrl]
  );

  // Reset session when roomId/userId changes
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    if (sessionTokenRef.current) {
      disconnect({ sessionToken: sessionTokenRef.current });
    }

    setSessionId(Crypto.randomUUID());
    setSessionToken(null);
    setRoomToken(null);
  }, [roomId, userId, disconnect]);

  useEffect(() => {
    sessionTokenRef.current = sessionToken;
  }, [sessionToken]);

  useEffect(() => {
    // initial heartbeat + interval
    void sendHeartbeat();
    intervalRef.current = setInterval(sendHeartbeat, interval);

    // handle app state changes instead of beforeunload/visibility
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (sessionTokenRef.current) fireAndForgetDisconnect(sessionTokenRef.current);
      } else if (state === "active") {
        void sendHeartbeat();
        intervalRef.current = setInterval(sendHeartbeat, interval);
      }
    });

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      subscription.remove();

      if (sessionTokenRef.current) {
        fireAndForgetDisconnect(sessionTokenRef.current);
      }
    };
  }, [roomId, userId, interval, sendHeartbeat, fireAndForgetDisconnect]);

  const state = useQuery(presence.list, roomToken ? { roomToken } : "skip");

  return useMemo(
    () =>
      state?.slice().sort((a, b) => {
        if (a.userId === userId) return -1;
        if (b.userId === userId) return 1;
        return 0;
      }),
    [state, userId]
  );
}
