# Firmware container formats — confirmed findings

Derived from four files placed in `../dumps/` (gitignored, not in this repo —
see [`../README.md`](../README.md)):

- `Flash_800000_3.0.06_Firmware.bin` — a raw full-flash dump, firmware 3.00.06
- `R02_3.00.06_240523.bin` — the OTA update package for the same version
- `R02_3.00.17_240903.bin` — the OTA update package for 3.00.17 (our actual
  target — no full-flash dump of this version exists yet)
- `ROM_0_first128k_Bootloader_BLE_stack.bin` — a separate mask-ROM dump

All of this was derived with
[`../scripts/analyze_dumps.py`](../scripts/analyze_dumps.py); rerun it
against any newly obtained dump to reproduce or extend these findings.

## Two distinct container formats

### 1. Full-flash dump format (magic `"BX24"`)

24-byte (`0x18`) header, then raw memory content:

| Offset | Field | Value (3.00.06) | Notes |
|---|---|---|---|
| `0x00` | magic | `"BX24"` | literal ASCII, presumably "BlueX 24-byte header" or similar |
| `0x04` | `base_addr` | `0x00128000` | **the load address of the payload** (byte right after this header) — confirmed via disassembly, see below |
| `0x08` | ? | `0x0000141c` | unconfirmed — too small to be a size on its own; possibly a CRC16 + flags |
| `0x0c` | ? | `0x00128219` | `base_addr + 0x219` — a candidate entry point, unconfirmed |
| `0x10` | `partition_size_a` | `0x0004c000` (311296) | does **not** mark the end of real content (see below) — likely a *reserved partition size*, not actual code size |
| `0x14` | `partition_size_b` | `0x0006c000` (442368) | same caveat |
| `0x18` | payload start | — | confirmed real ARM Thumb code starts exactly here |

### 2. OTA update package format (magic bytes `78 56 34 12`, i.e. `0x12345678` little-endian)

256-byte (`0x100`) header, then a payload that is a **byte-for-byte slice of
the full-flash dump's payload** (not compressed — see entropy comparison
below):

| Offset | Field | Value (3.00.06) | Value (3.00.17) |
|---|---|---|---|
| `0x00` | magic | `0x12345678` | same |
| `0x04` | hash/CRC (4 bytes) | `9754beb5` | `4fb974d3` |
| `0x08` | `payload_size` (u32) | `117260` (`0x1ca0c`) | `118432` (`0x1cea0`) |
| `0x0c` | `payload_size` again (u32, duplicate) | same as `0x08` | same as `0x08` |
| `0x10` | version string (ASCII, null-padded) | `"R02_3.00.06_240523"` | `"R02_3.00.17_240903"` |
| `0x100` | payload start | — | — |

`file_size - payload_size == 256` exactly for both files, confirming the
header length independent of the version string.

## Confirmed: OTA payload == a slice of the full-flash dump

`ota_payload == bx24_payload[0x2fe8 : 0x2fe8 + len(ota_payload)]` — verified
byte-for-byte equal, not just similar (see script output). Since
`bx24_payload` starts at memory address `base_addr` (`0x00128000`), this
slice begins at:

```
0x00128000 + 0x2fe8 = 0x0012afe8
```

**So the OTA package's payload is exactly what lives at flash address
`0x0012afe8` onward** — the first `0x2fe8` bytes of app code (roughly 12KB,
presumably a small fixed bootloader/loader stub) are excluded from the OTA
payload because they don't need to be re-flashed on update.

Entropy check that ruled out "the OTA payload is compressed" as an
alternative explanation before the byte-exact match was found: real code
region entropy ≈ 6.57 bits/byte, OTA payload entropy ≈ 6.67 bits/byte — close
enough, and their byte-value histograms are nearly identical in shape
(dominated by `0x00`, then `0x46`, `0x01`, `0x20`, `0x10`, `0xf7`, ...) —
consistent with the same kind of content (real Thumb code + inline data),
not compression.

## Applying this to firmware 3.00.17 (no full-flash dump available)

We only have the OTA package for 3.00.17, not a matching full-flash dump.
**Assuming the same product/toolchain uses the same link address across
these adjacent versions** (unverified for 3.00.17 specifically, but a
reasonable starting assumption), its payload should also start at
`0x0012afe8`. `analyze_dumps.py` applies this assumption automatically when
no full-flash dump is present for a given OTA package — load
`R02_3.00.17_240903.bin`'s payload (everything after its 256-byte header)
into a disassembler at base address `0x0012afe8` as a starting point, and
treat the result as provisional until independently confirmed (e.g. by later
obtaining a full-flash dump of 3.00.17 the same way `Flash_800000_3.0.06`
was obtained, and checking the same byte-slice relationship holds).

## Real code region layout (3.00.06 full-flash dump)

Scanning for `0xFF`-filled (erased) runs ≥ 4KB in the payload found three
distinct content regions, not one contiguous blob:

| Payload offset range | Size | Likely content |
|---|---|---|
| `0x0` – `0x1f9f4` | ~129.5KB | Main application code (includes the ~12KB bootloader stub at the start, then everything the OTA package updates) |
| `0x1f9f4` – `0x6ffe8` | (erased gap, 329KB) | Reserved/unused flash |
| `0x6ffe8` – `0x70264` | 636 bytes | Unidentified — small enough to be a config/calibration table |
| `0x70264` – `0x79fe8` | (erased gap, 39KB) | Reserved/unused flash |
| `0x79fe8` – `0x7b070` | 4232 bytes | Unidentified — another small table/blob |
| `0x7b070` – end | (erased) | Reserved/unused flash |

The header's `0x10`/`0x14` size fields (`0x4c000`, `0x6c000`) don't land on
any of these real boundaries — revising the earlier working guess that they
were "app code size": they're more likely **reserved partition sizes**
(flash space allocated for OTA/rollback headroom) rather than actual content
sizes. Unconfirmed either way.

## Disassembly proof-of-concept

Disassembling `payload[0x18:]` (i.e. right at `base_addr`, `0x00128000`) as
ARM Cortex-M0 Thumb (via `capstone`, `CS_ARCH_ARM` + `CS_MODE_THUMB`)
produces a clean, immediately-recognizable function prologue — strong
confirmation this is correctly-aligned real code, not a misaligned guess:

```
0x00128000: push   {r4, r5, r7, lr}
0x00128002: mov    r1, sp
0x00128004: ldrb   r2, [r0, #1]
0x00128006: add    r7, sp, #0
0x00128008: lsls   r2, r2, #0x1a
0x0012800a: lsrs   r2, r2, #0x1e
0x0012800c: adds   r3, r2, #7
0x0012800e: lsrs   r3, r3, #3
0x00128010: lsls   r3, r3, #3
0x00128012: subs   r3, r1, r3
0x00128014: mov    sp, r3
0x00128016: movs   r5, r0
0x00128018: mov    r1, sp
0x0012801a: ldrb   r0, [r0]
0x0012801c: bl     #0x129344     ; in-range call, consistent with real code
```

The `adds r3,r2,#7 / lsrs r3,r3,#3 / lsls r3,r3,#3` sequence is a classic
"round up to a multiple of 8" idiom, and combined with the `mov sp, r3`
right after, this looks like a stack/heap allocation helper (e.g. something
adjacent to a task/thread creation routine, plausible for an RTOS-based BLE
stack) — worth using as an early anchor point for a real Ghidra pass.

## `ROM_0_first128k_Bootloader_BLE_stack.bin`

Not yet cross-referenced against the above (different file, no shared magic
header — appears to be a raw mask-ROM dump with no wrapper format at all).
Its first word (`0x0012fc50`) is a plausible initial stack-pointer value if
RAM is based at `0x00100000` (`0x0012fc50 - 0x00100000 = 0x2fc50` =
195,664 bytes, comfortably inside the datasheet's 200KB RAM figure) — a
useful independent data point for the memory map, but not yet confirmed
against `BX24`'s addressing.

## Open questions

- What are the two small unidentified content regions (636 bytes and 4232
  bytes, well outside the main app-code region)?
- What do header fields `0x08` and `0x0c` in the `BX24` format actually
  encode? (`0x0c` looks entry-point-shaped: `base_addr + 0x219`, but this is
  unconfirmed.)
- Does 3.00.17 really share the same `0x0012afe8` load address, or does that
  drift release-to-release? Only resolvable with a full-flash dump of 3.00.17
  (or another version) to repeat this same byte-slice check against.
- How does `ROM_0_first128k_Bootloader_BLE_stack.bin` relate to the `BX24`
  address space — same address space, different base, or a genuinely
  separate memory (e.g. a real mask ROM at address 0)?
- Full disassembly / Ghidra pass hasn't started — this is groundwork
  (container formats + addressing) to make that pass tractable, not the
  pass itself.
