import { CMD } from "../constants";
import { makePacket } from "../packet";

export const RealTimeReading = {
  HEART_RATE: 1,
  BLOOD_PRESSURE: 2,
  SPO2: 3,
  FATIGUE: 4,
  HEALTH_CHECK: 5,
  ECG: 7,
  PRESSURE: 8,
  BLOOD_SUGAR: 9,
  HRV: 10,
} as const;

export type RealTimeReadingType = (typeof RealTimeReading)[keyof typeof RealTimeReading];

/** Only heart rate and SpO2 are known-reliable on this hardware. */
export const SUPPORTED_REAL_TIME_READINGS: RealTimeReadingType[] = [
  RealTimeReading.HEART_RATE,
  RealTimeReading.SPO2,
];

const ACTION_START = 1;

export function startRealTimePacket(readingType: RealTimeReadingType): Uint8Array {
  return makePacket(CMD.START_REAL_TIME, [readingType, ACTION_START]);
}

export function stopRealTimePacket(readingType: RealTimeReadingType): Uint8Array {
  return makePacket(CMD.STOP_REAL_TIME, [readingType, 0, 0]);
}

export interface RealTimeReadingValue {
  kind: RealTimeReadingType;
  value: number;
}

export interface RealTimeReadingError {
  kind: RealTimeReadingType;
  code: number;
}

export function parseRealTimeReading(packet: Uint8Array): RealTimeReadingValue | RealTimeReadingError {
  const kind = packet[1] as RealTimeReadingType;
  const errorCode = packet[2];
  if (errorCode !== 0) return { kind, code: errorCode };
  return { kind, value: packet[3] };
}

export function isRealTimeError(
  reading: RealTimeReadingValue | RealTimeReadingError,
): reading is RealTimeReadingError {
  return "code" in reading;
}
