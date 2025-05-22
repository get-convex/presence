import { useState } from "react";
import FacePile from "./Facepile";
import usePresence from "../../src/react";

export default function App(): JSX.Element {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const othersPresence = usePresence("chat-room", name);

  return (
    <main>
      <h1>Presence</h1>
      <FacePile othersPresence={othersPresence ?? []} />
    </main>
  );
}
