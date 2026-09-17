# Colmi R02/R06-family BLE protocol reference

This is the shared source of truth for both `webapp/` (TypeScript) and
`esphome/components/colmi_ring` (C++). If you change parsing logic in one, check
whether this doc — and the other implementation — needs updating too.

Reverse-engineered by the community, primarily documented in
[tahnok/colmi_r02_client](https://github.com/tahnok/colmi_r02_client) (MIT license)
and [colmi.puxtril.com](https://colmi.puxtril.com/commands/). Applies to the Colmi
R02/R06 and rebrands sharing the BlueX RF03 SoC (see `atc1441/ATC_RF03_Ring` for
hardware details): Colmi, VK-5098, Merlin, Hello Ring, RING1, boAtring, TR-R02, SE,
EVOLVEO, GL-SR2, Blaupunkt, KSIX RING, and others advertising as `R01`-`R10`.

## Transport

- GATT service UUID: `6E40FFF0-B5A3-F393-E0A9-E50E24DCCA9E` (Nordic-UART-shaped).
  - Write characteristic (central → ring): `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`.
    Write without response.
  - Notify characteristic (ring → central): `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`.
    Subscribe before sending any commands.
- Standard BLE Device Information service `0000180A-...` exposes hardware rev
  (`00002A27-...`) and firmware rev (`00002A26-...`) as plain read characteristics.
- The ring only appears to accept **one connected central at a time**. If the OEM
  phone app is connected, other clients (this webapp, an ESPHome node) will fail to
  connect or get disconnected, and vice versa.

## Packet format

Every request and response is exactly **16 bytes**:

```
byte 0       command id (0-255)
bytes 1-14   payload (zero-padded if unused)
byte 15      checksum = (sum of bytes 0-14) & 0xFF
```

Response packets echo the same command id in byte 0. A command id with the high bit
set (`>= 127`) in a response indicates an error.

```ts
function makePacket(command: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const packet = new Uint8Array(16);
  packet[0] = command;
  packet.set(payload.slice(0, 14), 1);
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += packet[i];
  packet[15] = sum & 0xff;
  return packet;
}
```

## Commands

| Command | id (dec/hex) | Direction | Notes |
|---|---|---|---|
| `SET_TIME` | 1 / 0x01 | request | payload: BCD year-2000, month, day, hour, minute, second, then `1` (language=English, `0`=Chinese). Ring has no RTC battery backup for long-term drift; set on every sync. |
| `BATTERY` | 3 / 0x03 | request/response | response: byte 1 = battery % (0-100), byte 2 = charging (0/1). |
| `REBOOT` | 8 / 0x08 | request | payload `[1]`. No response parsing needed. |
| `BLINK_TWICE` | 16 / 0x10 | request | "find my ring" — no payload. |
| `READ_HEART_RATE` | 21 / 0x15 | request/response (multi-packet) | see below. |
| `HEART_RATE_LOG_SETTINGS` | 22 / 0x16 | request/response | request payload `[1]` to read. Response: byte 2 = enabled (`1`=on,`2`=off), byte 3 = interval in minutes. To write: payload `[2, enabledByte, intervalMinutes]`. |
| `GET_STEP_SOMEDAY` | 67 / 0x43 | request/response (multi-packet) | see below. |
| `SLEEP` (experimental) | 68 / 0x44 | request/response (multi-packet) | "big data" sleep query, same request shape as steps. Response field layout only partially documented upstream (a quality/stage field is unverified) — treat decoded values as best-effort and label them experimental in both UIs. |
| `START_REAL_TIME` / `STOP_REAL_TIME` | 105 / 0x69, 106 / 0x6A | request/response (streamed) | see below. |

### Heart rate log (`READ_HEART_RATE`, 21)

Request: payload = little-endian uint32 unix timestamp of **midnight UTC** for the
day of interest.

Response is a stateful multi-packet stream, keyed by byte 1 (`sub_type`):

- `sub_type == 0`: byte 2 = `size` (number of data packets to expect), byte 3 =
  `range` (minutes per sample, normally 5). Allocate `size * 13` sample slots.
- `sub_type == 1`: bytes 2-5 = little-endian **signed** int32 unix timestamp for the
  first sample in this log. Bytes 6-14 (9 bytes) are the first 9 heart-rate samples.
- `sub_type == N` (2..size-1): bytes 2-14 (13 bytes) are the next 13 heart-rate
  samples. When `sub_type == size - 1`, the log is complete.
- `sub_type == 255`: no data for the requested day.

Each sample is one byte (bpm, `0` = no reading). Samples are spaced `range` minutes
apart starting at the log's timestamp — normally 288 samples/day at 5-minute
intervals. If the requested day is "today," zero out any sample slots at or after
the current time (they haven't happened yet).

### Steps / calories / distance log (`GET_STEP_SOMEDAY`, 67)

Request payload: `[dayOffset, 0x0f, 0x00, 0x5f, 0x01]` — `dayOffset` is days back
from the ring's "today" (0 = today, 1 = yesterday, ...). The last 4 bytes are
constant/unexplained in upstream's own notes but required.

Response is a stateful multi-packet stream:

- First packet with byte 1 == `240`: header. Byte 3 == `1` means calories use the
  "new" protocol (multiply parsed value by 10). Byte 1 == `255`: no data for the day.
- Subsequent packets, one `SportDetail` entry per packet:
  - byte 1: BCD year - add 2000
  - byte 2: BCD month
  - byte 3: BCD day
  - byte 4: `time_index` — 15-minute bucket within the day (`hour = idx/4`,
    `minute = (idx%4)*15`)
  - byte 5: this entry's sequence index; byte 6: total entry count (stream ends when
    `byte5 == byte6 - 1`)
  - bytes 7-8: calories, little-endian uint16 (×10 if "new calorie protocol")
  - bytes 9-10: steps, little-endian uint16
  - bytes 11-12: distance in meters, little-endian uint16

BCD (binary-coded decimal) byte → decimal: `((b >> 4) & 0xF) * 10 + (b & 0xF)`.

### Sleep log (`SLEEP`, 68) — experimental

Request payload mirrors steps: `[dayOffset, 0x0f, 0x00, 0x5f, 0x01]`.

Response framing is presumed to mirror the steps stream (BCD year/month/day + a
time field per entry, terminated the same way), based on it being described upstream
as a sibling "big data" command — but the field that should carry sleep
stage/quality is not conclusively decoded anywhere public. Implementations should:

- Parse and store the BCD date/time fields (reasonably confident).
- Store the remaining raw bytes alongside a `stageRaw`/`qualityRaw` field rather than
  asserting a specific meaning.
- Surface this in the UI/HA entity clearly marked "experimental" and invite the user
  to compare against the OEM app to help pin down the real field meaning.

### Real-time streaming readings (`START_REAL_TIME` / `STOP_REAL_TIME`, 105/106)

Reading types (byte 1 of the start/response packet):

| value | reading |
|---|---|
| 1 | heart rate |
| 2 | blood pressure |
| 3 | SpO2 |
| 4 | fatigue |
| 5 | health check |
| 7 | ECG |
| 8 | pressure |
| 9 | blood sugar |
| 10 | HRV |

Only heart rate (1) and SpO2 (3) are known-reliable on this hardware; others may
return an error code and should be treated as unsupported unless proven otherwise.

- Start: `makePacket(105, [readingType, action=1 /* START */])`.
- Stop: `makePacket(106, [readingType, 0, 0])`.
- While active, the ring streams response packets on command id 105: byte 1 =
  reading type, byte 2 = error code (`0` = ok), byte 3 = the value. Poll for ~6
  non-zero readings (or an error) with a short per-read timeout (~2s, ~20 tries),
  then send the stop packet regardless of outcome.

### Device capabilities (response to `SET_TIME`)

The ring also replies to `SET_TIME` with a bitfield of supported features (blood
oxygen, blood pressure, HRV, contacts, watch faces, etc.) — safe to ignore; it's
informational only and the upstream client notes it's not fully reliable (e.g. it
claims WeChat support it doesn't have).

## Device discovery

Advertised device names start with one of: `R01`-`R10`, `COLMI`, `VK-5098`,
`MERLIN`, `Hello Ring`, `RING1`, `boAtring`, `TR-R02`, `SE`, `EVOLVEO`, `GL-SR2`,
`Blaupunkt`, `KSIX RING`. Prefer filtering `requestDevice`/BLE scans by the service
UUID above over name prefixes when possible — the name list is best-effort and OEMs
keep adding new rebrands.
