import * as THREE from "three";
import type { TargetView } from "../types";

export type ToScene = (x: number, y: number) => { x: number; y: number };
export type RadiusToScene = (r: number) => number;

type BubbleInstance = {
  id: number;
  group: THREE.Group;
  shell: THREE.Mesh;
  shellMaterial: THREE.MeshPhysicalMaterial;
  glint: THREE.Mesh;
  glintMaterial: THREE.MeshBasicMaterial;
  baseRadius: number;
  hueOffset: number;
  phaseOffset: number;
  spawnedAt: number;
  poppingAt?: number;
};

const INTRO_DURATION_SEC = 0.34;
const POP_DURATION_SEC = 0.22;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

function easeOutCubic(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

export class TargetMeshManager {
  private readonly activeBubbles = new Map<number, BubbleInstance>();

  private readonly poppingBubbles: BubbleInstance[] = [];

  private readonly shellGeometry = new THREE.SphereGeometry(1, 28, 20);

  private readonly glintGeometry = new THREE.SphereGeometry(1, 16, 12);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly toScene: ToScene,
    private readonly radiusToScene: RadiusToScene
  ) {}

  private createBubble(id: number): BubbleInstance {
    const hueOffset = (Math.random() - 0.5) * 0.06;
    const shellMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color().setHSL(0.54 + hueOffset, 0.82, 0.66),
      emissive: new THREE.Color().setHSL(0.57 + hueOffset, 0.95, 0.34),
      emissiveIntensity: 0.2,
      metalness: 0.02,
      roughness: 0.08,
      transmission: 0.92,
      thickness: 0.35,
      ior: 1.2,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    const shell = new THREE.Mesh(this.shellGeometry, shellMaterial);
    shell.renderOrder = 10;

    const glintMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false
    });
    const glint = new THREE.Mesh(this.glintGeometry, glintMaterial);
    glint.scale.setScalar(0.26);
    glint.position.set(-0.28, 0.28, 0.74);
    glint.renderOrder = 11;
    shell.add(glint);

    const group = new THREE.Group();
    group.add(shell);
    group.scale.setScalar(0.0001);

    return {
      id,
      group,
      shell,
      shellMaterial,
      glint,
      glintMaterial,
      baseRadius: 0.05,
      hueOffset,
      phaseOffset: Math.random() * Math.PI * 2,
      spawnedAt: performance.now() / 1000
    };
  }

  private disposeBubble(bubble: BubbleInstance): void {
    bubble.shell.remove(bubble.glint);
    bubble.group.remove(bubble.shell);
    this.scene.remove(bubble.group);
    bubble.shellMaterial.dispose();
    bubble.glintMaterial.dispose();
  }

  private startPop(bubble: BubbleInstance): void {
    if (bubble.poppingAt !== undefined) {
      return;
    }
    bubble.poppingAt = performance.now() / 1000;
    this.activeBubbles.delete(bubble.id);
    this.poppingBubbles.push(bubble);
  }

  sync(targets: TargetView[]): void {
    const liveIds = new Set<number>();

    for (const target of targets) {
      liveIds.add(target.id);
      let bubble = this.activeBubbles.get(target.id);
      if (!bubble) {
        bubble = this.createBubble(target.id);
        this.activeBubbles.set(target.id, bubble);
        this.scene.add(bubble.group);
      }

      const point = this.toScene(target.x, target.y);
      const radius = this.radiusToScene(target.r);
      bubble.group.position.set(point.x, point.y, 0.02);
      bubble.baseRadius = radius;
    }

    for (const [id, bubble] of this.activeBubbles) {
      if (liveIds.has(id)) {
        continue;
      }
      this.startPop(bubble);
    }
  }

  update(nowSeconds = performance.now() / 1000): void {
    for (const bubble of this.activeBubbles.values()) {
      const introT = clamp01((nowSeconds - bubble.spawnedAt) / INTRO_DURATION_SEC);
      const introScale = Math.max(0.001, easeOutBack(introT));
      const hover = 1 + Math.sin(nowSeconds * 2.6 + bubble.phaseOffset) * 0.06;
      const scale = bubble.baseRadius * introScale * hover;

      bubble.group.scale.setScalar(scale);
      bubble.group.position.z = 0.02 + Math.sin(nowSeconds * 3.2 + bubble.phaseOffset) * 0.01;
      bubble.group.rotation.y = Math.sin(nowSeconds * 1.4 + bubble.phaseOffset) * 0.2;
      bubble.group.rotation.x = Math.sin(nowSeconds * 1.1 + bubble.phaseOffset) * 0.14;

      bubble.shellMaterial.opacity = 0.16 + introT * 0.68;
      bubble.shellMaterial.emissiveIntensity = 0.16 + introT * 0.26;
      bubble.glintMaterial.opacity = 0.24 + introT * 0.66;
      bubble.shellMaterial.color.setHSL(0.54 + bubble.hueOffset, 0.82, 0.66 + Math.sin(nowSeconds * 1.7) * 0.04);
    }

    for (let i = this.poppingBubbles.length - 1; i >= 0; i -= 1) {
      const bubble = this.poppingBubbles[i];
      const popStartedAt = bubble.poppingAt;
      if (popStartedAt === undefined) {
        continue;
      }

      const popT = clamp01((nowSeconds - popStartedAt) / POP_DURATION_SEC);
      if (popT >= 1) {
        this.disposeBubble(bubble);
        this.poppingBubbles.splice(i, 1);
        continue;
      }

      const burst = 1 + easeOutCubic(popT) * 1.2;
      const scale = bubble.baseRadius * burst;
      const alpha = 1 - popT;
      bubble.group.scale.setScalar(scale);
      bubble.group.position.z = 0.02 + popT * 0.34;
      bubble.shellMaterial.opacity = alpha * alpha * 0.9;
      bubble.shellMaterial.emissiveIntensity = 0.2 + popT * 1.4;
      bubble.glintMaterial.opacity = alpha * 0.85;
    }
  }

  clear(): void {
    for (const bubble of this.activeBubbles.values()) {
      this.disposeBubble(bubble);
    }
    for (const bubble of this.poppingBubbles) {
      this.disposeBubble(bubble);
    }
    this.activeBubbles.clear();
    this.poppingBubbles.length = 0;
  }
}
