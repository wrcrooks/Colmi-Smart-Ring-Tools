/** Build a well-formed 16-byte ring packet: [command][...payload][checksum]. */
export function makePacket(command: number, payload: Uint8Array | number[] = []): Uint8Array {
  if (command < 0 || command > 255) {
    throw new RangeError(`Invalid command ${command}, must be between 0 and 255`);
  }
  if (payload.length > 14) {
    throw new RangeError("Payload must be at most 14 bytes");
  }

  const packet = new Uint8Array(16);
  packet[0] = command;
  packet.set(payload, 1);
  packet[15] = checksum(packet);
  return packet;
}

/** Sum of the first 15 bytes, mod 255 (wrapped to a byte via & 0xff). */
export function checksum(packet: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += packet[i];
  return sum & 0xff;
}

export function bcdToDecimal(b: number): number {
  return ((b >> 4) & 0xf) * 10 + (b & 0xf);
}

export function decimalToBcd(n: number): number {
  if (n < 0 || n > 99) throw new RangeError(`Value ${n} out of BCD range`);
  return ((Math.floor(n / 10) & 0xf) << 4) | (n % 10 & 0xf);
}
