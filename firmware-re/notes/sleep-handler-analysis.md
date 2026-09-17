# SLEEP handler analysis — resolved: it's a permanent stub in this firmware

**Bottom line**: on firmware 3.00.06, the ring's `SLEEP` (`0x44`) command
handler is a straight-line function with no branches that always responds
"no data" (`sub_type == 0xFF`), regardless of what's requested. There's no
sleep field layout to document because this firmware build never sends real
sleep data over this command — see "Update: found the consumer, and
resolved the actual question" below for the full trail.

Produced with a real disassembler (Ghidra 12.1.3, headless) against
`Flash_800000_3.0.06_Firmware.bin`, following on from the manual/capstone
pass in [`command-dispatcher.md`](command-dispatcher.md). Setup is
reproducible — see [`../GHIDRA_SETUP.md`](../GHIDRA_SETUP.md). Scripts used:
[`../scripts/ColmiDumpFunctions.java`](../scripts/ColmiDumpFunctions.java),
[`../scripts/ColmiFindXrefs.java`](../scripts/ColmiFindXrefs.java).

## Headline finding: the "SLEEP handler" isn't sleep-specific at all

`command-dispatcher.md` identified `0x001351d8` as the function the
dispatcher calls for command `0x44` (`SLEEP`), shared with four other
undocumented command bytes (`0x68`, `0x77`, `0x80`, `0xc7`). Decompiled, its
entire body is:

```c
void handler_for_CMD_SLEEP(undefined4 param_1 /* incoming 16-byte packet */)
{
  ushort idx = *(ushort *)(QUEUE + 2);          // QUEUE = 0x0010615c (RAM)
  memcpy((void *)(QUEUE + 4 + idx * 0x10), &param_1, 0x10);  // append packet
  *(ushort *)(QUEUE + 2) = (idx < 9) ? idx + 1 : 0;           // advance, wrap at 10
}
```

(`func_0xff929ac0` is a call into ROM outside the analyzed binary's address
range — its 3-argument shape `(dest, src, len=0x10)` and behavior are
consistent with a ROM-resident `memcpy`, matching the earlier finding in
`command-dispatcher.md` that calls like this land at implausible-looking
`0xff92xxxx`/`0xff93xxxx` addresses, which are really out-of-range branches
into code this analysis pass didn't import.)

**This is a generic 10-slot circular buffer append, not protocol-specific
logic.** It copies the raw incoming 16-byte packet verbatim into a RAM ring
buffer at address `0x0010615c` and advances an index — nothing here reads
`SLEEP`'s specific fields, builds a response, or even looks at which of the
five aliased command bytes triggered it. The five commands sharing this
handler are simply the ones that get **deferred to a queue for asynchronous
processing** rather than handled synchronously in the BLE write callback —
consistent with what we've observed empirically (multi-packet log responses
for heart-rate/steps/sleep all stream in over a visible delay, unlike
`BATTERY`'s instant single-packet reply). The real logic that reads a queued
packet, decodes which of the five commands it actually was (presumably by
re-inspecting the packet's own byte 0), and does the actual work — including
whatever `SLEEP`'s response field layout actually is — **lives elsewhere,
in whatever function drains this queue.**

## Update: found the consumer, and resolved the actual question

**`SLEEP` never returns real data on this firmware build — it's a permanent
stub.** Full trail, in order:

1. `ColmiFindXrefs.java`'s reference-manager search for `0x0010615c` came up
   empty — a tooling limitation (Ghidra's basic reference manager doesn't
   reliably track values only reachable through a `ldr rX,[pc,#imm]`
   literal-pool load followed by decompiler-level constant propagation).
2. Decompiling all 410 functions Ghidra's light auto-analysis had already
   found (`ColmiSearchDecompiled.java`, grepping every result for
   `10615c`) also came up empty — the consumer wasn't among them, meaning
   auto-analysis never discovered it as a function at all.
3. A raw byte-pattern search for the literal `5c 61 10 00` (`0x0010615c`
   little-endian) across the *entire* 512KB flash dump found exactly two
   hits: the already-known one inside the enqueue function (`0x1351fc`),
   and a second one at `0x1351c8` — just 16 bytes before the enqueue
   function's own entry point, in a ~300-byte gap auto-analysis had never
   explored.
4. Force-disassembling at `0x1350e8` (the actual start of that gap) revealed
   the consumer: a queue-draining dispatch loop that reads each queued
   packet's own command byte and branches on it — `SLEEP` (`0x44`) calls
   **`FUN_0014233a`**.
5. `FUN_0014233a`, decompiled in full, is a **straight-line function with no
   branches at all**:

   ```c
   void FUN_0014233a(void)
   {
     // zero a 0x120-byte scratch buffer
     memset(auStack_128, 0, 0x120);
     // set byte 0 of the response payload to 0xFF ...
     local_138 = 0xff;
     // ... and send it as a 1-byte payload with command byte 0x44
     send_packets(0x44, &local_138, 1);
   }
   ```

   `send_packets` (`FUN_00133f4e`, confirmed by decompiling it directly) is
   the generic "build `[command][up to 14 payload bytes][checksum]`, repeat
   for however many packets the payload needs" helper — and in the process
   this **independently confirms `FUN_001372f8` is the checksum function**
   (called as `checksum(packet, 0xf)`, matching `docs/PROTOCOL.md`'s
   sum-of-first-15-bytes-mod-256 algorithm exactly) **and `FUN_001356e8` is
   the BLE-notify-send function** — both already inferred from the
   `GET_STEP_SOMEDAY` handler's decompilation, now confirmed from a second,
   independent call site.

   With payload `[0xFF]`, the resulting packet is `[0x44][0xFF][13 zero
   bytes][checksum]` — byte 1 (the `sub_type` field, per
   `docs/PROTOCOL.md`) is unconditionally `0xFF`, the documented "no data"
   sentinel. There is no data-dependent branch anywhere in this function
   that could ever produce anything else.

**This matches every real-hardware test from this session exactly** — the
ring consistently returned "no data" for `SLEEP` regardless of when it was
polled. That's not a bug in the webapp/ESPHome parsers; the firmware itself
never implements sleep-log construction for command `0x44` in this build.
Sleep tracking, if the OEM app surfaces it at all for this ring, must come
from either a different command entirely, or be computed client-side by the
app from other data (e.g. accelerometer/HR history) rather than served by
the ring as a dedicated log — neither of which this analysis has looked
into.

The dispatch loop at `0x1350e8` also resolves real handler addresses for
the other four commands that share `SLEEP`'s enqueue path — not yet
decompiled individually, but worth doing if any of them turn out to matter:
`0x68` → a short call sequence ending in a `2000`-argument call (plausibly a
delay/timeout in ms); `0x77` → `FUN_0014217c`; `0x81` → `FUN_00135be0`
(passed a pointer into the queued packet's own payload, so — unlike
`SLEEP` — this one *does* look at its input); `0xc6` (not `0xc7` as
originally guessed — see note below) → branches on the queued packet's byte
1, one path calling `FUN_00133f2c` (the single-packet-status variant of the
send helper, also decompiled here) with argument `0xc6`; `0xff` →
`FUN_00133c10`.

**Important correction (see `buffer-inventory.md`): this grouping is not
semantically meaningful.** Decompiling `0x68`'s actual target
(`colmi_00143e10`) shows it's a broad "refresh several unrelated subsystems"
trigger calling nine other functions, none of which are sleep-adjacent.
`SLEEP`, `0x68`, `0x77`, `0x81`, `0xc6`, and `0xff` share the same enqueue
path purely because it's a generic **deferred/background-processing queue**
used by any slow operation — not because they're related to sleep or to
each other. Don't read anything thematic into "shares `SLEEP`'s queue."

**Not a transcription error — a real finding**: re-checked against the raw
dispatcher disassembly in `command-dispatcher.md`, and it genuinely enqueues
`0xc7` (`cmp r0,#0xc7` at `0x1405cc`), while the consumer's explicit case is
for `0xc6` (one less). So `0xc7` reaches the consumer, matches no case in
the if-chain, and is silently dequeued with **no response sent at all** —
same fate as `0x80`, which the consumer also has no explicit case for. Both
appear to be accepted-but-unimplemented commands in this build.

## Bonus finding: `GET_STEP_SOMEDAY` (`0x43`) handler internals

Unlike `SLEEP`, this one *is* handled synchronously (matches its
known-reliable real-world behavior), and its decompilation independently
confirms details from [`../../docs/PROTOCOL.md`](../../docs/PROTOCOL.md):

- In-memory step records are exactly **12 bytes** each (`auStack_19c[n*6]`
  where the array is `ushort`-typed, so `n*6` ushorts = `n*12` bytes) —
  matches the wire protocol's per-entry layout exactly (BCD date × 3 +
  time_index + index/total × 2 + calories × 2 + steps × 2 + distance × 2 =
  12 bytes).
- Request byte 1 (day offset) is read directly as `*(byte*)(param_1 + 1)`
  and subtracted from a "today" reference to compute the target day —
  matches `docs/PROTOCOL.md`'s documented request format.
- **"Today" vs. historical requests take genuinely different code paths**:
  for a historical day (`dayOffset != 0`), the slot-count cap is a **fixed
  constant, `0x17` (23)**; for "today," the cap instead comes from a
  time-of-day calculation (`func_0xff9299e8(x, 0x3c)`, `0x3c` = 60 — plausibly
  minutes-based). Both cap the same loop that walks 12-byte records looking
  for ones with real data.

**Possibly relevant to `docs/PROTOCOL.md`'s heart-rate `sub_type == 23`
quirk**: seeing the literal constant `23` used specifically as a
"how-far-to-walk-for-a-non-today-request" cap in a *different* command's
handler is a suggestive structural parallel — this firmware seems to treat
"23 [somethings] in a day" as a recurring boundary — but this is **not
proof of a connection**, just worth flagging. The heart-rate log's actual
handler hasn't been located/decompiled yet (it wasn't one of this pass's
targets — see Open Questions).

## Bonus finding: `START_REAL_TIME`/`STOP_REAL_TIME` (`0x69`/`0x6a`) internals

Both maintain a shared session-state struct (`_DAT_001323f8` /
`_DAT_001322ac` — worth checking later whether these are the *same* address,
plausible given the sequential-looking values) with fields for: current
reading type (offset `+7`, matches `docs/PROTOCOL.md`'s byte-1
reading-type), an action/state byte (`+8`), and a retry/attempt counter
(`+9`, checked against `0x3c`/60 and `0x32`/50 as apparent limits). The
response packet both build is `[command_echo, reading_type, status, ...]`,
consistent with `docs/PROTOCOL.md`'s documented real-time response shape
(byte 1 = reading type, byte 2 = error code). `0x69`'s handler additionally
special-cases reading-type `0x06` with its own sub-action byte (`0x01`-`0x04`
seen: start/pause/continue/stop-like), which doesn't obviously map to
anything in `docs/PROTOCOL.md`'s `RealTimeReading` enum (values 1-10
documented) — reading type `6` isn't one we've named. Worth a follow-up look
if real-time streaming behavior for an unlisted reading type ever comes up.

## Open questions

- **Confirm this holds on 3.00.17.** Everything above is from the 3.00.06
  full-flash dump. We have 3.00.17 only as an OTA package with an assumed
  (not independently verified) load address — see `header-formats.md`. If
  that assumption holds, the same `0x0014233a`-equivalent should be
  checkable there too; if `SLEEP` behaves differently on 3.00.17, that would
  be a significant, actionable finding for this project (our physical test
  ring — see the earlier `Poll cycle complete` / `has_data=NO` hardware
  logs from this session — is closer to 3.00.17's era, and its behavior
  matched this stub exactly, which is circumstantial support that 3.00.17
  behaves the same way, but not proof).
- What do `0x68`, `0x77`, `0x81`, and `0xff` (the other commands sharing the
  `SLEEP` enqueue path) actually do? Their handler addresses are known
  (`0x0014217c`, `0x00135be0`, `0x00133c10`, plus `0x68`'s short sequence)
  but none have been decompiled individually yet. `0x81` is the most
  interesting of these — unlike `SLEEP`, it's passed a pointer into its own
  queued payload, meaning it actually inspects its input.
- Locate and decompile the `READ_HEART_RATE` (`0x15`)/`BATTERY`
  (`0x03`)/`SET_TIME` (`0x01`) handlers — not covered in this pass, and the
  heart-rate one specifically could confirm/explain the `sub_type == 23`
  "today" quirk directly from source rather than by empirical
  black-box observation.
- Confirm whether `_DAT_001323f8` (`START_REAL_TIME`'s session state) and
  `_DAT_001322ac` (`STOP_REAL_TIME`'s) are the same struct.
- What is real-time reading type `0x06`, referenced in the `START_REAL_TIME`
  handler but absent from `docs/PROTOCOL.md`'s `RealTimeReading` values?
