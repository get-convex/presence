import { api } from "../convex/_generated/api";
import usePresence from "@convex-dev/presence/react";
import FacePile from "@convex-dev/presence/facepile";
import { Authenticated, Unauthenticated, useQuery } from "convex/react";
import { SignIn } from "./SignIn";
import { SignOut } from "./SignOut";

export default function App(): React.ReactElement {
  return (
    <main>
      <h1>Convex Presence with Auth</h1>
      <Unauthenticated>
        <p>Sign in to see the members in the room.</p>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <div>
          <SignOut />
        </div>
        <div>
          <Content />
        </div>
      </Authenticated>
    </main>
  );
}

function Content() {
  const userId = useQuery(api.presence.getUserId);

  if (userId === undefined) {
    return <div>Loading...</div>;
  }
  if (userId === null) {
    return <div>Authentication required</div>;
  }

  return <PresenceContent userId={userId} />;
}

function PresenceContent({ userId }: { userId: string }) {
  const presenceState = usePresence(api.presence, "my-chat-room", userId);
  return <FacePile presenceState={presenceState ?? []} />;
}
