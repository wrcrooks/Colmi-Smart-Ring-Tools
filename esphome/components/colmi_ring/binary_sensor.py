import esphome.codegen as cg
from esphome.components import binary_sensor
import esphome.config_validation as cv
from esphome.const import DEVICE_CLASS_BATTERY_CHARGING

from . import CONF_COLMI_RING_ID, ColmiRing

DEPENDENCIES = ["colmi_ring"]

CONF_CHARGING = "charging"

CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(CONF_COLMI_RING_ID): cv.use_id(ColmiRing),
        cv.Optional(CONF_CHARGING): binary_sensor.binary_sensor_schema(
            device_class=DEVICE_CLASS_BATTERY_CHARGING,
        ),
    }
)


async def to_code(config):
    hub = await cg.get_variable(config[CONF_COLMI_RING_ID])
    if conf := config.get(CONF_CHARGING):
        sens = await binary_sensor.new_binary_sensor(conf)
        cg.add(hub.set_charging_sensor(sens))
