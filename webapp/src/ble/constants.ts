// See ../../../docs/PROTOCOL.md for the full protocol reference.

export const UART_SERVICE_UUID = "6e40fff0-b5a3-f393-e0a9-e50e24dcca9e";
export const UART_RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
export const UART_TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

export const DEVICE_INFO_SERVICE_UUID = 0x180a;
export const DEVICE_HW_CHAR_UUID = 0x2a27;
export const DEVICE_FW_CHAR_UUID = 0x2a26;

export const CMD = {
  SET_TIME: 1,
  BATTERY: 3,
  REBOOT: 8,
  BLINK_TWICE: 16,
  READ_HEART_RATE: 21,
  HEART_RATE_LOG_SETTINGS: 22,
  GET_STEP_SOMEDAY: 67,
  SLEEP: 68,
  START_REAL_TIME: 105,
  STOP_REAL_TIME: 106,
} as const;

export type CommandId = (typeof CMD)[keyof typeof CMD];

/** Known name prefixes for Colmi RF03-family rings and OEM rebrands. */
export const DEVICE_NAME_PREFIXES = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R09",
  "R10",
  "COLMI",
  "VK-5098",
  "MERLIN",
  "Hello Ring",
  "RING1",
  "boAtring",
  "TR-R02",
  "SE",
  "EVOLVEO",
  "GL-SR2",
  "Blaupunkt",
  "KSIX RING",
];
