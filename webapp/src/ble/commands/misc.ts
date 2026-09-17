import { CMD } from "../constants";
import { makePacket } from "../packet";

export const REBOOT_PACKET = makePacket(CMD.REBOOT, [1]);
export const BLINK_TWICE_PACKET = makePacket(CMD.BLINK_TWICE);
