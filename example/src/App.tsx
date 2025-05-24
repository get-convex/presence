import { useState } from "react";
import FacePile from "./Facepile";
import usePresence from "../../src/react";
import { api } from "../convex/_generated/api";

export default function App(): JSX.Element {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const presenceState = usePresence(
    api.presence.list,
    api.presence.heartbeat,
    api.presence.disconnect,
    "chat-room",
    name
  );

  return (
    <main>
      <FacePile presenceState={presenceState ?? []} />
    </main>
  );
}
