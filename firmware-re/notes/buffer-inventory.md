# Flash storage infrastructure and data buffer inventory

Follow-on from [`sleep-handler-analysis.md`](sleep-handler-analysis.md),
prompted by asking a bigger question: does this ring track anything
sleep/movement-related on-device at all, even if not exposed via the `SLEEP`
BLE command? Short answer: **no evidence of it found**, but this pass found
a real flash-backed historical storage system and at least one
previously-undocumented data stream instead.

## The flash ring-buffer lookup: `FUN_00144166`

A generic function, signature `find_day_record(buffer_descriptor, day_index,
target_day) -> address_or_0`. Given a small descriptor struct (base index,
record count, record stride), it searches a day-indexed circular buffer —
trying a fast direct-offset path first, falling back to a linear scan that
wraps around the buffer — and returns the flash address of the matching
day's record, or `0` if not found.

**On success it returns `param_2 + 0x00800000`** — i.e. addresses in this
buffer live at flash offset `0x800000` and up. This is almost certainly
where `atc1441`'s dump naming (`Flash_800000_*.bin`) comes from — not an
arbitrary label, but the actual flash base address this lookup (and
presumably the historical-data region generally) uses. Our own full-flash
dump analysis in [`header-formats.md`](header-formats.md) only examined the
first ~130KB (the executable code region starting at `0x00128000`); this
`0x00800000` region is a **separate area of the same physical flash chip**
that a full-flash dump would also capture, just not one we've looked at
byte-for-byte yet.

## Confirmed and candidate consumers of this lookup

| Caller | Record shape | Value range seen | Identity |
|---|---|---|---|
| `FUN_00142acc` → `handler_for_CMD_GET_STEP_SOMEDAY` | 12 bytes/record | — | **Confirmed: steps/calories/distance** (`docs/PROTOCOL.md`) |
| `FUN_0013a18c` | 2 bytes/record, hourly | value byte in `1..100` | Unidentified — value range fits a 0-100-scored wellness metric (stress? a "health score"?) better than raw heart rate. Its result is cached into a small struct but no direct BLE-send call was found in this pass — see Open Questions. |
| `FUN_0014007c` (via `FUN_0013299c`) | 4 bytes/record, 48/day | byte value clamped around `30..50`, out-of-range values run through a transform+offset (`+30`) rather than truncated | Unidentified — a per-day 48-sample series in a narrow ~30-50 band is a plausible shape for **HRV** (commonly tens-of-ms range for RMSSD-style metrics), though not confirmed. **Sends its result over BLE as command byte `0x37` (55)** — undocumented in `docs/PROTOCOL.md`, `colmi_r02_client`, or `colmi.puxtril.com`. |
| `FUN_00142ae8` | 12 bytes/record (same shape as steps) | — | A 6-day rolling aggregate *of the step buffer* — sums a field across 6 consecutive day-records into a small results array. Not a new data type, just a summary view over steps. |

## `0x37` — a genuinely new, currently-unsupported command

`FUN_0013299c` sends its data as `[0x37][...]` via the same generic
multi-packet send helper (`FUN_00133f4e`) used everywhere else — this is a
real, well-formed outgoing command in this protocol, just one nobody
(upstream or this project) has documented. **Caveat**: grepping the
dispatcher table in `command-dispatcher.md` for `0x37` found no match — it
doesn't appear to be directly *requestable* the way `GET_STEP_SOMEDAY` is.
`FUN_0013299c` itself wasn't found to be called from anywhere in this pass
either, so how/when it actually fires (a timer? a side effect of some other
command?) is unresolved. Worth another pass before assuming this is
something the webapp/ESPHome could simply request on demand.

## Bottom line on sleep/movement tracking

Every buffer found and traced in this pass is either confirmed as steps, a
pure aggregate of steps, or an unidentified-but-clearly-*physiological*
(hourly/daily scalar, narrow numeric range) metric — nothing resembling
accelerometer-derived movement classification or sleep staging. Combined
with `SLEEP`'s own handler being a hardcoded stub (see
`sleep-handler-analysis.md`), the evidence so far points toward **this
firmware build not computing sleep on-device at all**, though this isn't
exhaustive — plenty of the ~130KB code region remains untraced, and the two
unidentified buffers above were reached somewhat by chance (following
`SLEEP`'s coincidental neighbors), not from a systematic sweep.

## Open questions

- What are `FUN_0013a18c`'s (1-100, hourly) and `FUN_0014007c`'s (0x37,
  ~30-50 range, 48/day) buffers actually measuring? Both are plausible
  wellness metrics (stress score, HRV) but neither is confirmed.
- What triggers `FUN_0013299c` (the `0x37` sender)? Not found to be called
  from anywhere traced so far in this pass.
- Given the `0x00800000` flash region is now a known, meaningful address
  (not previously understood when `header-formats.md` was written), does
  `atc1441`'s full-flash dump actually include this region, and if so, can
  the *size* of the steps ring buffer be read directly from its descriptor
  struct — which would answer the "how many readings can this ring even
  store" question concretely rather than inferring it from the `23`-slot
  BLE-response cap found in `GET_STEP_SOMEDAY`.
- No systematic sweep for a sleep/accelerometer buffer has been done — this
  pass only followed what happened to be nearby `SLEEP`'s enqueue path. A
  proper search would need to identify *every* caller of `FUN_00144166` (or
  a same-shaped sibling function) across the whole binary, not just the ones
  reachable from where this investigation started.
