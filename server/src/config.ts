export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? "0.0.0.0";

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const MATCH_DURATION_MS = 60_000;
export const TARGET_COUNT = 5;
export const TARGET_RADIUS = 0.05;
export const TARGET_X_RANGE: readonly [number, number] = [0.15, 0.85];
export const TARGET_Y_RANGE: readonly [number, number] = [0.15, 0.85];

export const SERVER_SHOT_COOLDOWN_MS = 200;
export const SERVER_RATE_LIMIT_PER_SEC = 8;

export const SIM_TICK_MS = 100;
export const BROADCAST_MS = 250;
