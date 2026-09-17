import { NO_DATA as NO_HEART_RATE_DATA, heartRatesWithTimes } from "../ble/commands/heartRate";
import type { RingClient } from "../ble/client";
import { NO_DATA as NO_SLEEP_DATA, sleepEntryTimestamp } from "../ble/commands/sleep";
import { NO_DATA as NO_STEPS_DATA, sportDetailTimestamp } from "../ble/commands/steps";
import { db, upsertHeartRateSample, upsertSleepEntry, upsertSportDetail } from "../db/database";

export interface SyncProgress {
  dayOffset: number;
  daysTotal: number;
  stage: "heart-rate" | "steps" | "sleep";
}

export interface SyncOptions {
  ringId: number;
  daysBack: number;
  includeSleep: boolean;
  onProgress?: (progress: SyncProgress) => void;
}

function todayMidnightUtcMinusDays(daysBack: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
}

/** Pulls heart-rate/steps (+ optional experimental sleep) history into IndexedDB. */
export async function runSync(client: RingClient, options: SyncOptions): Promise<void> {
  const { ringId, daysBack, includeSleep, onProgress } = options;

  // Dexie's add() return type carries the (optional-in-the-interface) key type;
  // at runtime it's always the generated auto-increment id.
  const syncId = (await db.syncs.add({ ringId, timestamp: Date.now() })) as number;

  for (let dayOffset = 0; dayOffset < daysBack; dayOffset++) {
    onProgress?.({ dayOffset, daysTotal: daysBack, stage: "heart-rate" });
    const hrLog = await client.getHeartRateLog(todayMidnightUtcMinusDays(dayOffset));
    if (hrLog !== NO_HEART_RATE_DATA) {
      for (const [reading, timestamp] of heartRatesWithTimes(hrLog)) {
        if (reading === 0) continue;
        await upsertHeartRateSample({ ringId, timestamp: timestamp.getTime(), reading, syncId });
      }
    }

    onProgress?.({ dayOffset, daysTotal: daysBack, stage: "steps" });
    const steps = await client.getSteps(dayOffset);
    if (steps !== NO_STEPS_DATA) {
      for (const detail of steps) {
        await upsertSportDetail({
          ringId,
          timestamp: sportDetailTimestamp(detail).getTime(),
          steps: detail.steps,
          calories: detail.calories,
          distance: detail.distance,
          syncId,
        });
      }
    }

    if (includeSleep) {
      onProgress?.({ dayOffset, daysTotal: daysBack, stage: "sleep" });
      const sleep = await client.getSleep(dayOffset);
      if (sleep !== NO_SLEEP_DATA) {
        for (const entry of sleep) {
          await upsertSleepEntry({
            ringId,
            timestamp: sleepEntryTimestamp(entry).getTime(),
            stageRaw: entry.stageRaw,
            qualityRaw: entry.qualityRaw,
            syncId,
          });
        }
      }
    }
  }
}
