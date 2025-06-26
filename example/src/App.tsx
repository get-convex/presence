import { useState } from "react";
import { api } from "../convex/_generated/api";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";

export default function App(): React.ReactElement {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const presenceState = usePresence(api.presence, "my-chat-room", name);

  return (
    <main>
      <h1>Convex Presence Example</h1>
      <p>my-chat-room, {name}</p>
      <FacePile presenceState={presenceState ?? []} />
    </main>
  );
}
