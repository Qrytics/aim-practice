/**
 * three.js rendering of the original practice arena. Rendering only:
 * it reads player state, it never changes simulation state.
 *
 * Arena design is original: a dark rectangular room with a floor grid,
 * four corner columns, and a ring of numbered "turn-check" posts at 30 degree
 * steps. The post at 0 degrees faces the start orientation, so a full physical
 * mouse turn can be compared with the degrees the app reports.
 */

import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { BufferGeometry, Line, LineBasicMaterial, SphereGeometry, Vector3 } from 'three';
import type { PlayerState } from '../core/movement';
import type { DrillTarget, ProfileId } from '../core/drill';
import { EYE_HEIGHT } from '../core/geometry';

export { EYE_HEIGHT };

/** Per-profile arena treatment. Original palettes; precision is cool and still, tracking is warm. */
interface Palette {
  background: string;
  floor: string;
  wall: string;
  column: string;
  stripe: string;
  stripeGlow: string;
  gridMajor: string;
  gridMinor: string;
  post: string;
  postGlow: string;
  ambient: string;
  target: string;
  targetGlow: string;
  hot: string;
  hotGlow: string;
}

const PALETTES: Record<ProfileId, Palette> = {
  precision: {
    background: '#07110f',
    floor: '#0e1f21',
    wall: '#12292c',
    column: '#1b3b3d',
    stripe: '#2f7b77',
    stripeGlow: '#10403e',
    gridMajor: '#2f7b77',
    gridMinor: '#1b3b3c',
    post: '#7fd6cf',
    postGlow: '#1e5e59',
    ambient: '#8fb7b3',
    target: '#ff6a2a', // orange against teal: strong hue and luminance contrast
    targetGlow: '#a03a10',
    hot: '#ff6a2a',
    hotGlow: '#a03a10',
  },
  tracking: {
    background: '#140d08',
    floor: '#21160c',
    wall: '#2d1f12',
    column: '#3b2916',
    stripe: '#b8742f',
    stripeGlow: '#4d2d0f',
    gridMajor: '#b8742f',
    gridMinor: '#3b2615',
    post: '#e0a15a',
    postGlow: '#6b4115',
    ambient: '#c9a883',
    target: '#7fe9ff', // cyan against warm brown
    targetGlow: '#16707f',
    hot: '#ffffff', // aim is on the target: brighter, near white
    hotGlow: '#9feeff',
  },
};

interface Burst {
  mesh: Mesh;
  age: number;
}
/** Player may roam this half-extent (m); the posts and walls sit outside it. */
export const PLAY_HALF_EXTENT = 7;
const WALL_HALF_EXTENT = 12;
const POST_RING_RADIUS = 10.5;

export interface RenderInfo {
  rendererName: string;
  /** true = a software rasteriser was identified; false = not identified (not proof of GPU) */
  softwareDetected: boolean;
  /** 'masked' when the browser does not expose the renderer string */
  rendererKnown: boolean;
  devicePixelRatio: number;
  pixelRatioUsed: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  cssWidth: number;
  cssHeight: number;
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function labelTexture(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b1a1b';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#7fd6cf';
  g.lineWidth = 3;
  g.strokeRect(2, 2, 124, 60);
  g.fillStyle = '#e4f5f3';
  g.font = '600 34px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 34);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class ArenaRenderer {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly resizeObserver: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;
  private readonly onDprChange = () => {
    this.armDprWatch();
    this.resize();
  };
  private readonly abort = new AbortController();
  private _lost = false;
  private maxPixelRatio = 2;
  private profile: ProfileId = 'precision';
  private palette: Palette = PALETTES.precision;
  private lastRenderT = 0;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private fog!: Fog;
  private ambientLight!: AmbientLight;
  private floorMat!: MeshStandardMaterial;
  private wallMat!: MeshStandardMaterial;
  private colMat!: MeshStandardMaterial;
  private stripeMat!: MeshStandardMaterial;
  private postMat!: MeshStandardMaterial;
  private grid!: GridHelper;
  private readonly targetGeo = new SphereGeometry(1, 32, 20);
  private targetMat!: MeshStandardMaterial;
  private hotMat!: MeshStandardMaterial;
  private readonly targetMeshes = new Map<number, Mesh>();
  private readonly bursts: Burst[] = [];
  private readonly burstGeo = new SphereGeometry(1, 16, 10);
  private arcGuide!: Line;

  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly stage: HTMLElement,
    verticalFovDeg: number,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.camera = new PerspectiveCamera(verticalFovDeg, 16 / 9, 0.05, 80);
    this.camera.rotation.order = 'YXZ';
    this.buildScene();

    canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault(); // required so the browser may restore the context
        this._lost = true;
        this.onContextLost?.();
      },
      { signal: this.abort.signal },
    );
    canvas.addEventListener(
      'webglcontextrestored',
      () => {
        this._lost = false;
        this.resize();
        this.onContextRestored?.();
      },
      { signal: this.abort.signal },
    );

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.armDprWatch();
    this.resize();
  }

  get contextLost(): boolean {
    return this._lost;
  }

  private armDprWatch(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    // A resolution query matches only the current DPR; it fires once when the DPR changes.
    this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange, { once: true });
  }

  private buildScene(): void {
    const scene = this.scene;
    scene.background = new Color('#07110f');
    this.fog = new Fog('#07110f', 14, 34);
    scene.fog = this.fog;

    this.ambientLight = new AmbientLight('#8fb7b3', 0.9);
    scene.add(this.ambientLight);
    const sun = new DirectionalLight('#ffffff', 1.6);
    sun.position.set(4, 10, 6);
    scene.add(sun);

    const wallMat = (this.wallMat = new MeshStandardMaterial({ color: '#12292c', roughness: 0.95 }));
    this.floorMat = new MeshStandardMaterial({ color: '#0e1f21', roughness: 1 });
    const floor = new Mesh(new PlaneGeometry(WALL_HALF_EXTENT * 2, WALL_HALF_EXTENT * 2), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    this.buildGrid('#2f7b77', '#1b3b3c');

    const H = 5;
    const T = 0.4;
    const W = WALL_HALF_EXTENT;
    const walls: Array<[number, number, number, number]> = [
      [0, -W - T / 2, W * 2 + T * 2, T],
      [0, W + T / 2, W * 2 + T * 2, T],
      [-W - T / 2, 0, T, W * 2],
      [W + T / 2, 0, T, W * 2],
    ];
    for (const [x, z, w, d] of walls) {
      const m = new Mesh(new BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z);
      scene.add(m);
    }

    // Wall base stripe: a depth cue for strafing and turning.
    const stripeMat = (this.stripeMat = new MeshStandardMaterial({ color: '#2f7b77', roughness: 0.6, emissive: '#10403e' }));
    for (const [x, z, w, d] of walls) {
      const s = new Mesh(new BoxGeometry(w - 0.02, 0.12, d + 0.02), stripeMat);
      s.position.set(x, 0.06, z);
      scene.add(s);
    }

    // Corner columns: parallax cues. Decorative, not collidable.
    const colMat = (this.colMat = new MeshStandardMaterial({ color: '#1b3b3d', roughness: 0.8 }));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const c = new Mesh(new BoxGeometry(1.2, H, 1.2), colMat);
        c.position.set(sx * (W - 0.6), H / 2, sz * (W - 0.6));
        scene.add(c);
      }
    }

    // Turn-check posts: 12 posts, 30 degrees apart; 0 degrees is straight ahead (-z).
    const ring = new Group();
    const postMat = (this.postMat = new MeshStandardMaterial({ color: '#7fd6cf', roughness: 0.5, emissive: '#1e5e59' }));
    const zeroMat = new MeshStandardMaterial({ color: '#f2efe8', roughness: 0.4, emissive: '#6b6a64' });
    for (let i = 0; i < 12; i++) {
      const deg = i * 30;
      const a = (deg * Math.PI) / 180;
      // Positive turn = view turns right (clockwise from above), so post i sits at +x for small angles.
      const x = Math.sin(a) * POST_RING_RADIUS;
      const z = -Math.cos(a) * POST_RING_RADIUS;
      const post = new Mesh(new CylinderGeometry(0.16, 0.16, 3.2, 16), i === 0 ? zeroMat : postMat);
      post.position.set(x, 1.6, z);
      ring.add(post);
      const label = new Sprite(new SpriteMaterial({ map: labelTexture(`${deg}`), fog: true }));
      label.scale.set(1.5, 0.75, 1);
      label.position.set(x, 3.7, z);
      ring.add(label);
    }
    scene.add(ring);

    // Tracking only: a faint floor line along the arc the target travels (a depth and path cue).
    const pts: Vector3[] = [];
    for (let d = -55; d <= 55; d += 2.5) {
      const r = (d * Math.PI) / 180;
      pts.push(new Vector3(Math.sin(r) * 9.2, 0.03, -Math.cos(r) * 9.2));
    }
    this.arcGuide = new Line(new BufferGeometry().setFromPoints(pts), new LineBasicMaterial({ color: '#e0a15a', transparent: true, opacity: 0.55 }));
    scene.add(this.arcGuide);

    this.targetMat = new MeshStandardMaterial({ color: '#ff6a2a', roughness: 0.35, emissive: '#a03a10' });
    this.hotMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3, emissive: '#9feeff' });
    this.setProfile('precision');
  }

  private buildGrid(major: string, minor: string): void {
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as { dispose(): void }).dispose();
    }
    this.grid = new GridHelper(WALL_HALF_EXTENT * 2, WALL_HALF_EXTENT * 2, major, minor);
    this.grid.position.y = 0.002;
    this.scene.add(this.grid);
  }

  /** Switch the arena treatment. Layout and geometry are identical for both profiles. */
  setProfile(profile: ProfileId): void {
    const p = PALETTES[profile];
    this.profile = profile;
    this.palette = p;
    (this.scene.background as Color).set(p.background);
    this.fog.color.set(p.background);
    this.ambientLight.color.set(p.ambient);
    this.floorMat.color.set(p.floor);
    this.wallMat.color.set(p.wall);
    this.colMat.color.set(p.column);
    this.stripeMat.color.set(p.stripe);
    this.stripeMat.emissive.set(p.stripeGlow);
    this.postMat.color.set(p.post);
    this.postMat.emissive.set(p.postGlow);
    this.buildGrid(p.gridMajor, p.gridMinor);
    this.targetMat.color.set(p.target);
    this.targetMat.emissive.set(p.targetGlow);
    this.hotMat.color.set(p.hot);
    this.hotMat.emissive.set(p.hotGlow);
    this.arcGuide.visible = profile === 'tracking';
    for (const m of this.targetMeshes.values()) this.scene.remove(m);
    this.targetMeshes.clear();
  }

  get currentProfile(): ProfileId {
    return this.profile;
  }

  /** Make the drawn targets match the drill's. Cheap: meshes are pooled by id. */
  setTargets(targets: readonly DrillTarget[]): void {
    const seen = new Set<number>();
    for (const t of targets) {
      seen.add(t.id);
      let m = this.targetMeshes.get(t.id);
      if (!m) {
        m = new Mesh(this.targetGeo, this.targetMat);
        this.targetMeshes.set(t.id, m);
        this.scene.add(m);
      }
      m.position.set(t.x, t.y, t.z);
      m.scale.setScalar(t.r);
      m.material = t.hot ? this.hotMat : this.targetMat;
    }
    for (const [id, m] of this.targetMeshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.targetMeshes.delete(id);
      }
    }
  }

  clearTargets(): void {
    this.setTargets([]);
    for (const b of this.bursts) this.scene.remove(b.mesh);
    this.bursts.length = 0;
  }

  /** A short expanding flash where a target was hit. Static flash under reduced motion. */
  burst(x: number, y: number, z: number): void {
    const mat = new MeshStandardMaterial({
      color: '#ffffff',
      emissive: this.palette.hotGlow,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new Mesh(this.burstGeo, mat);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.25);
    this.scene.add(mesh);
    this.bursts.push({ mesh, age: 0 });
  }

  private tickBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      b.age += dt;
      const life = this.reducedMotion ? 0.12 : 0.28;
      const k = Math.min(1, b.age / life);
      if (!this.reducedMotion) b.mesh.scale.setScalar(0.25 + 0.5 * k);
      (b.mesh.material as MeshStandardMaterial).opacity = 0.9 * (1 - k);
      if (k >= 1) {
        this.scene.remove(b.mesh);
        (b.mesh.material as MeshStandardMaterial).dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  setVerticalFov(deg: number): void {
    this.camera.fov = deg;
    this.camera.updateProjectionMatrix();
  }

  setMaxPixelRatio(r: number): void {
    this.maxPixelRatio = Math.max(1, r);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, Math.floor(this.stage.clientWidth));
    const h = Math.max(1, Math.floor(this.stage.clientHeight));
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false); // CSS size is owned by the stylesheet
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  get aspect(): number {
    return this.camera.aspect;
  }

  render(p: PlayerState): void {
    if (this._lost) return;
    const now = performance.now() / 1000;
    const dt = this.lastRenderT ? Math.min(0.1, now - this.lastRenderT) : 0;
    this.lastRenderT = now;
    this.tickBursts(dt);
    this.camera.position.set(p.x, EYE_HEIGHT, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
    this.renderer.render(this.scene, this.camera);
  }

  info(): RenderInfo {
    const gl = this.renderer.getContext();
    let name = 'unknown (browser did not expose the renderer string)';
    let known = false;
    try {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        known = true;
      }
    } catch {
      /* leave unknown */
    }
    return {
      rendererName: name,
      rendererKnown: known,
      softwareDetected: known && /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name),
      devicePixelRatio: window.devicePixelRatio || 1,
      pixelRatioUsed: this.renderer.getPixelRatio(),
      drawingBufferWidth: gl.drawingBufferWidth,
      drawingBufferHeight: gl.drawingBufferHeight,
      cssWidth: this.stage.clientWidth,
      cssHeight: this.stage.clientHeight,
    };
  }

  dispose(): void {
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.renderer.dispose();
  }
}
