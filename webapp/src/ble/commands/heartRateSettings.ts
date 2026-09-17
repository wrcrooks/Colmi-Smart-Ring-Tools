import { CMD } from "../constants";
import { makePacket } from "../packet";

export interface HeartRateLogSettings {
  enabled: boolean;
  /** Interval in minutes between automatic heart-rate log samples. */
  interval: number;
}

export const READ_HEART_RATE_LOG_SETTINGS_PACKET = makePacket(CMD.HEART_RATE_LOG_SETTINGS, [1]);

export function parseHeartRateLogSettings(packet: Uint8Array): HeartRateLogSettings {
  const raw = packet[2];
  if (raw !== 1 && raw !== 2) {
    console.warn(`Unexpected heart-rate log enabled byte ${raw}, defaulting to disabled`);
  }
  return { enabled: raw === 1, interval: packet[3] };
}

export function heartRateLogSettingsPacket(settings: HeartRateLogSettings): Uint8Array {
  if (settings.interval <= 0 || settings.interval > 255) {
    throw new RangeError("Interval must be between 1 and 255 minutes");
  }
  const enabledByte = settings.enabled ? 1 : 2;
  return makePacket(CMD.HEART_RATE_LOG_SETTINGS, [2, enabledByte, settings.interval]);
}
