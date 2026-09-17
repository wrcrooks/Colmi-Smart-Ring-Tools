# Ghidra headless setup (reproducible)

Used to produce [`notes/sleep-handler-analysis.md`](notes/sleep-handler-analysis.md).
No GUI needed — everything here runs via `analyzeHeadless`.

## Get the tools

Download into a local, **gitignored** directory outside version control —
this repo's root `.gitignore` excludes `.tools/`, use that or anywhere else
outside the repo:

- Ghidra (12.1.3 used here):
  `https://github.com/NationalSecurityAgency/ghidra/releases` — grab the
  `_PUBLIC_*.zip` build for the current release, unzip it.
- A JDK Ghidra 12.x actually supports (JDK 17+; JDK 21 used here) — plain
  Java 8 is *not* enough. Any distribution works, e.g. Temurin:
  `https://github.com/adoptium/temurin21-binaries/releases` — get the
  Windows x64 `OpenJDK21U-jdk_x64_windows_hotspot_*.zip`, unzip it.

Set `JAVA_HOME` to the extracted JDK directory before running
`support/analyzeHeadless` (or `analyzeHeadless.bat` on Windows) — it doesn't
pick up a bundled JDK on its own.

## Import a raw firmware payload

Strip the container header first (24 bytes for a `BX24` full-flash dump —
see [`notes/header-formats.md`](notes/header-formats.md)) so what you import
is exactly what's memory-mapped at the confirmed load address:

```sh
python -c "
data = open('dumps/Flash_800000_3.0.06_Firmware.bin','rb').read()
open('dumps/app_payload_3.0.06.bin','wb').write(data[0x18:])
"
```

Then import + auto-analyze + run a post-script in one shot. **Important:**
the Ghidra *project* path must not contain a path segment starting with `.`
(e.g. a `.tools/` directory) — it'll fail with `Path element starting with
'.' is not permitted`. Put the project somewhere else (a scratch/temp dir is
fine).

```sh
export JAVA_HOME=/path/to/jdk-21
/path/to/ghidra_12.1.3_PUBLIC/support/analyzeHeadless \
  /path/to/scratch/ghidra_project ColmiRE \
  -import dumps/app_payload_3.0.06.bin \
  -processor "ARM:LE:32:Cortex" \
  -loader BinaryLoader -loader-baseAddr 0x00128000 \
  -postScript DumpFunctions.java \
  -scriptPath scripts/
```

`ARM:LE:32:Cortex` is the correct language ID even though the actual chip is
Cortex-M0/ARMv6-M specifically — Ghidra doesn't ship a narrower ARMv6-M-only
variant, and the general Cortex SLEIGH spec disassembles the (smaller)
ARMv6-M instruction subset just fine since it's a strict subset of what that
spec supports.

## Re-running scripts against the same project (no re-import)

The default headless quick-analysis has no seeded entry point for a raw
binary import (no vector table info given), so it only finds functions via
generic prologue-pattern heuristics — it will miss real functions at
addresses you already know about from manual analysis.
[`scripts/DumpFunctions.java`](scripts/DumpFunctions.java) works around this
by explicitly calling `disassemble()`/`createFunction()` at a hardcoded list
of target addresses before decompiling them.

Once a project exists, reuse it instead of re-importing (faster, and keeps
whatever functions/analysis you already committed to the project):

```sh
/path/to/ghidra_12.1.3_PUBLIC/support/analyzeHeadless \
  /path/to/scratch/ghidra_project ColmiRE \
  -process "app_payload_3.0.06.bin" \
  -noanalysis \
  -postScript FindXrefs.java \
  -scriptPath scripts/
```

## Known limitation hit here

Ghidra's basic reference manager doesn't always record a cross-reference for
values the *decompiler* resolves through a `ldr rX, [pc, #imm]` literal-pool
load followed by further pointer dereferences (constant propagation is a
decompiler-level analysis, not necessarily reflected back into the
reference database automatically). `FindXrefs.java`'s
`getReferencesTo(addr)` approach works for direct references (e.g. "who
calls this function") but came up empty when searching for consumers of a
RAM address only reachable through such an indirect chain — see
`notes/sleep-handler-analysis.md`'s open question. A deeper pass (e.g.
decompiling every function in the binary and grepping the pseudocode text,
or Ghidra's function-graph/BSim tooling) would be needed to chase that
further.
