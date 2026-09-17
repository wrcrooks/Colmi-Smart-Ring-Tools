# Colmi Ring Stats Backfill

A small Home Assistant custom component that backfills the ring's
heart-rate history into Home Assistant's long-term statistics with correct
historical timestamps — for when the ring only syncs through the ESPHome
proxy once (e.g. overnight), so you still get an hourly curve for the whole
day instead of one data point at sync time.

## Why this exists

Home Assistant sensor states are always timestamped "when received," so a
single once-a-day sync from `esphome/components/colmi_ring` can only ever
produce one point on a normal entity history graph, no matter how much data
the ring itself logged. The ring's own log *is* rich (up to 288 samples/day
at 5-minute resolution — see [`../../../docs/PROTOCOL.md`](../../../docs/PROTOCOL.md)),
so the data exists; it's Home Assistant's live-entity-state model that
can't place it correctly in time.

Home Assistant does have a mechanism for backdating values —
`homeassistant.components.recorder.statistics.async_add_external_statistics`
— but it's **not exposed as a callable service**. The only public interface
to it is a WebSocket-API command (`recorder/import_statistics`) used
internally by the frontend's statistics-adjustment UI, not something a
normal YAML automation can call with `service: recorder.import_statistics`
(that service doesn't exist — verified against Home Assistant core's own
`recorder/services.py`, which only registers `purge`, `purge_entities`,
`enable`, `disable`, and `get_statistics`). This integration exists purely
to bridge that gap: it's a few lines of Python that call the internal
function directly (fully accessible to any in-process component) and expose
it as a real service, `colmi_ring_stats.import_heart_rate_hourly`.

**Hard constraint carried over from Home Assistant itself, not something
this integration can work around**: long-term statistics are hour-resolution
only — every imported point must land exactly on the hour. That's why the
ESPHome side ([`../../../esphome/README.md`](../../../esphome/README.md))
aggregates the ring's 5-minute samples into hourly mean/min/max before
sending them here, rather than the full-resolution log. You'll get an hourly
curve, not a 5-minute one.

## Setup

1. Copy this `colmi_ring_stats/` directory into your Home Assistant's
   `config/custom_components/` folder.
2. Add `colmi_ring_stats:` to `configuration.yaml` (no options — this
   integration is services-only, no config flow) and restart Home Assistant.
3. Configure the ESPHome component's optional `heart_rate_history`
   text_sensor (see `../../../esphome/colmi-ring-example.yaml`).
4. Add an automation that calls the new service whenever that text_sensor
   updates:

   ```yaml
   automation:
     - alias: "Import ring heart-rate history"
       trigger:
         - trigger: state
           entity_id: text_sensor.ring_heart_rate_history
       condition:
         - condition: template
           value_template: "{{ trigger.to_state.state not in ('unknown', 'unavailable', '') }}"
       action:
         - action: colmi_ring_stats.import_heart_rate_hourly
           data:
             entry: "{{ trigger.to_state.state }}"
   ```

   (Uses the service's defaults — `statistic_id: colmi_ring:heart_rate`,
   `name: Ring heart rate (history)`, `unit_of_measurement: bpm` — pass
   these explicitly if you want to change them or run multiple rings.)

5. This creates an **external statistic**, not a new entity — it won't show
   up on any existing sensor's own history graph. View it with a
   `statistics-graph` card:

   ```yaml
   type: statistics-graph
   title: Ring heart rate (history)
   entities:
     - colmi_ring:heart_rate
   period: hour
   ```

   or via **Developer Tools → Statistics** in the UI.

## Format this expects

`entry` must be a string in the exact shape
`esphome/components/colmi_ring/colmi_ring.cpp`'s `heart_rate_history_string_`
produces: `"<midnight_epoch_utc>|<hour0>;<hour1>;...;<hour23>"`, each hour
field either `x` (no samples that hour) or `mean,min,max` (integer bpm). If
the two ever drift out of sync, fix both — there's no schema/version
negotiation, just this doc as the shared contract.

## Re-importing / idempotency

Calling the service again for the same hours (e.g. every poll cycle, as the
day's data refines) is safe — Home Assistant's statistics import is an
upsert keyed on `(statistic_id, hour)`, so re-sending overwrites that hour
rather than duplicating it.

## Not validated against a real Home Assistant instance

Written directly against Home Assistant core's `recorder` source
(`statistics.py`, `services.py`, `websocket_api.py`) to get the exact data
shapes and constraints right, but not run against a live HA install in the
environment that produced it. Please report anything that doesn't work as
described so this and the ESPHome side can be corrected together.
