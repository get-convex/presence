"use client";

import { useEffect, useState } from "react";

/**
 * Cross-tab leader election via the Web Locks API.
 *
 * While `enabled` is true this tab contends for an origin-wide lock named
 * `name`. Exactly one contending tab holds the lock at a time and is the
 * "leader" — this hook returns `true` in that tab and `false` in the others.
 * When the leader stops contending (`enabled` flips to false, the component
 * unmounts, or the tab closes/crashes) the lock is released and another
 * contending tab becomes the leader.
 *
 * Where the Web Locks API is unavailable, every enabled tab reports itself as
 * leader so callers degrade to uncoordinated per-tab behavior rather than going
 * silent.
 */
export default function useTabLeader(name: string, enabled: boolean): boolean {
  const [isLeader, setIsLeader] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIsLeader(false);
      return;
    }

    const locks =
      typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      // No Web Locks support: fall back to "every tab leads".
      setIsLeader(true);
      return;
    }

    const controller = new AbortController();
    let releaseLock: (() => void) | undefined;

    locks
      .request(name, { signal: controller.signal }, () => {
        setIsLeader(true);
        // Hold the lock until this effect tears down. Resolving the returned
        // promise releases the lock and hands leadership to the next waiter.
        return new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      })
      .catch((error: unknown) => {
        // The request is aborted (AbortError) when we stop contending before
        // acquiring the lock — expected, not a failure.
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("[presence] tab leader lock error", error);
        }
      });

    return () => {
      setIsLeader(false);
      controller.abort();
      releaseLock?.();
    };
  }, [name, enabled]);

  return isLeader;
}

/**
 * Whether any tab other than this one currently holds or is waiting on the lock
 * `name`. Used by the leader to decide, as it steps down, whether another tab is
 * ready to take over (so it can hand off silently) or it is the last one (so it
 * should disconnect). Returns false where the Web Locks query API is missing.
 */
export async function hasOtherContenders(name: string): Promise<boolean> {
  const locks =
    typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.query) {
    return false;
  }
  try {
    const { held = [], pending = [] } = await locks.query();
    const count = [...held, ...pending].filter(
      (lock) => lock.name === name,
    ).length;
    // This tab holds one lock for `name`; anything beyond that is another tab.
    return count > 1;
  } catch {
    return false;
  }
}
