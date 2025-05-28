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
