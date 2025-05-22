import { useState } from "react";
import FacePile from "./Facepile";
import usePresence from "../../src/react";
import { api } from "../convex/_generated/api";

export default function App(): JSX.Element {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const othersPresence = usePresence(api.example.list, api.example.heartbeat, "chat-room", name);

  return (
    <main>
      <h1>Presence</h1>
      <FacePile othersPresence={othersPresence ?? []} />
    </main>
  );
}
