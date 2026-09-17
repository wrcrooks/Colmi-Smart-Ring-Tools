import { CMD } from "../constants";
import { makePacket } from "../packet";

export function readHeartRatePacket(targetMidnightUtc: Date): Uint8Array {
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, Math.floor(targetMidnightUtc.getTime() / 1000), true);
  return makePacket(CMD.READ_HEART_RATE, payload);
}

export interface HeartRateLog {
  heartRates: number[];
  timestamp: Date;
  size: number;
  index: number;
  range: number;
}

export const NO_DATA = Symbol("NoHeartRateData");
export type HeartRateResult = HeartRateLog | typeof NO_DATA;

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

function minutesSoFarUtc(now: Date): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((now.getTime() - midnight) / 60000) + 1;
}

export function heartRatesWithTimes(log: HeartRateLog): Array<[number, Date]> {
  const start = Date.UTC(log.timestamp.getUTCFullYear(), log.timestamp.getUTCMonth(), log.timestamp.getUTCDate());
  return log.heartRates.map((hr, i) => [hr, new Date(start + i * log.range * 60000)]);
}

/**
 * Stateful parser for the multi-packet heart-rate log response. Feed it every
 * packet with command id CMD.READ_HEART_RATE; it returns null until the log is
 * complete (or NO_DATA if the ring has nothing for the requested day).
 */
export class HeartRateLogParser {
  private rawHeartRates: number[] = [];
  private timestamp: Date | null = null;
  private size = 0;
  private index = 0;
  private range = 5;

  private reset(): void {
    this.rawHeartRates = [];
    this.timestamp = null;
    this.size = 0;
    this.index = 0;
    this.range = 5;
  }

  private isLogToday(): boolean {
    return this.timestamp !== null && isToday(this.timestamp);
  }

  private normalizedHeartRates(): number[] {
    let hr = [...this.rawHeartRates];
    if (hr.length > 288) hr = hr.slice(0, 288);
    else if (hr.length < 288) hr = hr.concat(new Array(288 - hr.length).fill(0));

    if (this.isLogToday()) {
      const cutoff = Math.floor(minutesSoFarUtc(new Date()) / 5);
      for (let i = cutoff; i < hr.length; i++) hr[i] = 0;
    }
    return hr;
  }

  parse(packet: Uint8Array): HeartRateResult | null {
    const subType = packet[1];

    if (subType === 255) {
      this.reset();
      return NO_DATA;
    }

    if (this.isLogToday() && subType === 23) {
      const result: HeartRateLog = {
        heartRates: this.normalizedHeartRates(),
        timestamp: this.timestamp!,
        size: this.size,
        range: this.range,
        index: this.index,
      };
      this.reset();
      return result;
    }

    if (subType === 0) {
      this.size = packet[2];
      this.range = packet[3];
      this.rawHeartRates = new Array(this.size * 13).fill(-1);
      this.index = 0;
      return null;
    }

    if (subType === 1) {
      const ts = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getInt32(2, true);
      this.timestamp = new Date(ts * 1000);
      for (let i = 0; i < 9; i++) this.rawHeartRates[i] = packet[6 + i];
      this.index += 9;
      return null;
    }

    for (let i = 0; i < 13; i++) this.rawHeartRates[this.index + i] = packet[2 + i];
    this.index += 13;

    if (subType === this.size - 1) {
      const result: HeartRateLog = {
        heartRates: this.normalizedHeartRates(),
        timestamp: this.timestamp!,
        size: this.size,
        range: this.range,
        index: this.index,
      };
      this.reset();
      return result;
    }
    return null;
  }
}
