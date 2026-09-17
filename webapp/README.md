# Colmi Ring Tools — webapp

A self-hosted Progressive Web App that connects directly to a Colmi R02/R06-family
smart ring over Web Bluetooth — no backend server, no cloud account. See
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) for the BLE protocol this implements.

## Requirements

- **Web Bluetooth support**: Chrome/Edge/Opera on desktop or Android. **iOS Safari
  does not support Web Bluetooth** — there is no browser-based workaround there.
- **HTTPS or `localhost`**: Web Bluetooth refuses to run on plain HTTP. If
  self-hosting, put it behind TLS (a reverse proxy with a Let's Encrypt cert, a
  Cloudflare tunnel, Tailscale Serve, etc.) or access it via `localhost`.

## Develop

```sh
npm install
npm run dev
```

## Build & self-host

```sh
npm run build
```

This produces static files in `dist/`. Serve them with any static file server or
reverse proxy (nginx, Caddy, `python -m http.server`, etc.) over HTTPS. The app uses
hash-based routing (`/#/history`), so no server-side URL rewriting is required —
any plain static host works.

The build also registers a service worker (via `vite-plugin-pwa`) that caches the
app shell for offline installability. Live ring data still requires the ring to be
in Bluetooth range regardless — only previously-synced history (stored in the
browser's IndexedDB) is available offline.

## What it does

- **Connect**: pairs with the ring via `navigator.bluetooth.requestDevice`, sets
  the ring's clock, and reads battery + firmware/hardware version.
- **Dashboard**: on-demand real-time heart rate/SpO2 readings, today's steps/
  calories/distance, quick sync.
- **History**: syncs N days of heart-rate and step history into IndexedDB (via
  [Dexie](https://dexie.org/)) and charts it. Sleep history is available behind an
  opt-in checkbox and is clearly labeled **experimental** — see
  [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md#sleep-log-sleep-68--experimental).
- **Settings**: heart-rate logging interval, "find my ring" (blink), reboot.

## Code layout

- `src/ble/` — protocol implementation: `packet.ts` (packet/checksum), `constants.ts`
  (UUIDs/commands), `commands/*.ts` (per-command request builders + parsers, ported
  from `colmi_r02_client`), `connection.ts` (Web Bluetooth GATT transport + a
  per-command response queue), `client.ts` (high-level `RingClient` API).
- `src/db/` — Dexie schema and upsert helpers.
- `src/state/` — `RingProvider`/`useRing` (connection + command context) and
  `sync.ts` (the day-by-day history sync loop).
- `src/pages/`, `src/components/` — UI.

## Known limitations

- The ring appears to accept only one connected BLE central at a time — the OEM
  phone app and this webapp (or an ESPHome node, see [`../esphome/`](../esphome/))
  will contend for the connection.
- Sleep history parsing is best-effort; please report mismatches against your ring
  so `docs/PROTOCOL.md` and the parsers can be corrected. On firmware 3.00.06
  specifically, decompiling the ring's own handler for this command shows it's a
  permanent stub that always replies "no data" — see
  [`../firmware-re/notes/sleep-handler-analysis.md`](../firmware-re/notes/sleep-handler-analysis.md).
  If your ring never shows sleep data, that's very likely why, not a bug here.
