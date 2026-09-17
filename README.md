# Colmi Smart Ring Tools

Two self-hosted ways to get data off a Colmi R02/R06-family BLE smart ring
(and its many rebrands: VK-5098, Merlin, Hello Ring, boAtring, KSIX RING,
and other `R01`-`R10`-branded rings built on the BlueX RF03 SoC):

- **[`webapp/`](webapp/)** — a Progressive Web App you self-host and open in a
  browser. Connects directly to the ring over Web Bluetooth, no backend server
  or cloud account required. Installable, keeps history in your browser
  (IndexedDB).
- **[`esphome/`](esphome/)** — an ESPHome `external_component` for an ESP32
  that polls the ring on a schedule and exposes battery/steps/heart-rate/SpO2
  (and experimental sleep) as native sensors in Home Assistant, no phone or
  laptop needs to be nearby.

Both implementations follow the same protocol spec, documented once in
[`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Hardware support

Any ring advertising a name starting with `R01`-`R10`, `COLMI`, `VK-5098`,
`MERLIN`, `Hello Ring`, `RING1`, `boAtring`, `TR-R02`, `SE`, `EVOLVEO`,
`GL-SR2`, `Blaupunkt`, or `KSIX RING` — these are OEM rebrands of the same
BlueX RF03-based hardware and speak the same GATT protocol. Tested primarily
against the Colmi R02 and R06.

## Status

The BLE protocol here is reverse-engineered (not vendor-documented). Battery,
step/calorie/distance history, heart-rate history, and real-time heart-rate/
SpO2 readings are well-documented and should work reliably. **Sleep history is
experimental** — the response format isn't fully decoded upstream, so treat
those values as best-effort until confirmed against your own ring. See
[`docs/PROTOCOL.md`](docs/PROTOCOL.md) for details, and please report
mismatches you find.

## Credits

This project stands on prior reverse-engineering work:

- [tahnok/colmi_r02_client](https://github.com/tahnok/colmi_r02_client) (MIT) —
  primary protocol reference; the packet format, command list, and parsing
  logic in this repo are ported from its Python implementation.
- [colmi.puxtril.com](https://colmi.puxtril.com/commands/) — additional
  protocol documentation, including the sleep/HRV/blood-pressure commands.
- [KpG782/colmi-ring-webapp](https://github.com/KpG782/colmi-ring-webapp) —
  reference Web Bluetooth UI implementation.
- [atc1441/ATC_RF03_Ring](https://github.com/atc1441/ATC_RF03_Ring) — hardware
  teardown of the BlueX RF03 SoC these rings are built on.

## License

MIT, see [`LICENSE`](LICENSE).
