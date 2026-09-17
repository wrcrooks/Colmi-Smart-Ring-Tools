"""ESPHome hub component for Colmi R02/R06-family BLE smart rings.

Actively connects to the ring via `ble_client` and polls it on
`update_interval`. This only declares the hub itself — add `sensor:`,
`binary_sensor:`, and/or `text_sensor:` platform entries with
`platform: colmi_ring` and `colmi_ring_id: <this id>` to expose individual
metrics (see sensor.py/binary_sensor.py/text_sensor.py and
colmi-ring-example.yaml). Protocol details are in ../../docs/PROTOCOL.md.
"""

import esphome.codegen as cg
from esphome.components import ble_client
from esphome.components import time as time_
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_TIME_ID

CODEOWNERS = ["@willcrooks"]
DEPENDENCIES = ["ble_client"]
MULTI_CONF = True

colmi_ring_ns = cg.esphome_ns.namespace("colmi_ring")
ColmiRing = colmi_ring_ns.class_(
    "ColmiRing", cg.PollingComponent, ble_client.BLEClientNode
)

CONF_COLMI_RING_ID = "colmi_ring_id"

CONFIG_SCHEMA = (
    cv.Schema(
        {
            cv.GenerateID(): cv.declare_id(ColmiRing),
            # Used to set the ring's clock each poll cycle and to build the
            # heart-rate log request; optional, but recommended (without it
            # the ring keeps whatever clock it last had, and the heart-rate
            # log request falls back to an all-zero timestamp).
            cv.Optional(CONF_TIME_ID): cv.use_id(time_.RealTimeClock),
        }
    )
    .extend(cv.polling_component_schema("15min"))
    .extend(ble_client.BLE_CLIENT_SCHEMA)
)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    await ble_client.register_ble_node(var, config)

    if time_id := config.get(CONF_TIME_ID):
        time_var = await cg.get_variable(time_id)
        cg.add(var.set_time_source(time_var))
