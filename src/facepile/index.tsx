import React from "react";
import { PresenceState } from "../react/index.js";
import "./facepile.css";

// React component that displays a facepile of users based on their presence
// state. This renders a list of avatars for the first 5 users plus a drop-down
// for the rest. You can just drop this into your application but you likely
// want to create your own version with your own custom styling.
export default function FacePile({
  presenceState,
}: {
  presenceState: PresenceState[];
}): React.ReactElement {
  const visible = presenceState.slice(0, 5);
  const hidden = presenceState.slice(5);

  return (
    <div className="container">
      <div className="avatars">
        {visible.map((presence, idx) => (
          <Avatar key={presence.userId} presence={presence} index={idx} total={visible.length} />
        ))}
        {hidden.length > 0 && (
          <div className="more-container">
            <div className="avatar more" tabIndex={0}>
              +{hidden.length}
            </div>
            <Dropdown users={hidden} />
          </div>
        )}
      </div>
    </div>
  );
}

function getEmojiForUserId(userId: string): string {
  // Simple hash function to generate a consistent emoji for a user ID.
  // see https://stackoverflow.com/a/7616484
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash << 5) - hash + userId.charCodeAt(i);
    hash |= 0; // Constrain to 32bit integer
  }
  const emojis = ["😊", "😃", "😎", "🤓", "😇", "🤖", "👻", "🐶", "🐱", "🐰"];
  return emojis[Math.abs(hash) % emojis.length];
}

function getTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = Math.floor((now - timestamp) / 1000);

  if (diff < 60) return "Last seen just now";
  if (diff < 3600) return `Last seen ${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600);
    return `Last seen ${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diff / 86400);
  return `Last seen ${days} day${days === 1 ? "" : "s"} ago`;
}

function Avatar({
  presence,
  index,
  total,
}: {
  presence: PresenceState;
  index: number;
  total: number;
}) {
  const presenceData = Object.entries(presence.data ?? {}).reduce((acc, [key, value]) => {
    acc[`data-presence-${key}`] = String(value);
    return acc;
  }, {} as Record<`data-presence-${string}`, string>);

  return (
    <div
      className={`avatar${presence.online ? " online" : " offline"}`}
      tabIndex={0}
      style={{ "--z": total - index } as React.CSSProperties}
      {...presenceData}
    >
      <span role="img" aria-label="user">
        {presence.image ? <img src={presence.image} alt="user" /> : getEmojiForUserId(presence.userId)}
      </span>
      <span className="tooltip">
        <div className="tooltip-user">{presence.name || presence.userId}</div>
        <div className="tooltip-status">
          {presence.online ? "Online now" : getTimeAgo(presence.lastDisconnected)}
        </div>

        {!!presence.data && (
          <div className="tooltip-data">
            <hr />
            {Object.entries(presence.data).map(([key, value]) => (
              <div key={key}>
                <strong>{key}:</strong> {String(value)}
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

function Dropdown({ users }: { users: PresenceState[] }) {
  return (
    <div className="dropdown">
      {users.slice(0, 10).map((presence) => (
        <div key={presence.userId} className="dropdown-row">
          <div className={`dropdown-emoji${!presence.online ? " offline" : ""}`}>
            <span role="img" aria-label="user">
              {presence.image ? <img src={presence.image} alt="user" /> : getEmojiForUserId(presence.userId)}
            </span>
          </div>
          <div className="dropdown-info">
            <div className="dropdown-user">{presence.name || presence.userId}</div>
            <div className="dropdown-status">
              {presence.online ? "Online now" : getTimeAgo(presence.lastDisconnected)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
