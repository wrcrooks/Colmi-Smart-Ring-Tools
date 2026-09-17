# BLE command dispatcher — confirmed findings

Derived from `Flash_800000_3.0.06_Firmware.bin` (firmware 3.00.06) using
[`../scripts/find_dispatcher.py`](../scripts/find_dispatcher.py) plus manual
inspection. Builds on the base-address/container-format work in
[`header-formats.md`](header-formats.md).

## Method

The RF03 is Cortex-M0 (ARMv6-M), which has **no `TBB`/`TBH` table-branch
instructions** (those are Thumb-2/ARMv7-M only) — so a C `switch` on the
incoming command byte cannot compile to a jump table the usual way, and
instead compiles to a chain of `CMP`/`BEQ`/`BGT` comparisons. Searching a
linear (resync-on-failure) disassembly for dense clusters of `CMP` against
an immediate — specifically against our *known, low-probability-of-
coincidence* command values (`0x15`, `0x43`, `0x44`, `0x69`, `0x6a` — the
common `#1`/`#3` immediates are too generic to be useful signal on their
own) — locates the real dispatcher immediately: a single ~260-byte function
at **`0x00140502`–`0x00140604`** contains a balanced binary-search-style
comparison tree covering command values across the full `0x00`–`0xff`
range, not just the handful this project has documented so far.

## Confirmed command → handler address table

All values `r0` is compared against in the dispatcher, with resolved handler
addresses where the branch leads to a `mov r0,r4 / bl <handler> / b
<common-return>` pattern (`r4` = the incoming packet/context pointer, `0x140610`
= shared epilogue, `pop {r4,r5,r6,pc}`):

| Command (hex) | Command (dec) | Known meaning (`docs/PROTOCOL.md`) | Handler address |
|---|---|---|---|
| `0x01` | 1 | `SET_TIME` | not isolated in this pass (falls in the `0x39`-or-lower branch, unexplored) |
| `0x03` | 3 | `BATTERY` | not isolated in this pass |
| `0x15` | 21 | `READ_HEART_RATE` | referenced (`cmp r1,#0x15`) elsewhere but not in *this* dispatcher directly — likely dispatched from a different/nested table; unresolved |
| `0x39` | 57 | — | `0x140500` |
| `0x43` | 67 | `GET_STEP_SOMEDAY` | **`0x00142364`** |
| `0x44` | 68 | `SLEEP` (experimental in our docs) | **`0x001351d8`** — **shared with `0x68` and `0x80`, see below** |
| `0x46` | 70 | — | `0x00142364`? (`b #0x140648` → `bl 0x1424fc`, close to the steps handler — unconfirmed relation) |
| `0x50` | 80 | — | `0x0014062e` → `bl 0x131f34` |
| `0x60` | 96 | — | `0x140500` (shared with `0x39`) |
| `0x61` | 97 | — | falls through to generic-error path (`0x140604`) |
| `0x68` | 104 | **undocumented** | **`0x001351d8` — same handler as `SLEEP` (`0x44`)** |
| `0x69` | 105 | `START_REAL_TIME` | **`0x001322b0`** |
| `0x6a` | 106 | `STOP_REAL_TIME` | **`0x00132228`** |
| `0x75` | 117 | — | generic-error path |
| `0x76`,`0x81` | 118, 129 | — | `0x14054a` (`pop`, i.e. no-op/ack only) |
| `0x77`,`0x80`,`0xc7` | 119, 128, 199 | — | **`0x0014065c` → `bl 0x1351d8`, the same handler as `SLEEP`** |
| `0x78` | 120 | — | generic-error path |
| `0x90` | 144 | — | generic-error path |
| `0x91` | 145 | — | `0x14066c` → `bl 0x13475a` |
| `0x92` | 146 | — | `0x140678` → `bl 0x13490e` |
| `0x93` | 147 | — | `0x140680` → `bl 0x13487c` |
| `0x94` | 148 | — | `0x140688` → `bl 0x134784` |
| `0x9b` | 155 | — | `0x140676` → `0x1406c8` → `bl 0x134808` |
| `0x9c` | 156 | — | `0x140692` → `0x1406d0` → `bl 0x13492c` |
| `0x9e` | 158 | — | `0x140694` → `0x1406da` → `bl 0x1348cc` |
| `0x9f` | 159 | — | `0x1406f2` → `bl 0x13490c` |
| `0xa0` | 160 | — | `0x140690` → `0x1406e2` → `bl 0x134954` |
| `0xa1` | 161 | — | `0x140696` → `0x1406ea` → `bl 0x1349e0` |
| `0xb0` | 176 | — | `0x1406fa` → `bl 0x134244` |
| `0xbf` | 191 | — | `0x140674` → `0x140702` (unexplored) |
| `0xc8` | 200 | — | `0x1406d8` → `0x140724` (unexplored) |
| `0xc9` | 201 | — | generic-error path |
| `0xf0`,`0xf1` | 240, 241 | — | `0x14056e` / `0x1405fa` (`pop`, no-op/ack only) |
| `0xff` | 255 | — | `0x14065c` — **same handler as `SLEEP`/`0x68`/`0x77`/`0x80`/`0xc7`** |

"Generic-error path" = `0x140604`: `bl 0x133d78 / pop {r4,r5,r6,pc}` — a
shared fallback, presumably an unsupported-command response.

## The most important finding: `SLEEP` is not a standalone command

**Command `0x44` (68, `SLEEP`) shares its handler (`0x001351d8`) with at
least four other command bytes**: `0x68` (104), `0x77` (119), `0x80` (128),
`0xc7` (199), and `0xff` (255, which is also the documented
"no data"/error sentinel elsewhere in the protocol — worth independent
confirmation whether this is coincidental or meaningful). None of these
aliases are documented in `colmi_r02_client`, `colmi.puxtril.com`, or our
own `docs/PROTOCOL.md`. This strongly suggests the sleep/"big data" command
family is broader than what's been empirically observed over BLE, and the
shared handler likely branches internally on the original command byte
(there's a `cmp r1, #0x44`-shaped comparison inside that handler region, per
an earlier, less rigorous disassembly pass — **not independently
re-confirmed, see Limitation below**).

## Limitation: can't reliably go deeper with this tooling

The dispatcher itself decoded perfectly because it's pure compare/branch
logic with no embedded data. Actual handler *bodies* — including
`0x001351d8`, the `SLEEP` handler — embed **literal pools** (`ldr rX, [pc,
#imm]` constant loads placed inline in the instruction stream, standard for
ARM/Thumb since there's no way to load large immediates directly). A naive
linear/resync disassembly has no way to distinguish "this 32-bit value is a
constant" from "this is code," and once it walks into a literal pool it
misdecodes the raw data as nonsense instructions (recognizable by physically
impossible branch targets like `bl #0xff929ac0` — Thumb's `BL` only has a
±16MB range, so a target that far outside the ~1MB image is a clear sign of
a misdecode, not a real call).

**This is exactly the wall `../README.md`'s proposed methodology anticipated**
— going further (confirming the `SLEEP` handler's internal branch on the
original command byte, and — the actual goal — finding where it parses/
builds the 16-byte response packet to nail down the stage/quality field
layout) needs a real disassembler that tracks code/data separation and
cross-references (Ghidra, per the original plan), not further effort with
plain Python + capstone linear sweeps.

## Recommended next step

Set up Ghidra (headless is fine — `analyzeHeadless`, no GUI needed) against
`Flash_800000_3.0.06_Firmware.bin`'s payload at base address `0x00128000`,
let its auto-analysis handle literal pools and cross-references properly,
then:

1. Confirm/correct this table (auto-analysis may find dispatcher entries
   this manual pass missed, e.g. `0x01`/`0x03`/`0x15` weren't isolated here).
2. Decompile `0x001351d8` (the shared `SLEEP` handler) and trace how it
   distinguishes its five known command-byte aliases.
3. Follow it to wherever it writes the 16-byte response packet to identify
   the real field layout — the actual point of this whole exercise.
4. Repeat the same address (`0x001351d8`, pending confirmation the load
   address holds across versions — see `header-formats.md`) against the
   3.00.17 OTA package once loaded at its assumed address, to check whether
   anything changed between versions.
