#!/usr/bin/env python3
"""Analyze firmware dumps placed in ../dumps/.

Parses the two known container formats (see ../notes/header-formats.md),
confirms the byte-for-byte relationship between a full flash dump and an OTA
update package, and does a quick disassembly sanity-check at the deduced
code start. Read-only — never modifies anything in dumps/.

Usage: python analyze_dumps.py [dumps_dir]

Requires: pip install capstone
"""

import collections
import math
import struct
import sys
from pathlib import Path

try:
    from capstone import CS_ARCH_ARM, CS_MODE_THUMB, Cs
except ImportError:
    Cs = None

# Confirmed against firmware 3.00.06 — see notes/header-formats.md.
BX24_HEADER_LEN = 0x18
OTA_HEADER_LEN = 0x100
OTA_MAGIC = bytes.fromhex("78563412")
BX24_MAGIC = b"BX24"


def u32(b: bytes, off: int) -> int:
    return struct.unpack_from("<I", b, off)[0]


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = collections.Counter(data)
    n = len(data)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def parse_bx24(path: Path) -> dict | None:
    data = path.read_bytes()
    if data[0:4] != BX24_MAGIC:
        return None
    return {
        "path": path,
        "data": data,
        "base_addr": u32(data, 0x04),
        "field_08": u32(data, 0x08),
        "field_0c": u32(data, 0x0C),
        "app_size_field": u32(data, 0x10),
        "app_plus_extra_size_field": u32(data, 0x14),
        "payload": data[BX24_HEADER_LEN:],
    }


def parse_ota(path: Path) -> dict | None:
    data = path.read_bytes()
    if data[0:4] != OTA_MAGIC:
        return None
    size_field = u32(data, 0x08)
    version = data[0x10:0x10 + 32].split(b"\x00", 1)[0].decode("ascii", "replace")
    return {
        "path": path,
        "data": data,
        "hash_or_crc": data[4:8].hex(),
        "size_field": size_field,
        "version": version,
        "header_len_inferred": len(data) - size_field,
        "payload": data[OTA_HEADER_LEN:],
    }


def trailing_run_len(data: bytes, value: int) -> int:
    n = 0
    for b in reversed(data):
        if b == value:
            n += 1
        else:
            break
    return n


def find_payload_offset(flash_payload: bytes, ota_payload: bytes) -> int | None:
    idx = flash_payload.find(ota_payload[:64])
    if idx == -1:
        return None
    end = idx + len(ota_payload)
    if flash_payload[idx:end] == ota_payload:
        return idx
    return None


def preview_disasm(data: bytes, base_addr: int, count: int = 15) -> None:
    if Cs is None:
        print("  (capstone not installed — `pip install capstone` for this step)")
        return
    md = Cs(CS_ARCH_ARM, CS_MODE_THUMB)
    n = 0
    for insn in md.disasm(data, base_addr):
        print(f"    {insn.address:#010x}: {insn.mnemonic}\t{insn.op_str}")
        n += 1
        if n >= count:
            break
    if n == 0:
        print("    (no valid instructions decoded)")


def main() -> None:
    dumps_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent.parent / "dumps"
    if not dumps_dir.is_dir():
        print(f"No such directory: {dumps_dir}")
        return

    bx24_files = []
    ota_files = []
    for f in sorted(dumps_dir.glob("*.bin")):
        head = f.read_bytes()[:4]
        if head == BX24_MAGIC:
            bx24_files.append(f)
        elif head == OTA_MAGIC:
            ota_files.append(f)
        else:
            print(f"{f.name}: unrecognized header {head.hex()} (likely a raw ROM/bootloader dump)")

    parsed_bx24 = {f: parse_bx24(f) for f in bx24_files}
    parsed_ota = {f: parse_ota(f) for f in ota_files}

    for f, info in parsed_bx24.items():
        print(f"\n=== {f.name} (BX24 full-flash format) ===")
        print(f"  base_addr           = {info['base_addr']:#010x}")
        print(f"  field @0x08         = {info['field_08']:#x}")
        print(f"  field @0x0c         = {info['field_0c']:#x}")
        print(f"  app_size_field      = {info['app_size_field']:#x} ({info['app_size_field']})")
        print(f"  app+extra_field     = {info['app_plus_extra_size_field']:#x}")
        real_len = len(info["payload"]) - trailing_run_len(info["payload"], 0xFF)
        print(f"  real code length (before trailing 0xFF pad) = {real_len:#x} ({real_len})")

    for f, info in parsed_ota.items():
        print(f"\n=== {f.name} (OTA package format) ===")
        print(f"  version string      = {info['version']!r}")
        print(f"  hash/crc @0x04      = {info['hash_or_crc']}")
        print(f"  size field @0x08    = {info['size_field']} ({info['size_field']:#x})")
        print(f"  inferred header len = {info['header_len_inferred']} (expected {OTA_HEADER_LEN})")
        print(f"  payload entropy     = {entropy(info['payload']):.3f} bits/byte")

    # Cross-reference: does each OTA payload appear verbatim inside a BX24 dump?
    matched_ota_addrs = {}  # ota file -> confirmed OTA-payload start address
    for ota_f, ota_info in parsed_ota.items():
        for bx24_f, bx24_info in parsed_bx24.items():
            offset = find_payload_offset(bx24_info["payload"], ota_info["payload"])
            if offset is None:
                continue
            addr = bx24_info["base_addr"] + offset
            matched_ota_addrs[ota_f] = addr
            print(f"\n{ota_f.name} payload == {bx24_f.name} payload[{offset:#x}:] "
                  f"=> OTA payload starts at flash address {addr:#010x}")
            print("  disassembly preview at that address:")
            preview_disasm(ota_info["payload"][:64], addr)

    # If we only have an OTA package for a version with no matching BX24 dump,
    # still show a preview assuming the same OTA-payload start address that a
    # *confirmed* match found for another version (same product/toolchain ->
    # same link address is a reasonable, but unverified, assumption).
    unmatched = [f for f in parsed_ota if f not in matched_ota_addrs]
    if unmatched and matched_ota_addrs:
        reference_ota, reference_addr = next(iter(matched_ota_addrs.items()))
        for ota_f in unmatched:
            info = parsed_ota[ota_f]
            print(f"\n{ota_f.name}: no matching full-flash dump present.")
            print(f"  Assuming the same OTA-payload start address confirmed for "
                  f"{reference_ota.name} ({reference_addr:#010x}) - UNVERIFIED for this version.")
            preview_disasm(info["payload"][:64], reference_addr)


if __name__ == "__main__":
    main()
