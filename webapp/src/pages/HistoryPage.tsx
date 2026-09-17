import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "../db/database";
import { useRing } from "../state/RingProvider";

const RANGE_OPTIONS = [7, 14, 30];

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function HistoryPage() {
  const { status, ringId, isSyncing, syncProgress, sync } = useRing();
  const [daysBack, setDaysBack] = useState(7);
  const [includeSleep, setIncludeSleep] = useState(false);

  const rangeStartMs = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack + 1).getTime();
  }, [daysBack]);

  const steps = useLiveQuery(async () => {
    if (ringId === null) return [];
    return db.sportDetails
      .where("ringId")
      .equals(ringId)
      .and((r) => r.timestamp >= rangeStartMs)
      .toArray();
  }, [ringId, rangeStartMs]);

  const heartRate = useLiveQuery(async () => {
    if (ringId === null) return [];
    return db.heartRateSamples
      .where("ringId")
      .equals(ringId)
      .and((r) => r.timestamp >= rangeStartMs)
      .sortBy("timestamp");
  }, [ringId, rangeStartMs]);

  const sleep = useLiveQuery(async () => {
    if (ringId === null) return [];
    return db.sleepEntries
      .where("ringId")
      .equals(ringId)
      .and((r) => r.timestamp >= rangeStartMs)
      .sortBy("timestamp");
  }, [ringId, rangeStartMs]);

  const stepsByDay = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of steps ?? []) {
      const key = dayKey(row.timestamp);
      totals.set(key, (totals.get(key) ?? 0) + row.steps);
    }
    return [...totals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, value]) => ({ day, steps: value }));
  }, [steps]);

  const heartRatePoints = useMemo(
    () => (heartRate ?? []).map((row) => ({ time: row.timestamp, bpm: row.reading })),
    [heartRate],
  );

  return (
    <div className="page">
      <section className="panel">
        <h2>Range</h2>
        <div className="button-row">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              className={option === daysBack ? "chip chip-active" : "chip"}
              onClick={() => setDaysBack(option)}
            >
              {option} days
            </button>
          ))}
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeSleep}
            onChange={(e) => setIncludeSleep(e.target.checked)}
          />
          Include experimental sleep data
        </label>
        <div className="button-row">
          <button
            type="button"
            onClick={() => sync(daysBack, includeSleep)}
            disabled={status !== "connected" || isSyncing}
          >
            {isSyncing ? "Syncing…" : `Sync last ${daysBack} days`}
          </button>
        </div>
        {isSyncing && syncProgress && (
          <p className="hint">
            Day {syncProgress.dayOffset + 1}/{syncProgress.daysTotal} — {syncProgress.stage}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Steps per day</h2>
        {stepsByDay.length === 0 ? (
          <p className="hint">No step history synced yet for this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stepsByDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }} />
              <Bar dataKey="steps" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="panel">
        <h2>Heart rate</h2>
        {heartRatePoints.length === 0 ? (
          <p className="hint">No heart-rate history synced yet for this range.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={heartRatePoints}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="time"
                stroke="#94a3b8"
                fontSize={12}
                tickFormatter={(ms: number) => new Date(ms).toLocaleDateString()}
              />
              <YAxis stroke="#94a3b8" fontSize={12} domain={["dataMin - 5", "dataMax + 5"]} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #1e293b" }}
                labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
              />
              <Line type="monotone" dataKey="bpm" stroke="#f472b6" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {(sleep?.length ?? 0) > 0 && (
        <section className="panel">
          <h2>
            Sleep <span className="badge-experimental">experimental</span>
          </h2>
          <p className="hint">
            Sleep decoding isn't fully verified — see docs/PROTOCOL.md. Raw values shown for reference.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>stageRaw</th>
                  <th>qualityRaw</th>
                </tr>
              </thead>
              <tbody>
                {(sleep ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.timestamp).toLocaleString()}</td>
                    <td>{entry.stageRaw}</td>
                    <td>{entry.qualityRaw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
