#!/usr/bin/env python3
"""Locate and print the BLE command dispatcher in a full-flash dump.

Confirmed approach (see ../notes/command-dispatcher.md): Cortex-M0 (ARMv6-M)
has no TBB/TBH table-branch instructions, so a switch on the command byte
compiles to a chain of CMP/BEQ/BGT. This does a resync-tolerant linear
disassembly of the main code region and reports every CMP against an
immediate, then the caller can eyeball the dense cluster that is the real
dispatcher (distinguishing it from incidental `cmp rX, #1`/`#3`-style noise
elsewhere in the binary).

Usage: python find_dispatcher.py [path/to/Flash_800000_*.bin]
Requires: pip install capstone
"""

import sys
from pathlib import Path

from capstone import CS_ARCH_ARM, CS_MODE_THUMB, Cs

BX24_HEADER_LEN = 0x18
BASE_ADDR = 0x00128000  # confirmed for 3.00.06; re-verify per notes/header-formats.md for other versions
CODE_LEN = 0x1F9F4  # main app-code region before the first large erased-flash gap


def linear_disasm_resync(code: bytes, base: int):
    """Yield (addr, mnemonic, op_str) for a best-effort linear sweep,
    skipping one halfword and retrying whenever decode fails. Reliable for
    branch-only regions (like the dispatcher); NOT reliable once it walks
    into a literal pool - see notes/command-dispatcher.md."""
    md = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
    n = len(code)
    off = 0
    while off < n:
        chunk = code[off:off + 4]
        got_one = False
        for insn in md.disasm(chunk, base + off):
            yield insn.address, insn.mnemonic, insn.op_str
            off += insn.size
            got_one = True
            break
        if not got_one:
            off += 2


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "dumps" / "Flash_800000_3.0.06_Firmware.bin"
    data = path.read_bytes()
    if data[0:4] != b"BX24":
        print(f"{path}: not a BX24 full-flash dump, aborting")
        return

    payload = data[BX24_HEADER_LEN:]
    code = payload[0:CODE_LEN]

    print(f"Scanning {path.name} for CMP-against-immediate clusters...")
    cmp_addrs = []
    for addr, mnem, ops in linear_disasm_resync(code, BASE_ADDR):
        if mnem == "cmp" and "#" in ops:
            cmp_addrs.append(addr)

    # A dispatcher shows up as a dense run of cmp instructions close together
    # (within a few bytes of each other, repeatedly, over a spread of ~0x100
    # bytes) - report the densest window as a hint.
    best_start, best_count = None, 0
    window = 0x110
    for a in cmp_addrs:
        count = sum(1 for b in cmp_addrs if a <= b < a + window)
        if count > best_count:
            best_start, best_count = a, count

    if best_start is None:
        print("No CMP clusters found.")
        return

    print(f"\nDensest CMP cluster: {best_count} compares starting near {best_start:#010x}")
    print("(known dispatcher for 3.00.06 starts at 0x140502 - see notes/command-dispatcher.md)")
    print("Re-run with logger output above and inspect manually; this script finds the")
    print("candidate region, it doesn't replace reading the actual instructions.")


if __name__ == "__main__":
    main()
