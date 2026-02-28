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
    this.renderer.render(this.scene, this.camera);
    this.animationFrameId = window.requestAnimationFrame(this.renderLoop);
  };

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

  syncTargets(targets: TargetView[]): void {
    this.targetManager.sync(targets);
  }

  clearTargets(): void {
    this.targetManager.clear();
  }

  dispose(): void {
    this.stop();
    this.targetManager.clear();
    window.removeEventListener("resize", this.onResize);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
  }
}
