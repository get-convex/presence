import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import FacePile from "./Facepile";
import usePresence from "./hooks/usePresence";


export default function App() {
    const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));  
  const othersPresence = usePresence("chat-room", name);

  return (
    <main>
      <h1>Presence</h1>
      <FacePile othersPresence={othersPresence ?? []} />
    </main>
  );
}