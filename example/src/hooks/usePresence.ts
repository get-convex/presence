import { useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

const HEARTBEAT_PERIOD = 5000;
const OLD_MS = 10000;

interface Presence {
  _id: string;
  user: string;
  room: string;
  updated: number;
}

/**
 * usePresence is a React hook for reading & writing presence data.
 *
 * The data is written by various users, and comes back as a list of data for
 * other users in the same room. It is not meant for mission-critical data, but
 * rather for optimistic metadata, like whether a user is online, typing, or
 * at a certain location on a page. The data is single-flighted, and when many
 * updates are requested while an update is in flight, only the latest data will
 * be sent in the next request. See for more details on single-flighting:
 * https://stack.convex.dev/throttling-requests-by-single-flighting
 *
 * Data updates are merged with previous data. This data will reflect all
 * updates, not just the data that gets synchronized to the server. So if you
 * update with {mug: userMug} and {typing: true}, the data will have both
 * `mug` and `typing` fields set, and will be immediately reflected in the data
 * returned as the first parameter.
 *
 * @param room - The location associated with the presence data. Examples:
 * page, chat channel, game instance.
 * @param user - The user associated with the presence data.
 * @returns A list with 1. this user's data; 2. A list of other users' data;
 * 3. function to update this user's data. It will do a shallow merge.
 */
export default function usePresence(room: string, user: string): Presence[] | undefined {
  let presence = useQuery(api.example.list, { room });
  if (presence) {
    presence = presence.filter((p) => p.user !== user);
  }
  const heartbeat = useMutation(api.example.heartbeat);

  useEffect(() => {
    void heartbeat({ room, user });
    const intervalId = setInterval(() => {
      void heartbeat({ room, user });
    }, HEARTBEAT_PERIOD);
    // Whenever we have any data change, it will get cleared.
    return () => clearInterval(intervalId);
  }, [presence, heartbeat, room, user]);

  return presence;
}

/**
 * isOnline determines a user's online status by how recently they've updated.
 *
 * @param presence - The presence data for one user returned from usePresence.
 * @returns True if the user has updated their presence recently.
 */
export const isOnline = (presence: Presence): boolean => {
  return Date.now() - presence.updated < OLD_MS;
};
