export const PORT = Number(process.env.PORT ?? 3001);
export const HOST = process.env.HOST ?? "0.0.0.0";

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
];

export const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? DEFAULT_ALLOWED_ORIGINS
).filter((origin, index, all) => all.indexOf(origin) === index);

export const ALLOW_ANY_ORIGIN = ALLOWED_ORIGINS.includes("*");

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export const MATCH_DURATION_MS = 60_000;
export const TARGET_COUNT = 5;
export const TARGET_RADIUS = 0.05;
export const TARGET_X_RANGE: readonly [number, number] = [0.15, 0.85];
export const TARGET_Y_RANGE: readonly [number, number] = [0.15, 0.85];

export const SERVER_SHOT_COOLDOWN_MS = 200;
export const SERVER_RATE_LIMIT_PER_SEC = 8;

export const CONTROL_EVENT_WINDOW_MS = 5_000;
export const CONTROL_EVENT_MAX_PER_WINDOW = 24;

export const SIM_TICK_MS = 100;
export const BROADCAST_MS = 250;
