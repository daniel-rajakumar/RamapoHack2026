import * as THREE from "three";
import type { TargetView } from "../types";
import { TargetMeshManager } from "./targets";

export class GameEngine {
  private renderer: THREE.WebGLRenderer;

  private readonly scene = new THREE.Scene();

  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

  private readonly crosshair: THREE.Mesh;

  private readonly opponentCrosshair: THREE.Mesh;

  private readonly targetManager: TargetMeshManager;

  private readonly shotFlashGeometry = new THREE.CircleGeometry(1, 20);

  private readonly shotRingGeometry = new THREE.RingGeometry(0.68, 1, 32);

  private readonly shotEffects: Array<{
    startedAt: number;
    durationSec: number;
    flash: THREE.Mesh;
    flashMaterial: THREE.MeshBasicMaterial;
    ring: THREE.Mesh;
    ringMaterial: THREE.MeshBasicMaterial;
  }> = [];

  private animationFrameId = 0;

  private worldHeight = 2;

  private worldWidth = 2;

  private lastViewportWidth = 0;

  private lastViewportHeight = 0;

  private readonly resizeObserver?: ResizeObserver;

  private readonly onResize = () => {
    this.resize();
  };

  constructor(private readonly overlayRoot: HTMLDivElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.style.pointerEvents = "none";
    this.renderer.domElement.style.display = "block";

    this.overlayRoot.innerHTML = "";
    this.overlayRoot.appendChild(this.renderer.domElement);

    this.camera.position.z = 5;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(1, 2, 3);
    this.scene.add(directional);

    const crosshairGeometry = new THREE.RingGeometry(0.03, 0.048, 32);
    const crosshairMaterial = new THREE.MeshBasicMaterial({
      color: 0xfefefe,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false
    });
    this.crosshair = new THREE.Mesh(crosshairGeometry, crosshairMaterial);
    this.crosshair.renderOrder = 20;
    this.scene.add(this.crosshair);

    const opponentCrosshairMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5e6c,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false
    });
    this.opponentCrosshair = new THREE.Mesh(crosshairGeometry, opponentCrosshairMaterial);
    this.opponentCrosshair.visible = false;
    this.opponentCrosshair.renderOrder = 19;
    this.scene.add(this.opponentCrosshair);

    this.targetManager = new TargetMeshManager(
      this.scene,
      (x, y) => this.normalizedToScene(x, y),
      (r) => r * this.worldHeight
    );

    this.resize();
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        this.resize();
      });
      this.resizeObserver.observe(this.overlayRoot);
    }
  }

  private normalizedToScene(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - 0.5) * this.worldWidth,
      y: (0.5 - y) * this.worldHeight
    };
  }

  private resize(): void {
    const width = this.overlayRoot.clientWidth;
    const height = this.overlayRoot.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }
    if (width === this.lastViewportWidth && height === this.lastViewportHeight) {
      return;
    }
    this.lastViewportWidth = width;
    this.lastViewportHeight = height;

    const aspect = width / height;

    this.worldHeight = 2;
    this.worldWidth = this.worldHeight * aspect;

    this.camera.left = -this.worldWidth / 2;
    this.camera.right = this.worldWidth / 2;
    this.camera.top = this.worldHeight / 2;
    this.camera.bottom = -this.worldHeight / 2;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height, false);
  }

  private renderLoop = () => {
    this.resize();
    this.targetManager.update(performance.now() / 1000);
    this.updateShotEffects(performance.now() / 1000);
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = window.requestAnimationFrame(this.renderLoop);
  };

  private updateShotEffects(nowSec: number): void {
    for (let i = this.shotEffects.length - 1; i >= 0; i -= 1) {
      const effect = this.shotEffects[i];
      const t = (nowSec - effect.startedAt) / effect.durationSec;

      if (t >= 1) {
        this.scene.remove(effect.flash);
        this.scene.remove(effect.ring);
        effect.flashMaterial.dispose();
        effect.ringMaterial.dispose();
        this.shotEffects.splice(i, 1);
        continue;
      }

      const eased = 1 - Math.pow(1 - Math.max(0, t), 3);
      const inv = 1 - Math.max(0, t);

      const flashScale = 0.05 + eased * 0.12;
      effect.flash.scale.setScalar(flashScale * this.worldHeight);
      effect.flashMaterial.opacity = inv * inv * 0.9;

      const ringScale = 0.04 + eased * 0.19;
      effect.ring.scale.setScalar(ringScale * this.worldHeight);
      effect.ringMaterial.opacity = inv * 0.85;
    }
  }

  start(): void {
    if (this.animationFrameId) {
      return;
    }
    this.renderLoop();
  }

  stop(): void {
    if (this.animationFrameId) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
  }

  setCrosshair(x: number, y: number): void {
    const point = this.normalizedToScene(x, y);
    this.crosshair.position.set(point.x, point.y, 0.1);
  }

  setOpponentCrosshair(x: number, y: number): void {
    const point = this.normalizedToScene(x, y);
    this.opponentCrosshair.position.set(point.x, point.y, 0.1);
  }

  setOpponentCrosshairVisible(visible: boolean): void {
    this.opponentCrosshair.visible = visible;
  }

  triggerShotEffect(x: number, y: number, owner: "self" | "opponent" = "self"): void {
    const point = this.normalizedToScene(x, y);
    const color = owner === "self" ? 0xfff1b0 : 0xff7a7a;

    const flashMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });
    const flash = new THREE.Mesh(this.shotFlashGeometry, flashMaterial);
    flash.renderOrder = 26;
    flash.position.set(point.x, point.y, 0.16);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    });
    const ring = new THREE.Mesh(this.shotRingGeometry, ringMaterial);
    ring.renderOrder = 25;
    ring.position.set(point.x, point.y, 0.15);

    this.scene.add(flash);
    this.scene.add(ring);
    this.shotEffects.push({
      startedAt: performance.now() / 1000,
      durationSec: 0.22,
      flash,
      flashMaterial,
      ring,
      ringMaterial
    });
  }

  syncTargets(targets: TargetView[]): void {
    this.targetManager.sync(targets);
  }

  clearTargets(): void {
    this.targetManager.clear();
  }

  dispose(): void {
    this.stop();
    this.targetManager.clear();
    for (const effect of this.shotEffects) {
      this.scene.remove(effect.flash);
      this.scene.remove(effect.ring);
      effect.flashMaterial.dispose();
      effect.ringMaterial.dispose();
    }
    this.shotEffects.length = 0;
    this.shotFlashGeometry.dispose();
    this.shotRingGeometry.dispose();
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
