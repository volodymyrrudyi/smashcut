import { ambient, asset, decor, defineVideo, dip, fade, group, music, series, sfx, text } from "@smashcut/core";
import { three } from "@smashcut/three";
import logoSvg from "./assets/logo.svg?raw";
import { logo3D } from "./lib/Logo3D";

const title = (s: string) =>
  text(s, { position: "bottom-left", inset: 64, style: { fontSize: 56, fontWeight: 800, color: "#fff" }, enter: "fade-up" });

// A lit, metallic torus knot that the camera orbits.
const knot = three(
  ({ THREE, scene, camera }) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1, 0.32, 256, 48),
      new THREE.MeshStandardMaterial({ color: "#8b5cf6", metalness: 0.6, roughness: 0.25 }),
    );
    scene.add(mesh);
    scene.add(new THREE.AmbientLight("#ffffff", 0.4));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(3, 4, 5);
    scene.add(key);
    const rim = new THREE.PointLight("#22d3ee", 30);
    rim.position.set(-4, -2, -2);
    scene.add(rim);
    return (t) => {
      // Pose everything from t: the same frame always renders the same image.
      mesh.rotation.set(t.time * 0.4, t.time * 0.7, 0);
      const a = t.time * 0.5;
      camera.position.set(Math.sin(a) * 5.5, 1.2, Math.cos(a) * 5.5);
      camera.lookAt(0, 0, 0);
      mesh.scale.setScalar(1 + 0.05 * Math.sin(t.time * 3));
    };
  },
  { background: "#0b1020" },
);

// Async setup: the texture loads through delayRender, so no frame renders without it.
const cube = three(
  async ({ THREE, scene, texture }) => {
    const map = await texture(asset("hero.png"));
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshStandardMaterial({ map, roughness: 0.4 }));
    scene.add(box);
    scene.add(new THREE.HemisphereLight("#ffffff", "#334155", 1.2));
    const key = new THREE.DirectionalLight("#ffffff", 2);
    key.position.set(2, 3, 4);
    scene.add(key);
    // A fixed tilt keeps two or three faces in view; the spin reveals the rest.
    return (t) => box.rotation.set(0.55, 0.6 + t.local * 0.8, 0.1);
  },
  { background: "#111827" },
);

// An SVG extruded into 3D: SVGLoader from three's examples, fed the logo file as text.
const logo = three(logo3D(logoSvg, { y: 0.3 }), { background: "#0b1020" });

// Render this one with `--scale 2` for 4K: the canvas follows the device pixel ratio.
export default defineVideo({
  size: [1920, 1080],
  fps: 30,
  layers: [
    series([
      group([knot, title("three(): lit geometry")], { duration: 4 }),
      fade(0.5),
      group([cube, title("three(): textures from assets")], { duration: 4 }),
      dip(0.8),
      group([logo, title("three(): an SVG, extruded")], { duration: 4.5 }),
    ]),
    decor.grain({ amount: 0.04 }),
    decor.vignette({ strength: 0.5 }),
  ],
  audio: [
    // One ambient track that follows the scenes: a calm bed, a pulse for the cube, the full drive for the logo,
    // then a release into the last chord.
    music(ambient({ seed: 4, key: "D minor", intensity: [[0, 0], [3.3, 0], [4.2, 0.45], [6.2, 0.5], [7.2, 1], [9.4, 1], [10.4, 0]] }), {
      fadeIn: 0.5,
      fadeOut: 1.5,
      duck: 0.3,
    }),
    sfx.swoosh({ at: 3.3, length: 0.9, volume: 0.5 }),
    // The logo scene starts at 6.7 s (two 4 s scenes and a 4.5 s one, minus the 0.5 s fade and the 0.8 s dip).
    sfx.riser({ at: 5.9, length: 0.8 }),
    sfx.swoosh({ at: 6.7, length: 1.2, volume: 0.4 }),
    sfx.bell({ at: 6.7 + 1.4 }),
  ],
});
