function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class MouseInputController {
  private enabled = false;

  private lastAimX = 0.5;

  private lastAimY = 0.5;

  private lastShotAt = 0;

  constructor(
    private readonly stageElement: HTMLDivElement,
    private readonly cooldownMs: number,
    private readonly onAim: (x: number, y: number) => void,
    private readonly onShoot: (x: number, y: number) => void
  ) {
    this.stageElement.addEventListener("pointermove", this.handlePointerMove);
    this.stageElement.addEventListener("pointerdown", this.handlePointerDown);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.stageElement.style.cursor = enabled ? "crosshair" : "default";
  }

  dispose(): void {
    this.stageElement.removeEventListener("pointermove", this.handlePointerMove);
    this.stageElement.removeEventListener("pointerdown", this.handlePointerDown);
  }

  private toNormalized(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.stageElement.getBoundingClientRect();
    const x = clamp01((clientX - rect.left) / rect.width);
    const y = clamp01((clientY - rect.top) / rect.height);
    return { x, y };
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.enabled) {
      return;
    }
    const point = this.toNormalized(event.clientX, event.clientY);
    this.lastAimX = point.x;
    this.lastAimY = point.y;
    this.onAim(point.x, point.y);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (!this.enabled) {
      return;
    }

    const point = this.toNormalized(event.clientX, event.clientY);
    this.lastAimX = point.x;
    this.lastAimY = point.y;
    this.onAim(point.x, point.y);

    const now = Date.now();
    if (now - this.lastShotAt < this.cooldownMs) {
      return;
    }

    this.lastShotAt = now;
    this.onShoot(this.lastAimX, this.lastAimY);
  };
}
