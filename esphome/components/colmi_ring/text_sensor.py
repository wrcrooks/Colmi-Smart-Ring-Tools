import esphome.codegen as cg
from esphome.components import text_sensor
import esphome.config_validation as cv
from esphome.const import ENTITY_CATEGORY_DIAGNOSTIC

from . import CONF_COLMI_RING_ID, ColmiRing

DEPENDENCIES = ["colmi_ring"]

CONF_LAST_SYNC = "last_sync"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(CONF_COLMI_RING_ID): cv.use_id(ColmiRing),
        cv.Optional(CONF_LAST_SYNC): text_sensor.text_sensor_schema(
            icon="mdi:sync",
            entity_category=ENTITY_CATEGORY_DIAGNOSTIC,
        ),
    }
)


async def to_code(config):
    hub = await cg.get_variable(config[CONF_COLMI_RING_ID])
    if conf := config.get(CONF_LAST_SYNC):
        sens = await text_sensor.new_text_sensor(conf)
        cg.add(hub.set_last_sync_sensor(sens))
