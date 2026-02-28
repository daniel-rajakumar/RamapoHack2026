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
  if (now < room.startTime) {
    return duration;
  }
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
  return processQueuedShotWithOptions(room, shot, now, {});
}

function validateShotAcceptance(
  room: Room,
  shot: QueuedShot,
  now: number,
  options: { skipLimits?: boolean }
): { ok: true } | { ok: false; result: ShotProcessResult } {
  const shooter = room.players.get(shot.shooterId);
  if (!shooter) {
    return { ok: false, result: reject(shot.shooterId, "ROOM_NOT_FOUND") };
  }

  if (!room.started) {
    return { ok: false, result: reject(shot.shooterId, "MATCH_NOT_STARTED") };
  }
  if (now < room.startTime) {
    return { ok: false, result: reject(shot.shooterId, "MATCH_NOT_STARTED") };
  }

  if (getTimeRemainingMs(room, now) <= 0) {
    return { ok: false, result: reject(shot.shooterId, "MATCH_ENDED") };
  }

  if (!options.skipLimits) {
    if (!applyCooldown(room, shot.shooterId, now)) {
      return { ok: false, result: reject(shot.shooterId, "RATE_LIMITED") };
    }

    if (!applyRateLimit(room, shot.shooterId, now)) {
      return { ok: false, result: reject(shot.shooterId, "RATE_LIMITED") };
    }
  }

  return { ok: true };
}

function findHitTargetIndex(
  room: Room,
  x: number,
  y: number,
  excludedTargetIds: Set<number>
): number {
  return room.targets.findIndex(
    (target) =>
      target.alive &&
      !excludedTargetIds.has(target.id) &&
      distanceSquared(x, y, target.x, target.y) <= target.r * target.r
  );
}

export function processQueuedShotWithOptions(
  room: Room,
  shot: QueuedShot,
  now = Date.now(),
  options: { skipLimits?: boolean } = {}
): ShotProcessResult {
  const acceptance = validateShotAcceptance(room, shot, now, options);
  if (!acceptance.ok) {
    return acceptance.result;
  }

  const x = clamp01(shot.x);
  const y = clamp01(shot.y);
  const shooter = room.players.get(shot.shooterId);
  if (!shooter) {
    return reject(shot.shooterId, "ROOM_NOT_FOUND");
  }

  const targetIndex = findHitTargetIndex(room, x, y, new Set());

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

export function processQueuedTwoGunShot(
  room: Room,
  shot: QueuedShot,
  spread: number,
  now = Date.now()
): ShotProcessResult[] {
  const acceptance = validateShotAcceptance(room, shot, now, {});
  if (!acceptance.ok) {
    return [acceptance.result];
  }

  const shooter = room.players.get(shot.shooterId);
  if (!shooter) {
    return [reject(shot.shooterId, "ROOM_NOT_FOUND")];
  }

  const points = [
    { x: clamp01(shot.x - spread / 2), y: clamp01(shot.y) },
    { x: clamp01(shot.x + spread / 2), y: clamp01(shot.y) }
  ];

  const excludedTargetIds = new Set<number>();
  const hits: Array<{ targetIndex: number }> = [];
  const results: ShotProcessResult[] = [];

  for (const point of points) {
    const targetIndex = findHitTargetIndex(room, point.x, point.y, excludedTargetIds);
    if (targetIndex < 0) {
      results.push({
        accepted: true,
        hit: false,
        shooterId: shot.shooterId
      });
      continue;
    }

    const hitTargetId = room.targets[targetIndex].id;
    excludedTargetIds.add(hitTargetId);
    hits.push({ targetIndex });
    results.push({
      accepted: true,
      hit: true,
      shooterId: shot.shooterId,
      hitTargetId
    });
  }

  for (const hit of hits) {
    room.targets[hit.targetIndex].alive = false;
    room.targets[hit.targetIndex] = spawnTarget(room.nextTargetId);
    room.nextTargetId += 1;
    shooter.score += 1;
  }

  return results;
}
