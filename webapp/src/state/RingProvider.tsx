import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { BatteryInfo } from "../ble/commands/battery";
import type { HeartRateLogSettings } from "../ble/commands/heartRateSettings";
import type { RealTimeReadingType } from "../ble/commands/realTime";
import { RingClient } from "../ble/client";
import { RingConnection, type RingDeviceInfo } from "../ble/connection";
import { findOrCreateRing } from "../db/database";
import { runSync, type SyncProgress } from "./sync";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface RingContextValue {
  status: ConnectionStatus;
  errorMessage: string | null;
  deviceName: string | null;
  ringId: number | null;
  battery: BatteryInfo | null;
  deviceInfo: RingDeviceInfo | null;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBattery: () => Promise<void>;
  sync: (daysBack: number, includeSleep: boolean) => Promise<void>;
  getRealtimeReading: (type: RealTimeReadingType) => Promise<number | null>;
  getHeartRateLogSettings: () => Promise<HeartRateLogSettings>;
  setHeartRateLogSettings: (settings: HeartRateLogSettings) => Promise<void>;
  blinkTwice: () => Promise<void>;
  reboot: () => Promise<void>;
}

const RingContext = createContext<RingContextValue | null>(null);

export function RingProvider({ children }: { children: ReactNode }) {
  const connectionRef = useRef<RingConnection | null>(null);
  const clientRef = useRef<RingClient | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [ringId, setRingId] = useState<number | null>(null);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<RingDeviceInfo | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);

  const connect = useCallback(async () => {
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const conn = new RingConnection();
      conn.addEventListener("disconnected", () => {
        setStatus("disconnected");
        setBattery(null);
      });

      await conn.connect();
      const client = new RingClient(conn);
      connectionRef.current = conn;
      clientRef.current = client;

      await client.setTime();
      const [batteryInfo, info] = await Promise.all([client.getBattery(), client.getDeviceInfo()]);

      const address = conn.device?.id ?? "unknown";
      const name = conn.device?.name ?? "Colmi ring";
      const ring = await findOrCreateRing(address, name);

      setDeviceName(name);
      setRingId(ring.id ?? null);
      setBattery(batteryInfo);
      setDeviceInfo(info);
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
      connectionRef.current = null;
      clientRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    connectionRef.current?.disconnect();
    connectionRef.current = null;
    clientRef.current = null;
    setStatus("disconnected");
    setBattery(null);
  }, []);

  const refreshBattery = useCallback(async () => {
    if (!clientRef.current) return;
    setBattery(await clientRef.current.getBattery());
  }, []);

  const sync = useCallback(
    async (daysBack: number, includeSleep: boolean) => {
      if (!clientRef.current || ringId === null) {
        throw new Error("Connect to a ring before syncing");
      }
      setIsSyncing(true);
      setSyncProgress(null);
      try {
        await runSync(clientRef.current, {
          ringId,
          daysBack,
          includeSleep,
          onProgress: setSyncProgress,
        });
      } finally {
        setIsSyncing(false);
        setSyncProgress(null);
      }
    },
    [ringId],
  );

  const getRealtimeReading = useCallback(async (type: RealTimeReadingType) => {
    if (!clientRef.current) throw new Error("Connect to a ring first");
    return clientRef.current.getRealtimeReading(type);
  }, []);

  const getHeartRateLogSettings = useCallback(async () => {
    if (!clientRef.current) throw new Error("Connect to a ring first");
    return clientRef.current.getHeartRateLogSettings();
  }, []);

  const setHeartRateLogSettings = useCallback(async (settings: HeartRateLogSettings) => {
    if (!clientRef.current) throw new Error("Connect to a ring first");
    await clientRef.current.setHeartRateLogSettings(settings);
  }, []);

  const blinkTwice = useCallback(async () => {
    if (!clientRef.current) throw new Error("Connect to a ring first");
    await clientRef.current.blinkTwice();
  }, []);

  const reboot = useCallback(async () => {
    if (!clientRef.current) throw new Error("Connect to a ring first");
    await clientRef.current.reboot();
    disconnect();
  }, [disconnect]);

  const value = useMemo<RingContextValue>(
    () => ({
      status,
      errorMessage,
      deviceName,
      ringId,
      battery,
      deviceInfo,
      isSyncing,
      syncProgress,
      connect,
      disconnect,
      refreshBattery,
      sync,
      getRealtimeReading,
      getHeartRateLogSettings,
      setHeartRateLogSettings,
      blinkTwice,
      reboot,
    }),
    [
      status,
      errorMessage,
      deviceName,
      ringId,
      battery,
      deviceInfo,
      isSyncing,
      syncProgress,
      connect,
      disconnect,
      refreshBattery,
      sync,
      getRealtimeReading,
      getHeartRateLogSettings,
      setHeartRateLogSettings,
      blinkTwice,
      reboot,
    ],
  );

  return <RingContext.Provider value={value}>{children}</RingContext.Provider>;
}

export function useRing(): RingContextValue {
  const ctx = useContext(RingContext);
  if (!ctx) throw new Error("useRing must be used within a RingProvider");
  return ctx;
}
