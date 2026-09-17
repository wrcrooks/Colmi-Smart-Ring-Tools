import { CMD } from "../constants";
import { decimalToBcd, makePacket } from "../packet";

/** Ring keeps no reliable RTC backup; set the time on every sync/connect. */
export function setTimePacket(target: Date): Uint8Array {
  const utc = new Date(target.getTime());
  const payload = new Uint8Array(7);
  payload[0] = decimalToBcd(utc.getUTCFullYear() % 100);
  payload[1] = decimalToBcd(utc.getUTCMonth() + 1);
  payload[2] = decimalToBcd(utc.getUTCDate());
  payload[3] = decimalToBcd(utc.getUTCHours());
  payload[4] = decimalToBcd(utc.getUTCMinutes());
  payload[5] = decimalToBcd(utc.getUTCSeconds());
  payload[6] = 1; // language: 1 = English, 0 = Chinese
  return makePacket(CMD.SET_TIME, payload);
}
