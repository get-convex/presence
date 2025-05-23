import { isOnline } from "../../src/react";
import "./Facepile.css";

interface Presence {
  _id: string;
  user: string;
  room: string;
  updated: number;
  online?: boolean;
}

interface FacePileProps {
  presenceState: Presence[];
}

export default function FacePile({ presenceState: presenceState }: FacePileProps): JSX.Element {
  const getTimeAgo = (timestamp: number): string => {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000);
    if (diff < 60) return `Last seen just now`;
    if (diff < 3600) return `Last seen ${Math.floor(diff / 60)} min ago`;
    if (diff < 86400)
      return `Last seen ${Math.floor(diff / 3600)} hour${Math.floor(diff / 3600) === 1 ? "" : "s"} ago`;
    return `Last seen ${Math.floor(diff / 86400)} day${Math.floor(diff / 86400) === 1 ? "" : "s"} ago`;
  };

  const sortedPresence = presenceState
    .map((presence) => ({
      ...presence,
      online: isOnline(presence),
    }))
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

  const visible = sortedPresence.slice(0, 5);
  const hidden = sortedPresence.slice(5);

  return (
    <div className="facepile-container">
      <div className="facepile-avatars">
        {visible.map((presence, idx, arr) => (
          <div
            key={presence._id}
            className={`facepile-avatar${presence.online ? " online" : " offline"}`}
            tabIndex={0}
            style={{ "--z": arr.length - idx } as React.CSSProperties}
          >
            <span role="img" aria-label="user">
              😊
            </span>
            <span className="facepile-tooltip">
              <div className="facepile-tooltip-user">{presence.user}</div>
              <div className="facepile-tooltip-status">
                {presence.online ? "Online now" : getTimeAgo(presence.updated)}
              </div>
            </span>
          </div>
        ))}
        {hidden.length > 0 && (
          <div className="facepile-more-container">
            <div className="facepile-avatar facepile-more" tabIndex={0}>
              <span className="facepile-more-count">+{hidden.length}</span>
            </div>
            <div className="facepile-dropdown">
              <div className="facepile-dropdown-header">LAST VIEWED BY</div>
              {hidden.slice(0, 10).map((presence) => (
                <div key={presence._id} className="facepile-dropdown-row">
                  <div className="facepile-dropdown-emoji">
                    <span role="img" aria-label="user">
                      😊
                    </span>
                  </div>
                  <div className="facepile-dropdown-info">
                    <div className="facepile-dropdown-user">{presence.user}</div>
                    <div className="facepile-dropdown-status">
                      {presence.online ? "Online now" : getTimeAgo(presence.updated)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
