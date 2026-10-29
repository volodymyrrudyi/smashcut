import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { react, type BaseProps, type FrameContext, type ReactNodeSpec } from "@smashcut/core";
import { delayRender, useClip } from "@smashcut/runtime";

export interface ThreeContext {
  /** The three.js namespace, so timelines don't need their own import. */
  THREE: typeof THREE;
  scene: THREE.Scene;
  /** Perspective camera at (0, 0, 5) looking at the origin. Move it, or replace `ctx.camera`. */
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** Layout size of the clip in px (the canvas renders at this × device pixel ratio). */
  width: number;
  height: number;
  /** Load a texture (e.g. `asset("wood.jpg")`) in sRGB; the scene waits for it before rendering. */
  texture(url: string): Promise<THREE.Texture>;
}

/** Called before every frame is drawn. Pose the scene as a pure function of `t`; never use clocks or timers. */
export type ThreeFrame = (t: FrameContext) => void;

/** Build the scene once. Return the per-frame function (or nothing for a static scene). May be async. */
export type ThreeSetup = (ctx: ThreeContext) => ThreeFrame | void | Promise<ThreeFrame | void>;

export interface ThreeOptions extends BaseProps {
  /** Scene background colour; omit for a transparent canvas over the layers below. */
  background?: string;
  /** Vertical field of view in degrees. Default 45. */
  fov?: number;
  /** Default true. */
  antialias?: boolean;
}

interface ThreeViewProps {
  setup: ThreeSetup;
  background?: string;
  fov: number;
  antialias: boolean;
}

interface Instance {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  ctx: ThreeContext;
  ready: Promise<ThreeFrame | void>;
}

function ThreeView({ setup, background, fov, antialias }: ThreeViewProps) {
  const t = useClip();
  const canvas = useRef<HTMLCanvasElement>(null);
  const instance = useRef<Instance | null>(null);

  // Build the renderer and scene once per mount.
  useLayoutEffect(() => {
    // preserveDrawingBuffer keeps the last frame on the canvas for the page screenshot.
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias, alpha: !background, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(t.width, t.height, false);
    const scene = new THREE.Scene();
    if (background) scene.background = new THREE.Color(background);
    const camera = new THREE.PerspectiveCamera(fov, t.width / t.height, 0.1, 1000);
    camera.position.set(0, 0, 5);
    const loader = new THREE.TextureLoader();
    const ctx: ThreeContext = {
      THREE,
      scene,
      camera,
      renderer,
      width: t.width,
      height: t.height,
      texture: (url) =>
        delayRender(
          loader.loadAsync(url).then((tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
          }),
        ),
    };
    const ready = delayRender(Promise.resolve().then(() => setup(ctx)));
    instance.current = { renderer, scene, ctx, ready };
    return () => {
      renderer.dispose();
      instance.current = null;
    };
    // Built once per mount: setup, size and options are fixed for the life of the clip.
  }, []);

  // Draw every frame after the scene is ready.
  useLayoutEffect(() => {
    const it = instance.current;
    if (!it) return;
    delayRender(
      it.ready.then((frame) => {
        if (instance.current !== it) return;
        frame?.(t);
        it.renderer.render(it.scene, it.ctx.camera);
      }),
    );
  });

  return <canvas ref={canvas} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

/**
 * A three.js scene as a clip. `setup` builds it once; the function it returns poses the scene for each frame.
 *
 * ```ts
 * three(({ THREE, scene }) => {
 *   const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
 *   scene.add(cube);
 *   return (t) => cube.rotation.set(t.time, t.time * 0.7, 0);
 * }, { duration: 4 })
 * ```
 */
export function three(setup: ThreeSetup, opts: ThreeOptions = {}): ReactNodeSpec {
  const { background, fov = 45, antialias = true, ...props } = opts;
  return react(ThreeView, { setup, background, fov, antialias }, props);
}
