import { useEffect, useState } from "react";
import { useRing } from "../state/RingProvider";

export function SettingsPage() {
  const {
    status,
    deviceName,
    blinkTwice,
    reboot,
    getHeartRateLogSettings,
    setHeartRateLogSettings,
  } = useRing();

  const connected = status === "connected";

  const [enabled, setEnabled] = useState(true);
  const [interval, setInterval] = useState(60);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) {
      setLoaded(false);
      return;
    }
    getHeartRateLogSettings()
      .then((settings) => {
        setEnabled(settings.enabled);
        setInterval(settings.interval);
        setLoaded(true);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : String(err)));
  }, [connected, getHeartRateLogSettings]);

  const handleApply = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await setHeartRateLogSettings({ enabled, interval });
      setMessage("Saved.");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <h2>Ring</h2>
        <p>{connected ? `Connected to ${deviceName}` : "Not connected."}</p>
      </section>

      <section className="panel">
        <h2>Heart-rate logging</h2>
        <p className="hint">
          Controls how often the ring records a background heart-rate sample (used to build the
          heart-rate history log).
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!connected || !loaded}
          />
          Enabled
        </label>
        <div className="button-row">
          <input
            type="number"
            min={1}
            max={255}
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
            disabled={!connected || !loaded}
          />
          <span className="hint">minutes</span>
          <button type="button" disabled={!connected || !loaded || saving} onClick={handleApply}>
            {saving ? "Saving…" : "Apply"}
          </button>
        </div>
        {message && <p className="hint">{message}</p>}
      </section>

      <section className="panel">
        <h2>Find my ring</h2>
        <button type="button" disabled={!connected} onClick={() => blinkTwice()}>
          Blink twice
        </button>
      </section>

      <section className="panel panel-danger">
        <h2>Danger zone</h2>
        <button
          type="button"
          disabled={!connected}
          onClick={() => {
            if (confirm("Reboot the ring? It will disconnect.")) reboot();
          }}
        >
          Reboot ring
        </button>
      </section>
    </div>
  );
}
