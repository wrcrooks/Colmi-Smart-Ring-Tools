"""Colmi Ring Stats Backfill.

Bridges the colmi_ring ESPHome component's `heart_rate_history` text_sensor
into Home Assistant's long-term statistics, so a heart-rate curve that only
ever synced once (e.g. overnight, when the ring finally comes into BLE range
of the ESPHome proxy) still shows up spread across the actual hours it
happened — not as one point at sync time. See
../../../esphome/README.md and ../../../docs/PROTOCOL.md for where the
encoded string comes from, and this integration's own README.md for the
automation needed to use it.

Why this integration exists at all: Home Assistant's long-term-statistics
import (`homeassistant.components.recorder.statistics.
async_add_external_statistics`) is only reachable from Python code running
inside HA — there is no callable `service: recorder.import_statistics`
you can use directly from a normal YAML automation (the only public
interface for it is a WebSocket-API command, `recorder/import_statistics`,
used internally by the frontend's statistics-adjustment UI). This
integration is a thin wrapper: it calls that internal function and exposes
it as a real service, `colmi_ring_stats.import_heart_rate_hourly`, so a
plain `service:` call in an automation can use it.

Also worth knowing before relying on this: Home Assistant's long-term
statistics are hour-resolution only — every imported point's timestamp must
land exactly on the hour. That's why the ESPHome side aggregates the ring's
5-minute samples into hourly mean/min/max before sending them here, rather
than trying to import the full-resolution log.
"""

from __future__ import annotations

import logging

import voluptuous as vol

from homeassistant.components.recorder.statistics import async_add_external_statistics
from homeassistant.core import HomeAssistant, ServiceCall
import homeassistant.helpers.config_validation as cv
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

DOMAIN = "colmi_ring_stats"

SERVICE_IMPORT_HEART_RATE_HOURLY = "import_heart_rate_hourly"

CONF_ENTRY = "entry"
CONF_STATISTIC_ID = "statistic_id"
CONF_NAME = "name"
CONF_UNIT = "unit_of_measurement"

DEFAULT_STATISTIC_ID = f"{DOMAIN}:heart_rate"
DEFAULT_NAME = "Ring heart rate (history)"
DEFAULT_UNIT = "bpm"

# StatisticMeanType.ARITHMETIC's integer value. Passed as a plain int rather
# than importing the enum, since recorder has moved that enum's module path
# between HA versions and the metadata field only ever needs the int value.
MEAN_TYPE_ARITHMETIC = 1

IMPORT_SERVICE_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_ENTRY): cv.string,
        vol.Optional(CONF_STATISTIC_ID, default=DEFAULT_STATISTIC_ID): cv.string,
        vol.Optional(CONF_NAME, default=DEFAULT_NAME): cv.string,
        vol.Optional(CONF_UNIT, default=DEFAULT_UNIT): cv.string,
    }
)


def parse_entry(entry: str) -> tuple[int, list[tuple[int, int, int, int]]]:
    """Parse a colmi_ring `heart_rate_history` text_sensor state string.

    Format: "<midnight_epoch_utc>|<hour0>;<hour1>;...;<hour23>", each hour
    field either "x" (no samples that hour) or "mean,min,max" (integer bpm).
    Returns (midnight_epoch, [(hour_index, mean, min, max), ...]) for hours
    that had data. Mirrors
    esphome/components/colmi_ring/colmi_ring.cpp's
    `heart_rate_history_string_` — keep both in sync if this format changes.
    """
    midnight_str, sep, hours_str = entry.partition("|")
    if not sep or not midnight_str.lstrip("-").isdigit():
        raise ValueError(f"Malformed entry (no midnight timestamp): {entry!r}")
    midnight = int(midnight_str)

    hours = hours_str.split(";")
    if len(hours) != 24:
        raise ValueError(f"Malformed entry (expected 24 hour fields, got {len(hours)}): {entry!r}")

    result: list[tuple[int, int, int, int]] = []
    for hour_index, field in enumerate(hours):
        if field in ("", "x"):
            continue
        parts = field.split(",")
        if len(parts) != 3:
            raise ValueError(f"Malformed hour field {field!r} in entry: {entry!r}")
        try:
            mean, lo, hi = (int(p) for p in parts)
        except ValueError as err:
            raise ValueError(f"Non-integer hour field {field!r} in entry: {entry!r}") from err
        result.append((hour_index, mean, lo, hi))
    return midnight, result


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Register the import_heart_rate_hourly service.

    No config entries/config flow — add `colmi_ring_stats:` to
    configuration.yaml to load this integration (see README.md).
    """

    async def handle_import_heart_rate_hourly(call: ServiceCall) -> None:
        entry = call.data[CONF_ENTRY]
        statistic_id = call.data[CONF_STATISTIC_ID]
        name = call.data[CONF_NAME]
        unit = call.data[CONF_UNIT]

        domain = statistic_id.split(":", 1)[0] if ":" in statistic_id else ""
        if domain != DOMAIN:
            _LOGGER.error(
                "statistic_id %r must start with '%s:' - Home Assistant requires the "
                "statistic_id's domain prefix to match the integration that owns it",
                statistic_id,
                DOMAIN,
            )
            return

        try:
            midnight, hours = parse_entry(entry)
        except ValueError as err:
            _LOGGER.error("Could not parse heart-rate history entry: %s", err)
            return

        if not hours:
            _LOGGER.debug("No hours with data in this entry (%r), nothing to import", entry)
            return

        metadata = {
            "has_sum": False,
            "mean_type": MEAN_TYPE_ARITHMETIC,
            "name": name,
            "source": DOMAIN,
            "statistic_id": statistic_id,
            "unit_class": None,
            "unit_of_measurement": unit,
        }
        statistics = [
            {
                "start": dt_util.utc_from_timestamp(midnight + hour_index * 3600),
                "mean": float(mean),
                "min": float(lo),
                "max": float(hi),
            }
            for hour_index, mean, lo, hi in hours
        ]

        _LOGGER.debug("Importing %d hour(s) of heart-rate statistics into %s", len(statistics), statistic_id)
        async_add_external_statistics(hass, metadata, statistics)

    hass.services.async_register(
        DOMAIN,
        SERVICE_IMPORT_HEART_RATE_HOURLY,
        handle_import_heart_rate_hourly,
        schema=IMPORT_SERVICE_SCHEMA,
    )
    return True
