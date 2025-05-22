import { useEffect, useState } from "react";
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
  othersPresence: Presence[];
}

const UPDATE_MS = 1000;

export default function FacePile({ othersPresence }: FacePileProps): JSX.Element {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), UPDATE_MS);
    return () => clearInterval(intervalId);
  }, [setNow]);

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString();
  };

  return (
    <div className="presence-list">
      {othersPresence
        .map((presence) => ({
          ...presence,
          online: isOnline(presence),
        }))
        .map((presence) => (
          <div
            key={presence._id}
            className={`presence-card ${presence.online ? "online" : "offline"}`}
          >
            <div>
              <strong>User:</strong> {presence.user}
            </div>
            <div>
              <strong>Last Updated:</strong> {formatDate(presence.updated)}
            </div>
          </div>
        ))}
    </div>
  );
}
