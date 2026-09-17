import { BATTERY_PACKET, parseBattery, type BatteryInfo } from "./commands/battery";
import { HeartRateLogParser, readHeartRatePacket, type HeartRateResult } from "./commands/heartRate";
import {
  heartRateLogSettingsPacket,
  parseHeartRateLogSettings,
  READ_HEART_RATE_LOG_SETTINGS_PACKET,
  type HeartRateLogSettings,
} from "./commands/heartRateSettings";
import { BLINK_TWICE_PACKET, REBOOT_PACKET } from "./commands/misc";
import {
  isRealTimeError,
  parseRealTimeReading,
  startRealTimePacket,
  stopRealTimePacket,
  type RealTimeReadingType,
} from "./commands/realTime";
import { readSleepPacket, SleepLogParser, type SleepResult } from "./commands/sleep";
import { setTimePacket } from "./commands/setTime";
import { readStepsPacket, SportDetailParser, type StepsResult } from "./commands/steps";
import { CMD } from "./constants";
import type { RingConnection, RingDeviceInfo } from "./connection";

const DEFAULT_TIMEOUT_MS = 5000;
const LOG_TIMEOUT_MS = 8000;
const MAX_LOG_PACKETS = 400;

/**
 * High-level command API for a connected ring, mirroring colmi_r02_client's
 * Client class. See docs/PROTOCOL.md for the wire format each method speaks.
 */
export class RingClient {
  private conn: RingConnection;

  constructor(conn: RingConnection) {
    this.conn = conn;
  }

  async getBattery(): Promise<BatteryInfo> {
    await this.conn.write(BATTERY_PACKET);
    const packet = await this.conn.waitForCommand(CMD.BATTERY, DEFAULT_TIMEOUT_MS);
    return parseBattery(packet);
  }

  async getDeviceInfo(): Promise<RingDeviceInfo> {
    return this.conn.getDeviceInfo();
  }

  /** Ring has no reliable RTC backup — call this at the start of every session. */
  async setTime(target: Date = new Date()): Promise<void> {
    await this.conn.write(setTimePacket(target));
    // ring replies with an (ignorable) capability bitfield on the same command id
    await this.conn.waitForCommand(CMD.SET_TIME, DEFAULT_TIMEOUT_MS).catch(() => undefined);
  }

  async blinkTwice(): Promise<void> {
    await this.conn.write(BLINK_TWICE_PACKET);
  }

  async reboot(): Promise<void> {
    await this.conn.write(REBOOT_PACKET);
  }

  async getHeartRateLogSettings(): Promise<HeartRateLogSettings> {
    await this.conn.write(READ_HEART_RATE_LOG_SETTINGS_PACKET);
    const packet = await this.conn.waitForCommand(CMD.HEART_RATE_LOG_SETTINGS, DEFAULT_TIMEOUT_MS);
    return parseHeartRateLogSettings(packet);
  }

  async setHeartRateLogSettings(settings: HeartRateLogSettings): Promise<void> {
    await this.conn.write(heartRateLogSettingsPacket(settings));
    await this.conn.waitForCommand(CMD.HEART_RATE_LOG_SETTINGS, DEFAULT_TIMEOUT_MS).catch(() => undefined);
  }

  /** @param targetMidnightUtc midnight UTC of the day to fetch */
  async getHeartRateLog(targetMidnightUtc: Date): Promise<HeartRateResult> {
    const parser = new HeartRateLogParser();
    await this.conn.write(readHeartRatePacket(targetMidnightUtc));
    return this.collectLog(CMD.READ_HEART_RATE, (p) => parser.parse(p));
  }

  /** @param dayOffset days back from the ring's "today" (0 = today) */
  async getSteps(dayOffset: number): Promise<StepsResult> {
    const parser = new SportDetailParser();
    await this.conn.write(readStepsPacket(dayOffset));
    return this.collectLog(CMD.GET_STEP_SOMEDAY, (p) => parser.parse(p));
  }

  /** EXPERIMENTAL — see docs/PROTOCOL.md. @param dayOffset days back from "today" */
  async getSleep(dayOffset: number): Promise<SleepResult> {
    const parser = new SleepLogParser();
    await this.conn.write(readSleepPacket(dayOffset));
    return this.collectLog(CMD.SLEEP, (p) => parser.parse(p));
  }

  /** Streams a real-time reading for a few seconds and returns the last stable value. */
  async getRealtimeReading(readingType: RealTimeReadingType): Promise<number | null> {
    await this.conn.write(startRealTimePacket(readingType));

    const readings: number[] = [];
    let sawError = false;

    try {
      for (let attempt = 0; attempt < 20 && readings.length < 6; attempt++) {
        try {
          const packet = await this.conn.waitForCommand(CMD.START_REAL_TIME, 2000);
          const reading = parseRealTimeReading(packet);
          if (isRealTimeError(reading)) {
            sawError = true;
            break;
          }
          if (reading.value !== 0) readings.push(reading.value);
        } catch {
          // per-attempt timeout; keep trying within the attempt budget
        }
      }
    } finally {
      await this.conn.write(stopRealTimePacket(readingType));
    }

    if (sawError || readings.length === 0) return null;
    return readings[readings.length - 1];
  }

  private async collectLog<T>(
    commandId: number,
    parse: (packet: Uint8Array) => T | null,
  ): Promise<T> {
    for (let i = 0; i < MAX_LOG_PACKETS; i++) {
      const packet = await this.conn.waitForCommand(commandId, LOG_TIMEOUT_MS);
      const result = parse(packet);
      if (result !== null) return result;
    }
    throw new Error(`Gave up waiting for a complete response to command ${commandId}`);
  }
}
