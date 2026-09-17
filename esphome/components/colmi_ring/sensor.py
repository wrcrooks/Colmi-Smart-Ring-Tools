import esphome.codegen as cg
from esphome.components import sensor
import esphome.config_validation as cv
from esphome.const import (
    CONF_BATTERY_LEVEL,
    CONF_DISTANCE,
    DEVICE_CLASS_BATTERY,
    ENTITY_CATEGORY_DIAGNOSTIC,
    ICON_HEART_PULSE,
    STATE_CLASS_MEASUREMENT,
    STATE_CLASS_TOTAL_INCREASING,
    UNIT_METER,
    UNIT_PERCENT,
    UNIT_STEPS,
)

from . import CONF_COLMI_RING_ID, ColmiRing

DEPENDENCIES = ["colmi_ring"]

CONF_STEPS = "steps"
CONF_CALORIES = "calories"
CONF_HEART_RATE = "heart_rate"
CONF_SLEEP_MINUTES = "sleep_minutes"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(CONF_COLMI_RING_ID): cv.use_id(ColmiRing),
        cv.Optional(CONF_BATTERY_LEVEL): sensor.sensor_schema(
            unit_of_measurement=UNIT_PERCENT,
            accuracy_decimals=0,
            device_class=DEVICE_CLASS_BATTERY,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
        cv.Optional(CONF_STEPS): sensor.sensor_schema(
            unit_of_measurement=UNIT_STEPS,
            icon="mdi:shoe-print",
            accuracy_decimals=0,
            state_class=STATE_CLASS_TOTAL_INCREASING,
        ),
        cv.Optional(CONF_CALORIES): sensor.sensor_schema(
            unit_of_measurement="kcal",
            icon="mdi:fire",
            accuracy_decimals=0,
            state_class=STATE_CLASS_TOTAL_INCREASING,
        ),
        cv.Optional(CONF_DISTANCE): sensor.sensor_schema(
            unit_of_measurement=UNIT_METER,
            icon="mdi:map-marker-distance",
            accuracy_decimals=0,
            state_class=STATE_CLASS_TOTAL_INCREASING,
        ),
        cv.Optional(CONF_HEART_RATE): sensor.sensor_schema(
            unit_of_measurement="bpm",
            icon=ICON_HEART_PULSE,
            accuracy_decimals=0,
            state_class=STATE_CLASS_MEASUREMENT,
        ),
        # EXPERIMENTAL — see docs/PROTOCOL.md. Best-effort minutes-with-a-
        # non-zero-stage-byte estimate, not a verified sleep-stage decode.
        cv.Optional(CONF_SLEEP_MINUTES): sensor.sensor_schema(
            unit_of_measurement="min",
            icon="mdi:sleep",
            accuracy_decimals=0,
            state_class=STATE_CLASS_MEASUREMENT,
            entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
        ),
    }
)


async def to_code(config):
    hub = await cg.get_variable(config[CONF_COLMI_RING_ID])

    if conf := config.get(CONF_BATTERY_LEVEL):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_battery_sensor(sens))

    if conf := config.get(CONF_STEPS):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_steps_sensor(sens))

    if conf := config.get(CONF_CALORIES):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_calories_sensor(sens))

    if conf := config.get(CONF_DISTANCE):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_distance_sensor(sens))

    if conf := config.get(CONF_HEART_RATE):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_heart_rate_sensor(sens))

    if conf := config.get(CONF_SLEEP_MINUTES):
        sens = await sensor.new_sensor(conf)
        cg.add(hub.set_sleep_minutes_sensor(sens))
