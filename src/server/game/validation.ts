import { ROOM_CODE_LENGTH } from "./config";
import type { ErrorCode, ShootReq } from "./types";

const ROOM_CODE_REGEX = /^[A-Z0-9]+$/;
const SAFE_NAME_REGEX = /^[A-Za-z0-9 _.-]+$/;

export function validateName(rawName: unknown): string | null {
  if (typeof rawName !== "string") {
    return null;
  }
  const trimmed = rawName.trim().replace(/\s+/g, " ");
  if (!trimmed || trimmed.length > 20) {
    return null;
  }
  if (!SAFE_NAME_REGEX.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function normalizeRoomCode(rawCode: unknown): string | null {
  if (typeof rawCode !== "string") {
    return null;
  }
  const code = rawCode.trim().toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH || !ROOM_CODE_REGEX.test(code)) {
    return null;
  }
  return code;
}

export function validateShootPayload(rawPayload: unknown):
  | { ok: true; data: ShootReq }
  | { ok: false; code: ErrorCode } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, code: "INVALID_SHOT" };
  }

  const payload = rawPayload as Partial<ShootReq>;
  const roomCode = normalizeRoomCode(payload.roomCode);
  if (!roomCode) {
    return { ok: false, code: "INVALID_SHOT" };
  }

  if (typeof payload.x !== "number" || !Number.isFinite(payload.x)) {
    return { ok: false, code: "INVALID_SHOT" };
  }
  if (typeof payload.y !== "number" || !Number.isFinite(payload.y)) {
    return { ok: false, code: "INVALID_SHOT" };
  }

  if (payload.t !== undefined && (typeof payload.t !== "number" || !Number.isFinite(payload.t))) {
    return { ok: false, code: "INVALID_SHOT" };
  }

  return {
    ok: true,
    data: {
      roomCode,
      x: payload.x,
      y: payload.y,
      t: payload.t
    }
  };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
