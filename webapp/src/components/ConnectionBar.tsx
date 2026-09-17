import { useRing } from "../state/RingProvider";

export function ConnectionBar() {
  const { status, errorMessage, deviceName, battery, connect, disconnect } = useRing();

  return (
    <div className={`connection-bar connection-bar-${status}`}>
      <div className="connection-bar-info">
        <span className="connection-dot" aria-hidden="true" />
        <span>
          {status === "connected" && deviceName
            ? `Connected: ${deviceName}`
            : status === "connecting"
              ? "Connecting…"
              : status === "error"
                ? `Connection failed: ${errorMessage}`
                : "Not connected"}
        </span>
        {battery && (
          <span className="battery-pill">
            {battery.batteryLevel}% {battery.charging ? "⚡" : ""}
          </span>
        )}
      </div>

      {status === "connected" ? (
        <button type="button" onClick={disconnect}>
          Disconnect
        </button>
      ) : (
        <button type="button" onClick={connect} disabled={status === "connecting"}>
          Connect ring
        </button>
      )}
    </div>
  );
}
