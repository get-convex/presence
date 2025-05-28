import { useState } from "react";
import { api } from "../convex/_generated/api";
import FacePile from "../../src/react/Facepile";
import usePresence from "../../src/react";

export default function App(): React.ReactElement {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));

  const httpActionHost = import.meta.env.VITE_CONVEX_URL.replace(".convex.cloud", ".convex.site");
  const disconnectUrl = `${httpActionHost}/presence/disconnect`;

  const presenceState = usePresence(api.presence, disconnectUrl, "my-chat-room", name);

  return (
    <main>
      <FacePile presenceState={presenceState ?? []} />
    </main>
  );
}
