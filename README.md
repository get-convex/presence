# Presence Convex Component

[![npm version](https://badge.fury.io/js/@convex-dev%2Fpresence.svg)](https://badge.fury.io/js/@convex-dev%2Fpresence)

A Convex component for managing presence functionality, i.e., a live-updating
list of users in a "room" including their status for when they were last online.

It can be tricky to implement presence efficiently, without any polling and
without re-running queries every time a user sends a heartbeat message. This
component implements presence via Convex scheduled functions such that clients
only receive updates when a user joins or leaves the room.

The most common use case for this component is via the usePresence hook, which
takes care of sending heartbeart messages to the server and gracefully
disconnecting a user when the tab is closed.

See `../../example` for an example of how to incorporate this hook into your
application.

## Installation

```bash
npm install @convex-dev/presence
```

## Usage

First, add the component to your Convex app:

`convex/convex.config.ts`

```ts
import { defineApp } from "convex/server";
import presence from "@convex-dev/presence/convex.config";

const app = defineApp();
app.use(presence);
export default app;
```

`convex/presence.ts`

```ts
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { Presence } from "@convex-dev/presence";

export const presence = new Presence(components.presence);

export const heartbeat = mutation({
  args: { room: v.string(), user: v.string(), interval: v.number() },
  handler: async (ctx, { room, user, interval }) => {
    return await presence.heartbeat(ctx, room, user, interval);
  },
});

export const list = query({
  args: { room: v.string() },
  handler: async (ctx, { room }) => {
    return await presence.list(ctx, room);
  },
});

export const disconnect = mutation({
  args: { room: v.string(), user: v.string() },
  handler: async (ctx, { room, user }) => {
    return await presence.disconnect(ctx, room, user);
  },
});
```

A `Presence` React component can be instantiated from your client code like this:

`src/App.tsx`

```tsx
import { useState } from "react";
import { api } from "../convex/_generated/api";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";

export default function App(): React.ReactElement {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const convexUrl = import.meta.env.VITE_CONVEX_URL;
  const presenceState = usePresence(api.presence, convexUrl, "my-chat-room", name);

  return (
    <main>
      <FacePile presenceState={presenceState ?? []} />
    </main>
  );
}
```

This uses the basic `FacePile` component included with this package but you can easily copy this code and use the `usePresence` hook directly to implement your own styling.
