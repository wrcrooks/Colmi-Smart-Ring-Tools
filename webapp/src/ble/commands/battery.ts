import { CMD } from "../constants";
import { makePacket } from "../packet";

export interface BatteryInfo {
  batteryLevel: number;
  charging: boolean;
}

export const BATTERY_PACKET = makePacket(CMD.BATTERY);

export function parseBattery(packet: Uint8Array): BatteryInfo {
  return { batteryLevel: packet[1], charging: packet[2] !== 0 };
}
