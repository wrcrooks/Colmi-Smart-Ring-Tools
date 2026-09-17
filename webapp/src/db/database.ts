import Dexie, { type EntityTable } from "dexie";

export interface RingRecord {
  id?: number;
  address: string;
  name: string;
  lastConnectedAt: number;
}

export interface SyncRecord {
  id?: number;
  ringId: number;
  timestamp: number;
  comment?: string;
}

export interface HeartRateSample {
  id?: number;
  ringId: number;
  /** unix ms */
  timestamp: number;
  reading: number;
  syncId: number;
}

export interface SportDetailRecord {
  id?: number;
  ringId: number;
  /** unix ms */
  timestamp: number;
  steps: number;
  calories: number;
  distance: number;
  syncId: number;
}

/** EXPERIMENTAL — see docs/PROTOCOL.md before trusting stageRaw/qualityRaw. */
export interface SleepEntryRecord {
  id?: number;
  ringId: number;
  /** unix ms */
  timestamp: number;
  stageRaw: number;
  qualityRaw: number;
  syncId: number;
}

export class RingDatabase extends Dexie {
  rings!: EntityTable<RingRecord, "id">;
  syncs!: EntityTable<SyncRecord, "id">;
  heartRateSamples!: EntityTable<HeartRateSample, "id">;
  sportDetails!: EntityTable<SportDetailRecord, "id">;
  sleepEntries!: EntityTable<SleepEntryRecord, "id">;

  constructor() {
    super("colmi-ring-tools");
    this.version(1).stores({
      rings: "++id, &address",
      syncs: "++id, ringId, timestamp",
      heartRateSamples: "++id, ringId, [ringId+timestamp], timestamp, syncId",
      sportDetails: "++id, ringId, [ringId+timestamp], timestamp, syncId",
      sleepEntries: "++id, ringId, [ringId+timestamp], timestamp, syncId",
    });
  }
}

export const db = new RingDatabase();

export async function findOrCreateRing(address: string, name: string): Promise<RingRecord> {
  const existing = await db.rings.where("address").equals(address).first();
  if (existing) {
    await db.rings.update(existing.id!, { name, lastConnectedAt: Date.now() });
    return { ...existing, name, lastConnectedAt: Date.now() };
  }
  const id = await db.rings.add({ address, name, lastConnectedAt: Date.now() });
  return { id, address, name, lastConnectedAt: Date.now() };
}

/** Upsert a heart-rate sample, deduped on (ringId, timestamp), zero readings skipped. */
export async function upsertHeartRateSample(sample: HeartRateSample): Promise<void> {
  if (sample.reading === 0) return;
  const existing = await db.heartRateSamples
    .where("[ringId+timestamp]")
    .equals([sample.ringId, sample.timestamp])
    .first();
  if (existing) {
    await db.heartRateSamples.update(existing.id!, { reading: sample.reading, syncId: sample.syncId });
  } else {
    await db.heartRateSamples.add(sample);
  }
}

export async function upsertSportDetail(entry: SportDetailRecord): Promise<void> {
  const existing = await db.sportDetails
    .where("[ringId+timestamp]")
    .equals([entry.ringId, entry.timestamp])
    .first();
  if (existing) {
    await db.sportDetails.update(existing.id!, {
      steps: entry.steps,
      calories: entry.calories,
      distance: entry.distance,
      syncId: entry.syncId,
    });
  } else {
    await db.sportDetails.add(entry);
  }
}

export async function upsertSleepEntry(entry: SleepEntryRecord): Promise<void> {
  const existing = await db.sleepEntries
    .where("[ringId+timestamp]")
    .equals([entry.ringId, entry.timestamp])
    .first();
  if (existing) {
    await db.sleepEntries.update(existing.id!, {
      stageRaw: entry.stageRaw,
      qualityRaw: entry.qualityRaw,
      syncId: entry.syncId,
    });
  } else {
    await db.sleepEntries.add(entry);
  }
}
