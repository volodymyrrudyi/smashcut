import type { ThreeSetup } from "@smashcut/three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/**
 * An SVG mark extruded into 3D, spinning into place and then swaying gently. Pass the SVG source
 * (`import svg from "./assets/logo.svg?raw"`). `settle` is when (clip-local seconds) it lands face-on.
 */
export const logo3D =
  (svg: string, { settle = 1.4, y = 0 }: { settle?: number; y?: number } = {}): ThreeSetup =>
  ({ THREE, scene, camera }) => {
    const mark = new THREE.Group();
    for (const path of new SVGLoader().parse(svg).paths) {
      const material = new THREE.MeshStandardMaterial({ color: path.color, metalness: 0.35, roughness: 0.3 });
      for (const shape of SVGLoader.createShapes(path)) {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 22, bevelEnabled: true, bevelThickness: 3, bevelSize: 2.5, bevelSegments: 4, curveSegments: 48 });
        mark.add(new THREE.Mesh(geometry, material));
      }
    }
    // SVG y points down: centre the mark on the origin and flip it.
    const box = new THREE.Box3().setFromObject(mark);
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    mark.children.forEach((m) => m.position.sub(centre));
    const pivot = new THREE.Group();
    pivot.add(mark);
    scene.add(pivot);
    /** About two world units across. */
    const unit = 2.1 / Math.max(size.x, size.y);

    scene.add(new THREE.AmbientLight("#ffffff", 1.1));
    const key = new THREE.DirectionalLight("#ffffff", 2.2);
    key.position.set(-3, 4, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight("#a5f3fc", 1);
    fill.position.set(4, -2, 3);
    scene.add(fill);
    camera.position.set(0, 0, 6);

    return (t) => {
      // Ease-out spin from 1.25 turns away to face-on by `settle`, then a slow sway.
      const p = Math.min(1, t.local / settle);
      const ease = 1 - Math.pow(1 - p, 3);
      pivot.rotation.y = (1 - ease) * Math.PI * 2.5 + 0.18 * Math.sin(t.local * 1.3) * ease;
      pivot.rotation.x = (1 - ease) * 0.6 + 0.08 * Math.sin(t.local * 0.9) * ease;
      // The reel itself turns slowly once it has landed.
      mark.rotation.z = -0.35 * Math.max(0, t.local - settle);
      const s = unit * (0.6 + 0.4 * ease);
      pivot.scale.set(s, -s, s);
      pivot.position.y = y;
    };
  };
