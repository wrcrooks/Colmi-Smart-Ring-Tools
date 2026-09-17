import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { RealTimeReading, type RealTimeReadingType } from "../ble/commands/realTime";
import { db } from "../db/database";
import { useRing } from "../state/RingProvider";

function startOfTodayMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function RealtimeReadingButton({
  label,
  readingType,
}: {
  label: string;
  readingType: RealTimeReadingType;
}) {
  const { getRealtimeReading, status } = useRing();
  const [value, setValue] = useState<number | null | "pending">(null);

  const handleClick = async () => {
    setValue("pending");
    try {
      const reading = await getRealtimeReading(readingType);
      setValue(reading);
    } catch {
      setValue(null);
    }
  };

  return (
    <div className="realtime-card">
      <div className="realtime-label">{label}</div>
      <div className="realtime-value">
        {value === "pending" ? "Reading…" : value === null ? "—" : value}
      </div>
      <button type="button" onClick={handleClick} disabled={status !== "connected" || value === "pending"}>
        Measure
      </button>
    </div>
  );
}

export function DashboardPage() {
  const { status, deviceInfo, ringId, isSyncing, syncProgress, sync } = useRing();

  const todayMs = startOfTodayMs();
  const todaySteps = useLiveQuery(async () => {
    if (ringId === null) return null;
    const rows = await db.sportDetails.where("ringId").equals(ringId).and((r) => r.timestamp >= todayMs).toArray();
    return rows.reduce(
      (acc, r) => ({ steps: acc.steps + r.steps, calories: acc.calories + r.calories, distance: acc.distance + r.distance }),
      { steps: 0, calories: 0, distance: 0 },
    );
  }, [ringId, todayMs]);

  const lastSync = useLiveQuery(async () => {
    if (ringId === null) return null;
    const rows = await db.syncs.where("ringId").equals(ringId).sortBy("timestamp");
    return rows.length > 0 ? rows[rows.length - 1] : null;
  }, [ringId]);

  const handleQuickSync = () => sync(1, false);

  return (
    <div className="page">
      {status !== "connected" && (
        <p className="hint">Connect to your ring above to see live data and run a sync.</p>
      )}

      <section className="card-grid">
        <RealtimeReadingButton label="Heart rate (bpm)" readingType={RealTimeReading.HEART_RATE} />
        <RealtimeReadingButton label="SpO2 (%)" readingType={RealTimeReading.SPO2} />
      </section>

      <section className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Steps today</div>
          <div className="stat-value">{todaySteps?.steps ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Calories today</div>
          <div className="stat-value">{todaySteps?.calories ?? "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Distance today (m)</div>
          <div className="stat-value">{todaySteps?.distance ?? "—"}</div>
        </div>
      </section>

      <section className="panel">
        <h2>Sync</h2>
        <p>Pull heart-rate and step history from the ring into this browser's local storage.</p>
        <div className="button-row">
          <button type="button" onClick={handleQuickSync} disabled={status !== "connected" || isSyncing}>
            {isSyncing ? "Syncing…" : "Quick sync (today)"}
          </button>
        </div>
        {isSyncing && syncProgress && (
          <p className="hint">
            Day {syncProgress.dayOffset + 1}/{syncProgress.daysTotal} — {syncProgress.stage}
          </p>
        )}
        {lastSync && <p className="hint">Last synced {new Date(lastSync.timestamp).toLocaleString()}</p>}
      </section>

      {deviceInfo && (
        <section className="panel">
          <h2>Device info</h2>
          <dl className="kv-list">
            <dt>Hardware</dt>
            <dd>{deviceInfo.hwVersion}</dd>
            <dt>Firmware</dt>
            <dd>{deviceInfo.fwVersion}</dd>
          </dl>
        </section>
      )}
    </div>
  );
}
