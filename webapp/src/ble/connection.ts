import {
  DEVICE_FW_CHAR_UUID,
  DEVICE_HW_CHAR_UUID,
  DEVICE_INFO_SERVICE_UUID,
  DEVICE_NAME_PREFIXES,
  UART_RX_CHAR_UUID,
  UART_SERVICE_UUID,
  UART_TX_CHAR_UUID,
} from "./constants";

export interface RingDeviceInfo {
  hwVersion: string;
  fwVersion: string;
}

interface Waiter {
  resolve: (packet: Uint8Array) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Low-level GATT transport for the ring's Nordic-UART-shaped service. Owns the
 * connection lifecycle and a per-command-id buffered queue of received
 * packets, mirroring the asyncio.Queue design in the upstream Python client
 * (see docs/PROTOCOL.md) so responses that arrive before anyone asked for
 * them aren't lost.
 */
export class RingConnection extends EventTarget {
  device: BluetoothDevice | null = null;
  private rxChar: BluetoothRemoteGATTCharacteristic | null = null;
  private txChar: BluetoothRemoteGATTCharacteristic | null = null;
  private queues = new Map<number, Uint8Array[]>();
  private waiters = new Map<number, Waiter[]>();

  get connected(): boolean {
    return this.device?.gatt?.connected ?? false;
  }

  async connect(): Promise<void> {
    if (!navigator.bluetooth) {
      throw new Error("Web Bluetooth is not available in this browser.");
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: [UART_SERVICE_UUID] },
        ...DEVICE_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      ],
      optionalServices: [UART_SERVICE_UUID, DEVICE_INFO_SERVICE_UUID],
    });
    this.device = device;
    device.addEventListener("gattserverdisconnected", this.handleDisconnected);

    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(UART_SERVICE_UUID);
    this.rxChar = await service.getCharacteristic(UART_RX_CHAR_UUID);
    this.txChar = await service.getCharacteristic(UART_TX_CHAR_UUID);

    await this.txChar.startNotifications();
    this.txChar.addEventListener("characteristicvaluechanged", this.handleNotification);

    this.dispatchEvent(new Event("connected"));
  }

  disconnect(): void {
    this.device?.gatt?.disconnect();
  }

  async write(packet: Uint8Array): Promise<void> {
    if (!this.rxChar) throw new Error("Not connected to a ring");
    // Every packet comes from a fresh `new Uint8Array(16)`, so `.buffer` is a
    // plain ArrayBuffer; the cast just works around TS's generic BufferSource
    // widening SharedArrayBuffer into the type.
    await this.rxChar.writeValueWithoutResponse(packet as BufferSource);
  }

  /** Wait for the next buffered/incoming packet with the given command id (FIFO). */
  waitForCommand(commandId: number, timeoutMs: number): Promise<Uint8Array> {
    const queue = this.queues.get(commandId);
    if (queue && queue.length > 0) {
      return Promise.resolve(queue.shift()!);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        const list = this.waiters.get(commandId);
        if (list) {
          const idx = list.findIndex((w) => w.resolve === waiter.resolve);
          if (idx >= 0) list.splice(idx, 1);
        }
        reject(new Error(`Timed out waiting for response to command ${commandId}`));
      }, timeoutMs);

      const waiter: Waiter = { resolve, timer };
      const list = this.waiters.get(commandId) ?? [];
      list.push(waiter);
      this.waiters.set(commandId, list);
    });
  }

  async getDeviceInfo(): Promise<RingDeviceInfo> {
    if (!this.device?.gatt?.connected) throw new Error("Not connected to a ring");
    const service = await this.device.gatt.getPrimaryService(DEVICE_INFO_SERVICE_UUID);
    const [hwChar, fwChar] = await Promise.all([
      service.getCharacteristic(DEVICE_HW_CHAR_UUID),
      service.getCharacteristic(DEVICE_FW_CHAR_UUID),
    ]);
    const decoder = new TextDecoder();
    const [hw, fw] = await Promise.all([hwChar.readValue(), fwChar.readValue()]);
    return { hwVersion: decoder.decode(hw), fwVersion: decoder.decode(fw) };
  }

  private handleNotification = (event: Event): void => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;
    if (!value) return;

    const packet = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const commandId = packet[0];

    const waiters = this.waiters.get(commandId);
    if (waiters && waiters.length > 0) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timer);
      waiter.resolve(packet);
    } else {
      const queue = this.queues.get(commandId) ?? [];
      queue.push(packet);
      this.queues.set(commandId, queue);
    }

    this.dispatchEvent(new CustomEvent<Uint8Array>("packet", { detail: packet }));
  };

  private handleDisconnected = (): void => {
    this.rxChar = null;
    this.txChar = null;
    this.queues.clear();
    for (const list of this.waiters.values()) {
      for (const waiter of list) clearTimeout(waiter.timer);
    }
    this.waiters.clear();
    this.dispatchEvent(new Event("disconnected"));
  };
}
