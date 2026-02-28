import { MATCH_DURATION_MS, SERVER_RATE_LIMIT_PER_SEC, SERVER_SHOT_COOLDOWN_MS } from "./config";
import { clamp01 } from "./validation";
import { spawnTarget } from "./targets";
import type { ErrorCode, QueuedShot, Room, ShotProcessResult } from "./types";

function distanceSquared(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function applyCooldown(room: Room, playerId: string, now: number): boolean {
  const lastShotAt = room.lastShotAtByPlayer.get(playerId) ?? -Infinity;
  if (now - lastShotAt < SERVER_SHOT_COOLDOWN_MS) {
    return false;
  }
  room.lastShotAtByPlayer.set(playerId, now);
  return true;
}

function applyRateLimit(room: Room, playerId: string, now: number): boolean {
  const window = room.shotWindowCountByPlayer.get(playerId);
  if (!window || now - window.windowStartMs >= 1000) {
    room.shotWindowCountByPlayer.set(playerId, { windowStartMs: now, count: 1 });
    return true;
  }

  if (window.count >= SERVER_RATE_LIMIT_PER_SEC) {
    return false;
  }

  window.count += 1;
  return true;
}

export function getTimeRemainingMs(room: Room, now: number): number {
  const duration = room.durationMs || MATCH_DURATION_MS;
  return Math.max(0, duration - (now - room.startTime));
}

function reject(shooterId: string, code: ErrorCode): ShotProcessResult {
  return {
    accepted: false,
    hit: false,
    shooterId,
    errorCode: code
  };
}

export function processQueuedShot(room: Room, shot: QueuedShot, now = Date.now()): ShotProcessResult {
  const shooter = room.players.get(shot.shooterId);
  if (!shooter) {
    return reject(shot.shooterId, "ROOM_NOT_FOUND");
  }

  if (!room.started) {
    return reject(shot.shooterId, "MATCH_NOT_STARTED");
  }

  if (getTimeRemainingMs(room, now) <= 0) {
    return reject(shot.shooterId, "MATCH_ENDED");
  }

  if (!applyCooldown(room, shot.shooterId, now)) {
    return reject(shot.shooterId, "RATE_LIMITED");
  }

  if (!applyRateLimit(room, shot.shooterId, now)) {
    return reject(shot.shooterId, "RATE_LIMITED");
  }

  const x = clamp01(shot.x);
  const y = clamp01(shot.y);

  const targetIndex = room.targets.findIndex(
    (target) => target.alive && distanceSquared(x, y, target.x, target.y) <= target.r * target.r
  );

  if (targetIndex < 0) {
    return {
      accepted: true,
      hit: false,
      shooterId: shot.shooterId
    };
  }

  const hitTargetId = room.targets[targetIndex].id;
  room.targets[targetIndex].alive = false;
  room.targets[targetIndex] = spawnTarget(room.nextTargetId);
  room.nextTargetId += 1;
  shooter.score += 1;

  return {
    accepted: true,
    hit: true,
    shooterId: shot.shooterId,
    hitTargetId
  };
}
