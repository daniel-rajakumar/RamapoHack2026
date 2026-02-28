const DEFAULT_SERVER_URL = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

export const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? DEFAULT_SERVER_URL;

export const CLIENT_SHOT_COOLDOWN_MS = 250;
export const PINCH_THRESHOLD = 0.05;
export const AIM_SMOOTH_ALPHA = 0.28;
export const TRACKING_STALE_WARN_MS = 500;
export const TRACKING_STALE_BAD_MS = 1000;
export const WEBCAM_WIDTH = 640;
export const WEBCAM_HEIGHT = 480;

export const LOCAL_MEDIAPIPE_WASM_ROOT = "/mediapipe/wasm";
export const LOCAL_HAND_MODEL_PATH = "/mediapipe/hand_landmarker.task";
export const CDN_MEDIAPIPE_WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
export const CDN_HAND_MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export type InputMode = "hand" | "mouse";
