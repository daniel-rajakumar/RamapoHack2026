import { FaceLandmarker, FilesetResolver, type Classifications } from "@mediapipe/tasks-vision";
import {
  BLINK_THRESHOLD,
  CDN_FACE_MODEL_PATH,
  CDN_MEDIAPIPE_WASM_ROOT,
  CLIENT_SHOT_COOLDOWN_MS,
  EYE_AIM_SMOOTH_ALPHA,
  LOCAL_FACE_MODEL_PATH,
  LOCAL_MEDIAPIPE_WASM_ROOT,
  TRACKING_STALE_BAD_MS,
  TRACKING_STALE_WARN_MS
} from "../config";

interface Point2D {
  x: number;
  y: number;
}

export interface EyeInputCallbacks {
  onAim: (x: number, y: number) => void;
  onShoot: (x: number, y: number) => void;
  onStatus: (message: string) => void;
}

const NOSE_TRACK_INDICES = [1, 4, 5, 6] as const;
const NOSE_AIM_GAIN = 1.8;

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

function averagePoint(landmarks: Point2D[], indices: readonly number[]): Point2D | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const index of indices) {
    const point = landmarks[index];
    if (!point) {
      continue;
    }
    sumX += point.x;
    sumY += point.y;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return { x: sumX / count, y: sumY / count };
}

function getBlendshapeScore(blendshapes: Classifications[] | undefined, name: string): number {
  const categories = blendshapes?.[0]?.categories;
  if (!categories) {
    return 0;
  }
  const hit = categories.find((category) => category.categoryName === name);
  return hit?.score ?? 0;
}

export class EyeInputController {
  private faceLandmarker: FaceLandmarker | null = null;

  private enabled = false;

  private running = false;

  private rafId = 0;

  private smoothX = 0.5;

  private smoothY = 0.5;

  private previousBlinking = false;

  private lastShotAt = 0;

  private lastSeenAt = 0;

  private lastStatusAt = 0;

  constructor(private readonly callbacks: EyeInputCallbacks) {}

  private async createLandmarker(wasmRoot: string, modelPath: string): Promise<FaceLandmarker> {
    const filesetResolver = await FilesetResolver.forVisionTasks(wasmRoot);
    return FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: modelPath
      },
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
  }

  async init(): Promise<boolean> {
    installTfliteInfoLogFilter();

    try {
      this.faceLandmarker = await this.createLandmarker(LOCAL_MEDIAPIPE_WASM_ROOT, LOCAL_FACE_MODEL_PATH);
      this.callbacks.onStatus("Eye tracking ready");
      return true;
    } catch {
      try {
        this.faceLandmarker = await this.createLandmarker(CDN_MEDIAPIPE_WASM_ROOT, CDN_FACE_MODEL_PATH);
        this.callbacks.onStatus("Eye tracking ready (CDN)");
        return true;
      } catch {
        this.faceLandmarker = null;
        this.callbacks.onStatus("Eye tracking unavailable");
        return false;
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.previousBlinking = false;

    if (!enabled) {
      this.callbacks.onStatus("Eye mode paused");
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

      if (this.enabled && this.faceLandmarker && video.readyState >= 2) {
        const result = this.faceLandmarker.detectForVideo(video, performance.now());
        const faceLandmarks = result.faceLandmarks?.[0];

        if (faceLandmarks) {
          this.lastSeenAt = Date.now();

          const noseCenter = averagePoint(faceLandmarks, NOSE_TRACK_INDICES);
          if (noseCenter) {
            const mirroredX = 1 - noseCenter.x;
            const amplifiedX = 0.5 + (mirroredX - 0.5) * NOSE_AIM_GAIN;
            const amplifiedY = 0.5 + (noseCenter.y - 0.5) * NOSE_AIM_GAIN;

            this.smoothX += (amplifiedX - this.smoothX) * EYE_AIM_SMOOTH_ALPHA;
            this.smoothY += (amplifiedY - this.smoothY) * EYE_AIM_SMOOTH_ALPHA;

            const aimX = clamp01(this.smoothX);
            const aimY = clamp01(this.smoothY);
            this.callbacks.onAim(aimX, aimY);

            const leftBlinkScore = getBlendshapeScore(result.faceBlendshapes, "eyeBlinkLeft");
            const rightBlinkScore = getBlendshapeScore(result.faceBlendshapes, "eyeBlinkRight");
            const blinking = leftBlinkScore >= BLINK_THRESHOLD && rightBlinkScore >= BLINK_THRESHOLD;
            const now = Date.now();
            if (blinking && !this.previousBlinking && now - this.lastShotAt >= CLIENT_SHOT_COOLDOWN_MS) {
              this.lastShotAt = now;
              this.callbacks.onShoot(aimX, aimY);
            }
            this.previousBlinking = blinking;
          } else {
            this.previousBlinking = false;
          }
        } else {
          this.previousBlinking = false;
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
      this.callbacks.onStatus("Eye tracking lost");
      return;
    }
    if (sinceSeen > TRACKING_STALE_WARN_MS) {
      this.callbacks.onStatus("Eye tracking weak");
      return;
    }
    this.callbacks.onStatus("Eye tracking good");
  }
}
