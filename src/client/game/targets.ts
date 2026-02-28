import * as THREE from "three";
import type { TargetView } from "../types";

export type ToScene = (x: number, y: number) => { x: number; y: number };
export type RadiusToScene = (r: number) => number;

export class TargetMeshManager {
  private readonly meshes = new Map<number, THREE.Mesh>();

  private readonly geometry = new THREE.SphereGeometry(1, 20, 14);

  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xff8c1a,
    roughness: 0.45,
    metalness: 0.15
  });

  constructor(
    private readonly scene: THREE.Scene,
    private readonly toScene: ToScene,
    private readonly radiusToScene: RadiusToScene
  ) {}

  sync(targets: TargetView[]): void {
    const liveIds = new Set<number>();

    for (const target of targets) {
      liveIds.add(target.id);
      let mesh = this.meshes.get(target.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.geometry, this.material);
        this.meshes.set(target.id, mesh);
        this.scene.add(mesh);
      }

      const point = this.toScene(target.x, target.y);
      const radius = this.radiusToScene(target.r);
      mesh.position.set(point.x, point.y, 0);
      mesh.scale.set(radius, radius, radius);
    }

    for (const [id, mesh] of this.meshes) {
      if (liveIds.has(id)) {
        continue;
      }
      this.scene.remove(mesh);
      this.meshes.delete(id);
    }
  }

  clear(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
    }
    this.meshes.clear();
  }
}
