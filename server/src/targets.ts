import { TARGET_RADIUS, TARGET_X_RANGE, TARGET_Y_RANGE } from "./config.js";
import type { TargetState } from "./types.js";

function randomInRange([min, max]: readonly [number, number]): number {
  return min + Math.random() * (max - min);
}

export function spawnTarget(id: number): TargetState {
  return {
    id,
    x: randomInRange(TARGET_X_RANGE),
    y: randomInRange(TARGET_Y_RANGE),
    r: TARGET_RADIUS,
    alive: true
  };
}

export function createInitialTargets(count: number, startId: number): TargetState[] {
  return Array.from({ length: count }, (_, index) => spawnTarget(startId + index));
}

export function toTargetViews(targets: TargetState[]) {
  return targets.filter((target) => target.alive).map(({ id, x, y, r }) => ({ id, x, y, r }));
}
