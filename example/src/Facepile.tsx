import { useEffect, useState } from "react";
import { isOnline } from "./hooks/usePresence";

interface Presence {
  _id: string;
  user: string;
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
    <div className="facepile" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {othersPresence
        .map((presence) => ({
          ...presence,
          online: isOnline(presence),
        }))
        .map((presence) => (
          <div
            key={presence._id}
            style={{
              padding: "8px",
              backgroundColor: presence.online ? "#e6ffe6" : "#ffe6e6",
              borderRadius: "4px",
              width: "100%",
            }}
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
