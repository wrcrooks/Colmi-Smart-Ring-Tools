# Colmi Ring Tools — ESPHome component

A custom ESPHome `external_component` that actively connects to a Colmi R02/R06-
family ring over BLE, polls it on a schedule, and exposes its data as native
sensors — auto-discovered by Home Assistant's ESPHome integration, no HACS
install required. See [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md) for the
underlying BLE protocol.

## Why not a passive `bluetooth_proxy`?

The ring only exposes its data over an **active** GATT connection (write a
command, wait for a notify response) — there's nothing useful in its BLE
advertisement packets to read passively. That rules out ESPHome's passive
`bluetooth_proxy` + a separate Home Assistant integration; this component
does everything (connect, write, parse) on the ESP32 itself and just publishes
plain sensor states, which is both simpler to install and more robust.

## Requirements

- An **ESP32** board (needs BLE; ESP8266 won't work).
- The ring's **MAC address**. Easiest way to find it: connect to the ring once
  with the webapp ([`../webapp/`](../webapp/)) — its connection UI shows the
  address — or use any BLE scanner app/tool.
- Optionally, a `time:` source (e.g. `platform: homeassistant`) so the
  component can set the ring's clock and correctly request "today's"
  heart-rate log. Without it, the ring keeps whatever clock it last had (set
  by the OEM app, or never).

## Setup

1. Copy `components/colmi_ring/` into your own ESPHome config directory (or
   reference this repo directly via a `git` external_components source —
   see the [ESPHome external components docs](https://esphome.io/components/external_components)).
2. Copy [`colmi-ring-example.yaml`](colmi-ring-example.yaml) as a starting
   point, fill in your Wi-Fi secrets and the ring's MAC address.
3. `esphome run colmi-ring-example.yaml`.

The component follows ESPHome's standard "hub" pattern: a `colmi_ring:` entry
owns the BLE connection, and `sensor:`/`binary_sensor:`/`text_sensor:`
platform entries with `platform: colmi_ring` and `colmi_ring_id: <id>` attach
individual metrics to it (mirrors how components like `ld2410` are
structured). Every metric is optional — only configure the ones you want.

Available metrics: `battery_level`, `charging` (binary_sensor), `steps`,
`calories`, `distance`, `heart_rate`, `last_sync` (text_sensor), and
`sleep_minutes` — **experimental**, see
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md#sleep-log-sleep-68--experimental).
Also `heart_rate_history` (text_sensor) — see "Backfilling a full day's
heart-rate curve" below.

## What it reports

Deliberately scoped down from the webapp: each poll cycle (`update_interval`,
default 15 minutes) fetches **today's totals** — battery, charging state,
today's steps/calories/distance, and the most recent heart-rate log sample —
rather than full historical time series. Home Assistant's own recorder builds
history from these states over time; if you want the ring's full multi-day
history (5-minute-resolution heart rate, per-day steps, etc.), sync it with
the webapp instead.

## Backfilling a full day's heart-rate curve

If your ring only comes into BLE range of the ESP32 once a day (e.g.
overnight, near a charger), the `heart_rate` sensor above will only ever
show one snapshot value per day — Home Assistant timestamps sensor states
by "when received," not by anything in the data, so even though the ring's
own log has 5-minute-resolution samples for the whole day, a single
`publish_state()` call can't place them at the times they actually
happened.

The optional `heart_rate_history` text_sensor exists to solve this: each
poll cycle, the firmware aggregates the day's heart-rate log into 24 hourly
`mean,min,max` buckets and publishes them as one compact string. Paired with
the [`colmi_ring_stats`](../homeassistant/custom_components/colmi_ring_stats/)
custom component (a small bridge this project also provides — see that
directory's README for why it's needed and exactly how to set it up), an
automation can backfill those hours into Home Assistant's long-term
statistics with correct timestamps, so a single late-night sync still
produces an hourly curve instead of one point. Note this is hour-resolution,
not 5-minute — that's a hard limit of Home Assistant's statistics system,
not something either component can improve on.

## Known limitations

- **One BLE central at a time.** If the OEM phone app is connected to the
  ring, this component's connection attempts will fail (and vice versa).
- **Sleep is experimental, and may never populate at all.** `sleep_minutes`
  is a best-effort "minutes with a non-zero stage byte" estimate from an
  under-documented command. Worse: on firmware 3.00.06, decompiling the
  ring's own handler shows it's a permanent stub that always replies "no
  data" — see
  [`../firmware-re/notes/sleep-handler-analysis.md`](../firmware-re/notes/sleep-handler-analysis.md).
  If this sensor never reports a value on your ring, that's very likely why.
- **Validated against real hardware** (ESP32-C3 Super Mini + a Colmi R06):
  battery, charging, steps, calories, distance, and heart rate all confirmed
  working over a real BLE connection. `sleep_minutes` was not observed to
  populate, consistent with the firmware finding above.
