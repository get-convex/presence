# Presence Convex Component

**Don't use this yet, work in progress!**

[![npm version](https://badge.fury.io/js/@convex-dev%2Fpresence.svg)](https://badge.fury.io/js/@convex-dev%2Fpresence)

A Convex component for managing presence functionality.

## Installation

```bash
npm install @convex-dev/presence
```

## Usage

First, add the component to your Convex app:

```typescript
import presence from "@convex-dev/presence/convex.config";

// ... existing code ...

app.use(presence);
```

A `Presence` wrapper can be instantiated within your Convex code as:

```typescript
import { Presence } from "@convex-dev/presence";

const presence = new Presence(components.presence);
```

...

```typescript
const [myPresence, othersPresence, updateMyPresence] = usePresence(
  userId,
  roomId,
  initialData
);
```

```typescript
const online = othersPresence.filter(
  (presence) => Date.now() - presence.updated < 10000
);
```

```typescript
useEffect(() => {
  void updatePresence({ room, user, data });
  const intervalId = setInterval(() => {
    void heartbeat({ room, user });
  }, heartbeatPeriod);
  return () => clearInterval(intervalId);
}, [updatePresence, heartbeat, room, user, data, heartbeatPeriod]);
```
