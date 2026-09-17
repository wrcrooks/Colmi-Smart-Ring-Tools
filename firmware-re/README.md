# Firmware reverse-engineering — requirements & plan

**Status: not started.** This folder documents what's needed to decompile and
reverse-engineer the ring's actual on-chip firmware (currently observed as
version **3.00.17** on a Colmi R06), as distinct from the BLE application
protocol already covered in [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md).
Nothing in `webapp/` or `esphome/` depends on this work — it's a separate,
optional deep-dive for whoever wants to pursue it.

## Why this is a different, harder problem

Everything else in this repo was built by observing BLE traffic — writing a
command, watching the response — without ever touching the ring's internal
code. That's sufficient to *use* the ring, but not to explain *why* it
behaves the way it does (e.g. the heart-rate log's undocumented
`sub_type == 23` termination quirk we hit empirically in
[`docs/PROTOCOL.md`](../docs/PROTOCOL.md#heart-rate-log-read_heart_rate-21),
or the still-unverified sleep-log field layout). Answering those requires the
actual firmware binary and an ARM disassembler — a materially bigger
undertaking involving hardware debugging and embedded reverse engineering,
not just protocol observation.

## What's already public

[`atc1441/ATC_RF03_Ring`](https://github.com/atc1441/ATC_RF03_Ring) has done
adjacent work worth building on rather than repeating:

- Raw flash dumps for firmware **3.00.02** and **3.00.06**
  (`Flash_800000_*.bin`), plus a bootloader/BLE-stack ROM dump
  (`ROM_0_first128k_Bootloader_BLE_stack.bin`). Neither matches our target
  version (3.00.17), but they're a useful reference for memory layout and a
  fallback if dumping our own ring proves difficult.
- A **vendor SDK** for the BlueX RF03 (`SDKs/BLE_SDK_V2.1-V2.1.zip`,
  `SDKs/SDK3_3.3.6/`) — likely the single highest-value input for this
  project, since it should contain register definitions, a linker script,
  and possibly reference source that lets disassembled functions be matched
  to real names instead of reverse-engineered from scratch.
  **License status unclear — do not commit its contents to this repo (or
  redistribute them at all) until that's confirmed; treat it as a private
  reference only.**
- A working **binary-patched firmware build**
  (`R02_3.00.06_FasterRawValuesMOD.bin`), proving at least enough static
  analysis was done to locate and modify specific behavior in a real stock
  build.
- The SoC datasheet (`BLueX_RF03-01_Datasheet-V3.2.pdf`) and accelerometer
  datasheet, plus confirmation the firmware is **unencrypted and unsigned**.
- Two YouTube walkthroughs linked from that repo's README with more
  procedural detail than is written up anywhere in text.

None of that repo's binaries or the vendor SDK should be copied into this
one — link to them, don't vendor them (see Legal, below).

## Requirements

### 1. The firmware binary itself (blocking — nothing else can start without this)

Two options, in order of preference:

**Option A — dump it directly from a ring you own (recommended).** The SoC
exposes SWD debug pins on the PCB: `P00` = SWCK, `P01` = SWD (per
`atc1441`'s hardware notes). If a physical ring running 3.00.17 is
available, wiring up an SWD probe and dumping flash gets the *exact* binary
in use, with no need to intercept anything over the network or BLE. This is
destructive or at least invasive — the ring's shell will need to be opened
and fine enamel wire soldered to the debug pads, likely under a microscope
given the size of these boards, and the ring should be considered
sacrificed for this purpose (don't use the only ring you're currently
wearing/depending on).

**Option B — capture the OTA update payload.** `atc1441`'s
[OTA flashing tool](https://atc1441.github.io/ATC_RF03_Writer.html) pushes a
*local* `.bin` file to the ring over BLE — it's a writer, not a way to pull
a specific version down. To obtain the 3.00.17 payload this way would mean
intercepting it wherever the *official* Colmi app sources it from (likely an
HTTPS download from a vendor update server, then relayed to the ring over
BLE) — e.g. a TLS-intercepting proxy on the phone running the official app
during an update. This is unexplored territory for this project; the
update-server endpoint, auth, and payload format are all unknown. Treat this
as a fallback if Option A isn't feasible, not the default path.

### 2. Hardware (for Option A)

- An SWD-capable debug probe compatible with ARM Cortex-M0 — e.g. an
  ST-Link, J-Link, Black Magic Probe, or a Raspberry Pi Pico running
  `picoprobe`.
- Fine-pitch soldering equipment (and realistically a microscope or
  strong magnifier) to wire `SWCK`/`SWD`/ground/power to the probe — these
  boards are tiny.
- A bench power supply or other controlled way to power the ring board
  during dumping, independent of its tiny 17mAh cell.
- A spare ring. This is a one-way trip for that unit.

### 3. Software / tooling

- **Flash dump/debug software**: OpenOCD (if it has — or can be given — a
  target config for this SoC) or whatever debug tooling ships in the
  vendor SDK mentioned above.
- **Disassembler/decompiler**: the chip is ARM Cortex-M0 (Thumb-1
  instruction set only, no Thumb-2/ARM mode).
  [Ghidra](https://ghidra-sre.org/) (free, solid Cortex-M/Thumb support) is
  the natural choice; IDA Pro is a paid alternative with a stronger
  decompiler if budget allows.
- The **SoC datasheet** (already in `atc1441`'s repo) for the MMIO/peripheral
  memory map, needed to recognize hardware register accesses in the
  disassembly instead of treating them as opaque memory reads/writes.
- The **vendor SDK**, for the reasons above — this is what turns "a pile of
  Thumb instructions" into "recognizable functions."

### 4. Skills

- Reading ARM Cortex-M/Thumb assembly and recognizing common compiler
  idioms (this firmware is presumably compiled C, not hand-written asm).
- General embedded firmware structure: vector table, reset handler, RTOS or
  bare-metal main loop, interrupt-driven BLE stack callbacks.
- Familiarity with a proprietary/vendor BLE stack's shape, to distinguish
  SDK/stack code (not interesting) from application-specific code (the
  actual target — the command handlers for the protocol in
  `docs/PROTOCOL.md`, plus whatever isn't in that doc yet).
- Ghidra proficiency (or IDA, if used instead): defining memory maps,
  importing type/struct information, cross-referencing strings and
  constants back to code.

### 5. Legal / ethical considerations

- Reverse-engineering for interoperability has reasonably broad protection
  in a number of jurisdictions (e.g. the US DMCA's interoperability
  exemption, the EU Software Directive's Article 6) — analyzing the binary
  to understand and document its behavior, the way this project already
  does for the BLE protocol, sits on solid ground. This is **not legal
  advice**; consult an actual lawyer if this matters to you.
- Redistribution is a different question from analysis. The stock firmware
  binary and the vendor SDK are almost certainly copyrighted by BlueX/the
  ring OEM. **Don't commit the firmware binary, the vendor SDK, or any
  direct excerpts of either into this repo.** Findings (documented
  behavior, memory maps, protocol semantics) are fine to publish; the
  copyrighted artifacts themselves are not.
- The ring/app's EULA may prohibit reverse engineering as a matter of
  contract even where it's legally permitted otherwise — a practical/
  reputational consideration, not just a legal one, worth being aware of
  before publishing anything derived from this work under your own name.

## Proposed methodology (once the binary is in hand)

1. Load the dump into Ghidra as raw binary, processor = ARM Cortex-M0,
   Thumb mode. Set the base address from the datasheet's flash memory map
   (0x00000000 or wherever flash is mapped for this SoC — confirm against
   the datasheet rather than assuming).
2. Identify the vector table at the start of flash (stack pointer + reset
   handler are the first two words) to get a solid entry point.
3. Import whatever structure/register definitions can be extracted from the
   vendor SDK to label MMIO accesses as they're encountered, rather than
   reverse-engineering the peripheral map from scratch.
4. Anchor onto known behavior: search for the packet checksum routine
   (sum-of-bytes-mod-256, per `docs/PROTOCOL.md`) and the known command
   byte constants (`1`, `3`, `21`, `67`, `68`, `105`, `106`, ...) to pivot
   from "undifferentiated code" into the actual BLE command dispatch table
   and its handlers.
5. Prioritize the two open questions this repo already flags as unresolved:
   - The heart-rate log's `sub_type == 23` "today" termination behavior —
     confirm *why* it happens, not just that it does.
   - The sleep log's (`SLEEP`, 68) field layout — this is the most valuable
     target, since it's currently pure speculation in both the webapp and
     the ESPHome component.
6. Write findings up as Markdown in `firmware-re/notes/`, cross-linking back
   to and correcting/extending `docs/PROTOCOL.md` wherever this work
   resolves something that was previously observed-but-unexplained.

## Where things go in this folder

- `dumps/` — firmware binaries and any vendor SDK extracts go here,
  **gitignored** (see below) — never committed.
- `notes/` — written findings, memory maps, function inventories; this is
  the actual output of the work and should be committed.

## Open questions

- Where does the official Colmi app actually source OTA updates from
  (endpoint, auth), if Option B ends up necessary? Unresearched.
- Does OpenOCD already have (or need) a target config for this specific
  SoC, or does dumping require the vendor's own debug tooling from the SDK?
  Unresearched.
- Exact flash base address / memory map for Ghidra — should come from the
  datasheet, not been confirmed here yet.
