import { ROOM_CODE_LENGTH } from "./config";
import type { AimUpdateReq, ErrorCode, ShootReq, StartMatchReq, WebRtcSignalReq } from "./types";

const ROOM_CODE_REGEX = /^[A-Z]+$/;
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

export function validateAimPayload(rawPayload: unknown):
  | { ok: true; data: AimUpdateReq }
  | { ok: false; code: ErrorCode } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, code: "INVALID_SHOT" };
  }

  const payload = rawPayload as Partial<AimUpdateReq>;
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

  return {
    ok: true,
    data: {
      roomCode,
      x: payload.x,
      y: payload.y
    }
  };
}

export function validateStartMatchPayload(rawPayload: unknown):
  | { ok: true; data: StartMatchReq }
  | { ok: false; code: ErrorCode } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, code: "ROOM_NOT_FOUND" };
  }

  const payload = rawPayload as Partial<StartMatchReq>;
  const roomCode = normalizeRoomCode(payload.roomCode);
  if (!roomCode) {
    return { ok: false, code: "ROOM_NOT_FOUND" };
  }

  if (payload.durationMs !== undefined) {
    if (
      typeof payload.durationMs !== "number" ||
      !Number.isFinite(payload.durationMs) ||
      !Number.isInteger(payload.durationMs) ||
      payload.durationMs < 15_000 ||
      payload.durationMs > 300_000
    ) {
      return { ok: false, code: "INVALID_SETTINGS" };
    }
  }

  if (payload.twoGuns !== undefined && typeof payload.twoGuns !== "boolean") {
    return { ok: false, code: "INVALID_SETTINGS" };
  }

  return {
    ok: true,
    data: {
      roomCode,
      durationMs: payload.durationMs,
      twoGuns: payload.twoGuns
    }
  };
}

export function validateWebRtcSignalPayload(rawPayload: unknown):
  | { ok: true; data: WebRtcSignalReq }
  | { ok: false; code: ErrorCode } {
  if (!rawPayload || typeof rawPayload !== "object") {
    return { ok: false, code: "INVALID_SIGNAL" };
  }

  const payload = rawPayload as Partial<WebRtcSignalReq>;
  const roomCode = normalizeRoomCode(payload.roomCode);
  if (!roomCode) {
    return { ok: false, code: "INVALID_SIGNAL" };
  }

  if (typeof payload.targetId !== "string" || payload.targetId.trim().length === 0) {
    return { ok: false, code: "INVALID_SIGNAL" };
  }

  const signal = payload.signal;
  if (!signal || typeof signal !== "object") {
    return { ok: false, code: "INVALID_SIGNAL" };
  }

  if (signal.kind === "offer" || signal.kind === "answer") {
    if (typeof signal.sdp !== "string" || signal.sdp.length === 0) {
      return { ok: false, code: "INVALID_SIGNAL" };
    }
    return {
      ok: true,
      data: {
        roomCode,
        targetId: payload.targetId,
        signal: { kind: signal.kind, sdp: signal.sdp }
      }
    };
  }

  if (signal.kind === "ice") {
    if (typeof signal.candidate !== "string" || signal.candidate.length === 0) {
      return { ok: false, code: "INVALID_SIGNAL" };
    }
    if (signal.sdpMid !== undefined && signal.sdpMid !== null && typeof signal.sdpMid !== "string") {
      return { ok: false, code: "INVALID_SIGNAL" };
    }
    if (
      signal.sdpMLineIndex !== undefined &&
      signal.sdpMLineIndex !== null &&
      (typeof signal.sdpMLineIndex !== "number" || !Number.isFinite(signal.sdpMLineIndex))
    ) {
      return { ok: false, code: "INVALID_SIGNAL" };
    }
    return {
      ok: true,
      data: {
        roomCode,
        targetId: payload.targetId,
        signal: {
          kind: "ice",
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex
        }
      }
    };
  }

  return { ok: false, code: "INVALID_SIGNAL" };
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
