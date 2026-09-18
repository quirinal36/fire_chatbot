/**
 * 벽 다각형을 Three.js 로 세우는 뷰어. Rhino 의 ExtrudeCrv 처럼 도면 위 벽 윤곽을 높이만큼 끌어올린다.
 * three 는 이 파일에서만 쓰고 동적으로 불러와 채팅 화면 번들에 섞이지 않게 한다.
 */
import type * as THREE from 'three';
import type { WallModel } from './walls';

export interface Viewer {
  setModel(model: WallModel, floor: HTMLCanvasElement | null, pxPerMeter: number): void;
  setHeight(meters: number): void;
  setFloorVisible(visible: boolean): void;
  dispose(): void;
}

export async function createViewer(container: HTMLElement): Promise<Viewer> {
  const [T, { OrbitControls }] = await Promise.all([
    import('three'),
    import('three/examples/jsm/controls/OrbitControls.js'),
  ]);

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45, 1, 0.05, 2000);
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;

  scene.add(new T.HemisphereLight(0xffffff, 0x9a8f7a, 1.0));
  const sun = new T.DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  const wallMat = new T.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.85 });
  const edgeMat = new T.LineBasicMaterial({ color: 0x3a3733 });
  const floorMat = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const walls = new T.Group();
  const floor = new T.Mesh(new T.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(walls, floor);

  let shapes: THREE.Shape[] = [];
  let height = 2.7;
  let extent = 10;

  function disposeWalls(): void {
    for (const child of walls.children) {
      if (child instanceof T.Mesh || child instanceof T.LineSegments) child.geometry.dispose();
    }
    walls.clear();
  }

  function buildWalls(): void {
    disposeWalls();
    for (const shape of shapes) {
      const geo = new T.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      // Shape 는 XY 평면에 놓이므로 Y 가 아래로 가는 도면 좌표를 바닥(XZ)으로 눕힌다
      geo.rotateX(Math.PI / 2);
      geo.translate(0, height, 0);
      const mesh = new T.Mesh(geo, wallMat);
      mesh.castShadow = mesh.receiveShadow = true;
      walls.add(mesh, new T.LineSegments(new T.EdgesGeometry(geo, 30), edgeMat));
    }
  }

  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let running = true;
  const loop = (): void => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    setModel(model, floorCanvas, pxPerMeter) {
      const s = 1 / pxPerMeter;
      const W = model.width * s;
      const H = model.height * s;
      extent = Math.max(W, H);
      shapes = model.polygons.map((p) => {
        const shape = new T.Shape(p.outer.map(([x, y]) => new T.Vector2(x * s, y * s)));
        for (const hole of p.holes) shape.holes.push(new T.Path(hole.map(([x, y]) => new T.Vector2(x * s, y * s))));
        return shape;
      });
      buildWalls();

      floor.geometry.dispose();
      floor.geometry = new T.PlaneGeometry(W, H);
      floor.position.set(W / 2, -0.002, H / 2);
      floorMat.map?.dispose();
      floorMat.map = null;
      if (floorCanvas) {
        const tex = new T.CanvasTexture(floorCanvas);
        tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        floorMat.map = tex;
      }
      floorMat.needsUpdate = true;

      sun.position.set(W, extent * 1.5, H * 0.3);
      sun.target.position.set(W / 2, 0, H / 2);
      sun.target.updateMatrixWorld();
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.far = extent * 5;
      cam.updateProjectionMatrix();

      // 벽이 있는 범위(여백 제외)를 감싸는 구가 세로·가로 시야각 중 좁은 쪽에 들어오도록 거리를 잡는다
      let minX = W, minY = H, maxX = 0, maxY = 0;
      for (const p of model.polygons) for (const [x, y] of p.outer) {
        minX = Math.min(minX, x * s); maxX = Math.max(maxX, x * s);
        minY = Math.min(minY, y * s); maxY = Math.max(maxY, y * s);
      }
      if (minX >= maxX || minY >= maxY) { minX = 0; minY = 0; maxX = W; maxY = H; }
      const radius = Math.hypot(maxX - minX, maxY - minY) / 2 * 1.05;
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const dist = radius / Math.sin(Math.min(vFov, hFov) / 2);
      const dir = new T.Vector3(0, 0.8, 1).normalize();
      controls.target.set((minX + maxX) / 2, 0, (minY + maxY) / 2);
      camera.position.copy(controls.target).addScaledVector(dir, dist);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();
      controls.update();
    },
    setHeight(meters) {
      height = meters;
      buildWalls();
    },
    setFloorVisible(visible) {
      floor.visible = visible;
    },
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      disposeWalls();
      floor.geometry.dispose();
      floorMat.map?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
