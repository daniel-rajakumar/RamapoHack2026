import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import {
  AIM_SMOOTH_ALPHA,
  CDN_HAND_MODEL_PATH,
  CDN_MEDIAPIPE_WASM_ROOT,
  CLIENT_SHOT_COOLDOWN_MS,
  LOCAL_HAND_MODEL_PATH,
  LOCAL_MEDIAPIPE_WASM_ROOT,
  PINCH_THRESHOLD,
  TRACKING_STALE_BAD_MS,
  TRACKING_STALE_WARN_MS
} from "../config";

export interface HandInputCallbacks {
  onAim: (x: number, y: number) => void;
  onShoot: (x: number, y: number) => void;
  onStatus: (message: string) => void;
}

let tfliteInfoLogFilterInstalled = false;

function shouldSuppressTfliteInfoLog(args: unknown[]): boolean {
  if (args.length === 0) {
    return false;
  }
  const message = typeof args[0] === "string" ? args[0] : String(args[0]);
  return message.includes("Created TensorFlow Lite XNNPACK delegate for CPU");
}

function installTfliteInfoLogFilter(): void {
  if (tfliteInfoLogFilterInstalled) {
    return;
  }
  tfliteInfoLogFilterInstalled = true;

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    if (shouldSuppressTfliteInfoLog(args)) {
      return;
    }
    originalConsoleError(...args);
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pinchDistance(thumb: { x: number; y: number }, index: { x: number; y: number }): number {
  const dx = thumb.x - index.x;
  const dy = thumb.y - index.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export class HandInputController {
  private handLandmarker: HandLandmarker | null = null;

  private enabled = false;

  private running = false;

  private rafId = 0;

  private smoothX = 0.5;

  private smoothY = 0.5;

  private previousPinched = false;

  private lastShotAt = 0;

  private lastSeenAt = 0;

  private lastStatusAt = 0;

  constructor(private readonly callbacks: HandInputCallbacks) {}

  private async createLandmarker(wasmRoot: string, modelPath: string): Promise<HandLandmarker> {
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmRoot);
    return HandLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: modelPath
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  async init(): Promise<boolean> {
    installTfliteInfoLogFilter();

    try {
      this.handLandmarker = await this.createLandmarker(LOCAL_MEDIAPIPE_WASM_ROOT, LOCAL_HAND_MODEL_PATH);
      this.callbacks.onStatus("ready");
      return true;
    } catch {
      try {
        this.handLandmarker = await this.createLandmarker(CDN_MEDIAPIPE_WASM_ROOT, CDN_HAND_MODEL_PATH);
        this.callbacks.onStatus("cdn");
        return true;
      } catch {
        this.callbacks.onStatus("unavailable");
        this.handLandmarker = null;
        return false;
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.previousPinched = false;

    if (!enabled) {
      this.callbacks.onStatus("Hand mode paused");
    }
  }

  start(video: HTMLVideoElement): void {
    if (this.running) {
      return;
    }
    this.running = true;

    const loop = () => {
      if (!this.running) {
        return;
      }

      if (this.enabled && this.handLandmarker && video.readyState >= 2) {
        const result = this.handLandmarker.detectForVideo(video, performance.now()) as {
          landmarks?: Array<Array<{ x: number; y: number }>>;
        };

        const landmarks = result.landmarks?.[0];
        if (landmarks && landmarks[4] && landmarks[8]) {
          this.lastSeenAt = Date.now();

          const rawX = 1 - landmarks[8].x;
          const rawY = landmarks[8].y;

          this.smoothX += (rawX - this.smoothX) * AIM_SMOOTH_ALPHA;
          this.smoothY += (rawY - this.smoothY) * AIM_SMOOTH_ALPHA;

          const aimX = clamp01(this.smoothX);
          const aimY = clamp01(this.smoothY);
          this.callbacks.onAim(aimX, aimY);

          const pinched = pinchDistance(landmarks[4], landmarks[8]) < PINCH_THRESHOLD;
          const now = Date.now();
          if (pinched && !this.previousPinched && now - this.lastShotAt >= CLIENT_SHOT_COOLDOWN_MS) {
            this.lastShotAt = now;
            this.callbacks.onShoot(aimX, aimY);
          }
          this.previousPinched = pinched;
        } else {
          this.previousPinched = false;
        }
      }

      this.emitTrackingStatus();
      this.rafId = window.requestAnimationFrame(loop);
    };

    loop();
  }

  stop(): void {
    this.running = false;
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private emitTrackingStatus(): void {
    const now = Date.now();
    if (now - this.lastStatusAt < 150) {
      return;
    }
    this.lastStatusAt = now;

    if (!this.enabled) {
      return;
    }

    const sinceSeen = now - this.lastSeenAt;
    if (this.lastSeenAt === 0 || sinceSeen > TRACKING_STALE_BAD_MS) {
      this.callbacks.onStatus("lost");
      return;
    }
    if (sinceSeen > TRACKING_STALE_WARN_MS) {
      this.callbacks.onStatus("weak");
      return;
    }
    this.callbacks.onStatus("good");
  }
}
