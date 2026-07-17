// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePresence, type PresenceAPI } from "./index.js";

const appState = vi.hoisted(() => {
  let listener: ((state: string) => void) | undefined;
  return {
    addEventListener: vi.fn(
      (_event: string, nextListener: (state: string) => void) => {
        listener = nextListener;
        return { remove: vi.fn() };
      },
    ),
    emit: (state: string) => listener?.(state),
    reset: () => {
      listener = undefined;
    },
  };
});

const backend = vi.hoisted(() => ({
  heartbeat: vi.fn(() => new Promise<never>(() => {})),
  disconnect: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ url: "https://test.convex.cloud" }),
  useMutation: (ref: unknown) =>
    ref === "heartbeat" ? backend.heartbeat : backend.disconnect,
  useQuery: () => undefined,
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => "instance-id",
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: appState.addEventListener },
}));

const presenceApi = {
  list: "list",
  heartbeat: "heartbeat",
  disconnect: "disconnect",
} as unknown as PresenceAPI;

function Component() {
  usePresence(presenceApi, "room", "user");
  return null;
}

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  appState.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

test("returning from inactive replaces the heartbeat interval", async () => {
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Component />));

  expect(vi.getTimerCount()).toBe(1);

  act(() => appState.emit("inactive"));
  expect(vi.getTimerCount()).toBe(1);

  act(() => appState.emit("active"));
  expect(vi.getTimerCount()).toBe(1);

  await act(async () => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
