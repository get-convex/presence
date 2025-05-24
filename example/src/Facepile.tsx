import "./Facepile.css";
import { State } from "../../src/react";

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

function Avatar({ presence, index, total }: { presence: State; index: number; total: number }) {
  return (
    <div
      className={`avatar${presence.online ? " online" : " offline"}`}
      tabIndex={0}
      style={{ "--z": total - index } as React.CSSProperties}
    >
      <span role="img" aria-label="user">
        😊
      </span>
      <span className="tooltip">
        <div className="tooltip-user">{presence.user}</div>
        <div className="tooltip-status">
          {presence.online ? "Online now" : getTimeAgo(presence.lastDisconnected)}
        </div>
      </span>
    </div>
  );
}

function Dropdown({ users }: { users: State[] }) {
  return (
    <div className="dropdown">
      <div className="dropdown-header">LAST VIEWED BY</div>
      {users.slice(0, 10).map((presence) => (
        <div key={presence._id} className="dropdown-row">
          <div className="dropdown-emoji">
            <span role="img" aria-label="user">
              😊
            </span>
          </div>
          <div className="dropdown-info">
            <div className="dropdown-user">{presence.user}</div>
            <div className="dropdown-status">
              {presence.online ? "Online now" : getTimeAgo(presence.lastDisconnected)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FacePile({ presenceState }: { presenceState: State[] }): JSX.Element {
  const sortedPresence = [...presenceState].sort((a, b) =>
    a.online === b.online ? b.lastDisconnected - a.lastDisconnected : a.online ? -1 : 1
  );
  const visible = sortedPresence.slice(0, 5);
  const hidden = sortedPresence.slice(5);

  return (
    <div className="container">
      <div className="avatars">
        {visible.map((presence, idx) => (
          <Avatar key={presence._id} presence={presence} index={idx} total={visible.length} />
        ))}
        {hidden.length > 0 && (
          <div className="more-container">
            <div className="avatar more" tabIndex={0}>
              <span className="more-count">+{hidden.length}</span>
            </div>
            <Dropdown users={hidden} />
          </div>
        )}
      </div>
    </div>
  );
}
