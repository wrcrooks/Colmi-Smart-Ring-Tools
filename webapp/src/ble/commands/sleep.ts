import { CMD } from "../constants";
import { bcdToDecimal, makePacket } from "../packet";

/**
 * EXPERIMENTAL: sleep history ("big data" command 68). The request/framing
 * mirrors the steps command, but the byte layout carrying sleep stage/quality
 * is not conclusively decoded upstream. See docs/PROTOCOL.md before trusting
 * `stageRaw`/`qualityRaw` for anything beyond raw-bytes debugging.
 */
export function readSleepPacket(dayOffset = 0): Uint8Array {
  return makePacket(CMD.SLEEP, [dayOffset, 0x0f, 0x00, 0x5f, 0x01]);
}

export interface SleepEntry {
  year: number;
  month: number;
  day: number;
  timeIndex: number;
  /** Unverified — raw byte(s) suspected to encode sleep stage/quality. */
  stageRaw: number;
  qualityRaw: number;
}

export function sleepEntryTimestamp(e: SleepEntry): Date {
  return new Date(
    Date.UTC(e.year, e.month - 1, e.day, Math.floor(e.timeIndex / 4), (e.timeIndex % 4) * 15),
  );
}

export const NO_DATA = Symbol("NoSleepData");
export type SleepResult = SleepEntry[] | typeof NO_DATA;

/** Stateful parser mirroring SportDetailParser's framing. Experimental — see above. */
export class SleepLogParser {
  private index = 0;
  private entries: SleepEntry[] = [];

  private reset(): void {
    this.index = 0;
    this.entries = [];
  }

  parse(packet: Uint8Array): SleepResult | null {
    if (this.index === 0 && packet[1] === 255) {
      this.reset();
      return NO_DATA;
    }

    if (this.index === 0 && packet[1] === 240) {
      this.index += 1;
      return null;
    }

    const year = bcdToDecimal(packet[1]) + 2000;
    const month = bcdToDecimal(packet[2]);
    const day = bcdToDecimal(packet[3]);
    const timeIndex = packet[4];

    this.entries.push({
      year,
      month,
      day,
      timeIndex,
      stageRaw: packet[7],
      qualityRaw: packet[8],
    });

    if (packet[5] === packet[6] - 1) {
      const result = this.entries;
      this.reset();
      return result;
    }

    this.index += 1;
    return null;
  }
}
