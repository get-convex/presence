import { useCallback, useState } from "react";
import { api } from "../convex/_generated/api";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";
import { useMutation } from "convex/react";

export default function App(): React.ReactElement {
  const [name] = useState(() => "User " + Math.floor(Math.random() * 10000));
  const presenceState = usePresence(api.presence, "my-chat-room", name);
  const updateRoomUser = useMutation(api.presence.updateRoomUser);
  const updateIsTyping = useCallback((isTyping: boolean) => {
    updateRoomUser({
      roomId: "my-chat-room",
      userId: name,
      data: { isTyping },
    });
  }, [name, updateRoomUser]);

  return (
    <main>
      <h1>Convex Presence Example</h1>
      <p>my-chat-room, {name}</p>
      <FacePile presenceState={presenceState ?? []} />
      <div style={{ padding: "20px" }}>
        <input onFocus={() => updateIsTyping(true)} onBlur={() => updateIsTyping(false)} />
      </div>
    </main>
  );
}
