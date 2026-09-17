# SLEEP handler analysis — Ghidra-confirmed findings (and a correction)

Produced with a real disassembler (Ghidra 12.1.3, headless) against
`Flash_800000_3.0.06_Firmware.bin`, following on from the manual/capstone
pass in [`command-dispatcher.md`](command-dispatcher.md). Setup is
reproducible — see [`../GHIDRA_SETUP.md`](../GHIDRA_SETUP.md). Scripts used:
[`../scripts/DumpFunctions.java`](../scripts/DumpFunctions.java),
[`../scripts/FindXrefs.java`](../scripts/FindXrefs.java).

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

## Where the queue consumer wasn't found (yet)

Searched for references to the queue's RAM address (`0x0010615c`) using
Ghidra's reference manager (`FindXrefs.java`) — came up empty, despite the
enqueue function definitely reading/writing it. This is very likely a tool
limitation, not evidence the queue is unused: Ghidra's basic reference
manager tracks direct reads/writes and calls, but the queue address here is
only reachable through a `ldr rX,[pc,#imm]` literal-pool load (giving
`0x0010615c` as a *value*, not a direct memory operand) — the decompiler
resolves this via constant propagation, which doesn't necessarily populate
the reference database the same way. Finding the consumer needs a broader
pass: decompile every function in the binary (not just the handful of
addresses we already knew to target) and text-search the pseudocode for
`0010615c`, or use Ghidra's full analysis rather than the fast headless
default. **Left as the concrete next step** for anyone picking this up —
it's the direct path to actually resolving `SLEEP`'s field layout.

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

- **Primary**: find and decompile the consumer of the `0x0010615c` queue —
  this is what actually builds `SLEEP`'s (and the other four aliased
  commands') response packets, and is the real target for resolving the
  sleep field-layout question this whole `firmware-re/` effort exists for.
- Locate and decompile the `READ_HEART_RATE` (`0x15`)/`BATTERY`
  (`0x03`)/`SET_TIME` (`0x01`) handlers — not covered in this pass, and the
  heart-rate one specifically could confirm/explain the `sub_type == 23`
  "today" quirk directly from source rather than by empirical
  black-box observation.
- Confirm whether `_DAT_001323f8` (`START_REAL_TIME`'s session state) and
  `_DAT_001322ac` (`STOP_REAL_TIME`'s) are the same struct.
- What is real-time reading type `0x06`, referenced in the `START_REAL_TIME`
  handler but absent from `docs/PROTOCOL.md`'s `RealTimeReading` values?
