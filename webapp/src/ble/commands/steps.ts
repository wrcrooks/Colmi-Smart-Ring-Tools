import { CMD } from "../constants";
import { bcdToDecimal, makePacket } from "../packet";

export function readStepsPacket(dayOffset = 0): Uint8Array {
  return makePacket(CMD.GET_STEP_SOMEDAY, [dayOffset, 0x0f, 0x00, 0x5f, 0x01]);
}

export interface SportDetail {
  year: number;
  month: number;
  day: number;
  /** 15-minute bucket within the day (0-95). */
  timeIndex: number;
  calories: number;
  steps: number;
  /** Distance in meters. */
  distance: number;
}

export function sportDetailTimestamp(d: SportDetail): Date {
  return new Date(
    Date.UTC(d.year, d.month - 1, d.day, Math.floor(d.timeIndex / 4), (d.timeIndex % 4) * 15),
  );
}

export const NO_DATA = Symbol("NoStepsData");
export type StepsResult = SportDetail[] | typeof NO_DATA;

/**
 * Stateful parser for the multi-packet steps/calories/distance log response.
 * Feed it every packet with command id CMD.GET_STEP_SOMEDAY; returns null
 * until the log is complete, or NO_DATA if the ring has nothing for the day.
 */
export class SportDetailParser {
  private newCalorieProtocol = false;
  private index = 0;
  private details: SportDetail[] = [];

  private reset(): void {
    this.newCalorieProtocol = false;
    this.index = 0;
    this.details = [];
  }

  parse(packet: Uint8Array): StepsResult | null {
    if (this.index === 0 && packet[1] === 255) {
      this.reset();
      return NO_DATA;
    }

    if (this.index === 0 && packet[1] === 240) {
      this.newCalorieProtocol = packet[3] === 1;
      this.index += 1;
      return null;
    }

    const year = bcdToDecimal(packet[1]) + 2000;
    const month = bcdToDecimal(packet[2]);
    const day = bcdToDecimal(packet[3]);
    const timeIndex = packet[4];
    let calories = packet[7] | (packet[8] << 8);
    if (this.newCalorieProtocol) calories *= 10;
    const steps = packet[9] | (packet[10] << 8);
    const distance = packet[11] | (packet[12] << 8);

    this.details.push({ year, month, day, timeIndex, calories, steps, distance });

    if (packet[5] === packet[6] - 1) {
      const result = this.details;
      this.reset();
      return result;
    }

    this.index += 1;
    return null;
  }
}
