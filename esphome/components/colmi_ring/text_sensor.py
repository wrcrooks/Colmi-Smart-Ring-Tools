import esphome.codegen as cg
from esphome.components import text_sensor
import esphome.config_validation as cv
from esphome.const import ENTITY_CATEGORY_DIAGNOSTIC

from . import CONF_COLMI_RING_ID, ColmiRing

DEPENDENCIES = ["colmi_ring"]

CONF_LAST_SYNC = "last_sync"
CONF_HEART_RATE_HISTORY = "heart_rate_history"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(CONF_COLMI_RING_ID): cv.use_id(ColmiRing),
        cv.Optional(CONF_LAST_SYNC): text_sensor.text_sensor_schema(
            icon="mdi:sync",
            entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
        ),
        # Compact encoded string of the day's heart-rate log as hourly
        # mean/min/max — not meant to be read directly, pair it with an HA
        # automation calling colmi_ring_stats.import_heart_rate_hourly. See
        # ../../../homeassistant/custom_components/colmi_ring_stats/.
        cv.Optional(CONF_HEART_RATE_HISTORY): text_sensor.text_sensor_schema(
            icon="mdi:chart-timeline-variant",
            entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
        ),
    }
)


async def to_code(config):
    hub = await cg.get_variable(config[CONF_COLMI_RING_ID])
    if conf := config.get(CONF_LAST_SYNC):
        sens = await text_sensor.new_text_sensor(conf)
        cg.add(hub.set_last_sync_sensor(sens))
    if conf := config.get(CONF_HEART_RATE_HISTORY):
        sens = await text_sensor.new_text_sensor(conf)
        cg.add(hub.set_heart_rate_history_sensor(sens))
