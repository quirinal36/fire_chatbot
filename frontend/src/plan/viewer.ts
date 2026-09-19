/**
 * 벽 다각형을 Three.js 로 세우는 뷰어. Rhino 의 ExtrudeCrv 처럼 도면 위 벽 윤곽을 높이만큼 끌어올린다.
 * 편집 모드에서는 바닥 평면에 마우스를 쏘아 도면 픽셀 좌표를 돌려준다. three 는 이 파일에서만 쓰고
 * 동적으로 불러와 채팅 화면 번들에 섞이지 않게 한다.
 */
import type * as THREE from 'three';
import type { Pt, Rect, WallPolygon } from './walls';
import { roomLabel, type Room } from './rooms';

export interface EditHandlers {
  start(p: Pt): void;
  move(p: Pt): void;
  end(p: Pt): void;
}

export interface Viewer {
  /** 도면 크기와 축척을 정한다. 바닥 텍스처를 깔고 카메라를 맞춘다 */
  setModel(width: number, height: number, floor: HTMLCanvasElement | null, pxPerMeter: number): void;
  setWalls(polygons: WallPolygon[]): void;
  /** 구역 바닥 색과 표. names 가 있으면 번호 대신 이름을 쓴다 */
  setRooms(rooms: Room[], names?: Readonly<Record<number, string>>): void;
  /** 선택한 구역을 강조한다. null 이면 모두 같은 농도로 보인다 */
  setHighlightedRoom(id: number | null): void;
  /** 창문 자리(픽셀 사각형). 아래엔 창턱, 위엔 유리를 세운다 */
  setWindows(rects: readonly Rect[]): void;
  /** 문 자리(픽셀 사각형). 문 높이 위로 인방을 남겨 문으로 보이게 한다 */
  setDoors(rects: readonly Rect[]): void;
  setHeight(meters: number): void;
  setFloorVisible(visible: boolean): void;
  /** 보는 방식. 평면은 위에서 곧게 내려다보고 벽을 납작하게 눕혀 원본·치수·구역을 가리지 않는다 */
  setViewMode(mode: ViewMode): void;
  /** 드래그 중 미리보기 다각형(픽셀 좌표). null 이면 지운다 */
  setGuide(polygon: Pt[] | null, tone?: 'add' | 'erase' | 'scale'): void;
  /** 편집 핸들러를 걸면 왼쪽 드래그가 편집이 되고, null 이면 보는 방식에 맞는 조작으로 돌아간다 */
  setEditing(handlers: EditHandlers | null): void;
  /** 지금 보는 방식 그대로 도면 전체가 들어오게 카메라만 다시 맞춘다 */
  fitView(): void;
  dispose(): void;
}

export type ViewMode = 'plan' | '3d';

/** 평면에서 벽을 눕히는 두께(m). 0 이면 바닥과 겹쳐 깜빡이므로 아주 얕게 남긴다 */
const PLAN_SLAB_M = 0.02;

const ROOM_HUES = [18, 200, 140, 280, 40, 320, 100, 240, 0, 170, 60, 300];

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
  const canvas = renderer.domElement;

  const controls = new OrbitControls(camera, canvas);
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
  const guideMats = {
    add: new T.MeshStandardMaterial({ color: 0xb5532f, transparent: true, opacity: 0.55 }),
    erase: new T.MeshStandardMaterial({ color: 0xc0392b, transparent: true, opacity: 0.4 }),
    scale: new T.MeshStandardMaterial({ color: 0x2f6fb5, transparent: true, opacity: 0.8 }),
  };
  const walls = new T.Group();
  const rooms = new T.Group();
  const windows = new T.Group();
  const doors = new T.Group();
  const sillMat = wallMat;
  const paneMat = new T.MeshStandardMaterial({ color: 0x8fc1e3, transparent: true, opacity: 0.35, roughness: 0.2, side: T.DoubleSide });
  const floor = new T.Mesh(new T.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  let guide: THREE.Mesh | null = null;
  scene.add(walls, rooms, windows, doors, floor);

  let polygons: WallPolygon[] = [];
  let roomList: Room[] = [];
  let roomNames: Readonly<Record<number, string>> = {};
  let highlightedRoom: number | null = null;
  /** 편집 핸들러. 걸려 있으면 왼쪽 끌기는 편집이다 */
  let handlers: EditHandlers | null = null;
  let windowRects: readonly Rect[] = [];
  let doorRects: readonly Rect[] = [];
  let height = 2.7;
  let viewMode: ViewMode = 'plan';
  let s = 1 / 30; // 픽셀 → 미터
  let W = 10;
  let H = 10;
  let fitCenter = new T.Vector3();
  let fitRadius = 5;
  /** 도면을 감싸는 상자의 반 크기(m). 평면은 이 상자에 맞춘다 */
  let fitHalfX = 5;
  let fitHalfZ = 5;

  function disposeGroup(group: THREE.Group): void {
    for (const child of group.children) {
      if (child instanceof T.Mesh || child instanceof T.LineSegments) child.geometry.dispose();
      if (child instanceof T.Sprite) { child.material.map?.dispose(); child.material.dispose(); }
    }
    group.clear();
  }

  function toShape(p: WallPolygon): THREE.Shape {
    const shape = new T.Shape(p.outer.map(([x, y]) => new T.Vector2(x * s, y * s)));
    for (const hole of p.holes) shape.holes.push(new T.Path(hole.map(([x, y]) => new T.Vector2(x * s, y * s))));
    return shape;
  }

  function buildWalls(): void {
    disposeGroup(walls);
    for (const p of polygons) {
      const geo = new T.ExtrudeGeometry(toShape(p), { depth: height, bevelEnabled: false });
      // Shape 는 XY 평면에 놓이므로 Y 가 아래로 가는 도면 좌표를 바닥(XZ)으로 눕힌다
      geo.rotateX(Math.PI / 2);
      geo.translate(0, height, 0);
      const mesh = new T.Mesh(geo, wallMat);
      mesh.castShadow = mesh.receiveShadow = true;
      walls.add(mesh, new T.LineSegments(new T.EdgesGeometry(geo, 30), edgeMat));
    }
  }

  const SILL_M = 0.9;
  const DOOR_M = 2.1;
  const rectShape = (r: Rect): THREE.Shape => {
    const poly: Pt[] = [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
    return toShape({ outer: poly, holes: [] });
  };

  /** 문 위에 남는 벽(인방). 이게 있어야 벽이 그냥 끊긴 자리와 구별된다 */
  function buildDoors(): void {
    disposeGroup(doors);
    const doorH = Math.min(DOOR_M, height * 0.9);
    const lintelH = height - doorH;
    if (lintelH <= 0.02) return; // 벽이 문보다 낮으면 인방이 없다
    for (const r of doorRects) {
      const geo = new T.ExtrudeGeometry(rectShape(r), { depth: lintelH, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, height, 0); // 벽 맨 위에 붙인다
      const mesh = new T.Mesh(geo, wallMat);
      mesh.castShadow = mesh.receiveShadow = true;
      doors.add(mesh, new T.LineSegments(new T.EdgesGeometry(geo, 30), edgeMat));
    }
  }

  function buildWindows(): void {
    disposeGroup(windows);
    for (const r of windowRects) {
      const shape = rectShape(r);
      const sillH = Math.min(SILL_M, height * 0.4);
      const sill = new T.ExtrudeGeometry(shape, { depth: sillH, bevelEnabled: false });
      sill.rotateX(Math.PI / 2);
      sill.translate(0, sillH, 0);
      const sillMesh = new T.Mesh(sill, sillMat);
      sillMesh.castShadow = sillMesh.receiveShadow = true;
      const paneH = Math.max(0.05, height * 0.85 - sillH);
      const pane = new T.ExtrudeGeometry(shape, { depth: paneH, bevelEnabled: false });
      pane.rotateX(Math.PI / 2);
      pane.translate(0, sillH + paneH, 0);
      windows.add(sillMesh, new T.Mesh(pane, paneMat), new T.LineSegments(new T.EdgesGeometry(sill, 30), edgeMat));
    }
  }

  function labelSprite(text: string, hue: number, opacity = 1): THREE.Sprite {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 96;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `hsla(${hue}, 60%, 30%, 0.85)`;
      ctx.beginPath();
      ctx.roundRect(8, 8, 304, 80, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 160, 50, 288);
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const sprite = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity }));
    const wide = Math.max(0.8, fitRadius * 0.16);
    sprite.scale.set(wide, wide * 0.375, 1);
    return sprite;
  }

  function buildRooms(): void {
    disposeGroup(rooms);
    roomList.forEach((room, i) => {
      const hue = ROOM_HUES[i % ROOM_HUES.length] ?? 0;
      const selected = highlightedRoom === room.id;
      const opacity = highlightedRoom === null ? 0.5 : selected ? 0.75 : 0.16;
      // 눕힌 면의 법선이 아래를 향하므로 양면으로 그려야 위에서 보인다
      const mat = new T.MeshBasicMaterial({ color: new T.Color(`hsl(${hue}, 70%, 55%)`), transparent: true, opacity, depthWrite: false, side: T.DoubleSide });
      for (const p of room.polygons) {
        const geo = new T.ShapeGeometry(toShape(p));
        geo.rotateX(Math.PI / 2);
        geo.translate(0, 0.01, 0);
        const mesh = new T.Mesh(geo, mat);
        rooms.add(mesh);
      }
      // 고른 구역은 색만이 아니라 글자로도 표시한다. 색을 구별하기 어려워도 어디를 골랐는지 알 수 있어야 한다
      const text = `${selected ? '● ' : ''}${roomLabel(room.id, roomNames)} · ${room.area.toFixed(1)}㎡`;
      const label = labelSprite(text, hue, highlightedRoom === null || selected ? 1 : 0.28);
      label.position.set(room.center[0] * s, 0.3, room.center[1] * s);
      rooms.add(label);
    });
  }

  /**
   * 보는 방식을 장면에 반영한다. 평면에서는 벽을 바닥에 눕히고(높이만 눌러 형상은 그대로다)
   * 문틀·창틀처럼 세로로 서 있는 것은 감춘다. 위에서 보면 가리기만 하고 알려 주는 게 없다.
   */
  function applyViewMode(): void {
    const plan = viewMode === 'plan';
    walls.scale.y = plan ? PLAN_SLAB_M / Math.max(height, 0.01) : 1;
    doors.visible = !plan;
    windows.visible = !plan;
    // 평면에서 돌리면 더 이상 평면이 아니다. 돌리기 대신 끌어서 옮긴다
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = plan ? 0 : Math.PI / 2 - 0.02;
    applyControls();
  }

  /** 편집 중이면 왼쪽 끌기는 편집이다. 아니면 평면은 옮기기, 3D 는 돌리기 */
  function applyControls(): void {
    if (handlers) {
      controls.mouseButtons.LEFT = null;
      controls.touches.ONE = null;
      return;
    }
    controls.mouseButtons.LEFT = viewMode === 'plan' ? T.MOUSE.PAN : T.MOUSE.ROTATE;
    controls.touches.ONE = viewMode === 'plan' ? T.TOUCH.PAN : T.TOUCH.ROTATE;
  }

  /** 지금 보는 방식의 카메라 방향. 평면은 바로 위에서 */
  function viewDirection(): THREE.Vector3 {
    return viewMode === 'plan' ? new T.Vector3(0, 1, 0.0001) : new T.Vector3(0, 0.8, 1);
  }

  function switchView(next: ViewMode): void {
    viewMode = next;
    applyViewMode();
    fitCamera(viewDirection());
  }

  function fitCamera(direction: THREE.Vector3): void {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    // 평면은 바로 위에서 보므로 도면 상자가 화면에 꽉 차게 맞춘다. 구에 맞추면 넓은 화면에서 도면이 작아진다.
    // 3D 는 돌려 볼 것이므로 어느 각도에서도 잘리지 않는 구에 맞춘다
    const dist =
      viewMode === 'plan'
        ? Math.max(fitHalfX / Math.tan(hFov / 2), fitHalfZ / Math.tan(vFov / 2)) * 1.06
        : fitRadius / Math.sin(Math.min(vFov, hFov) / 2);
    controls.target.copy(fitCenter);
    camera.position.copy(fitCenter).addScaledVector(direction.clone().normalize(), dist);
    camera.far = dist * 10;
    camera.updateProjectionMatrix();
    controls.update();
  }

  function computeFit(): void {
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (const p of polygons) for (const [x, y] of p.outer) {
      minX = Math.min(minX, x * s); maxX = Math.max(maxX, x * s);
      minY = Math.min(minY, y * s); maxY = Math.max(maxY, y * s);
    }
    if (minX >= maxX || minY >= maxY) { minX = 0; minY = 0; maxX = W; maxY = H; }
    fitCenter = new T.Vector3((minX + maxX) / 2, 0, (minY + maxY) / 2);
    fitRadius = (Math.hypot(maxX - minX, maxY - minY) / 2) * 1.05;
    fitHalfX = Math.max((maxX - minX) / 2, 0.5);
    fitHalfZ = Math.max((maxY - minY) / 2, 0.5);
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

  // ---- 편집: 마우스 → 바닥 평면 → 픽셀 좌표
  const raycaster = new T.Raycaster();
  const plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
  const hit = new T.Vector3();
  let dragging = false;

  function toPlan(event: PointerEvent): Pt | null {
    const rect = canvas.getBoundingClientRect();
    const ndc = new T.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    return [hit.x / s, hit.z / s];
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!handlers || e.button !== 0) return;
    const p = toPlan(e);
    if (!p) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    handlers.start(p);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!handlers || !dragging) return;
    const p = toPlan(e);
    if (p) handlers.move(p);
  });
  const finish = (e: PointerEvent): void => {
    if (!handlers || !dragging) return;
    dragging = false;
    const p = toPlan(e);
    if (p) handlers.end(p);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  let running = true;
  const loop = (): void => {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    setModel(width, height_, floorCanvas, pxPerMeter) {
      s = 1 / pxPerMeter;
      W = width * s;
      H = height_ * s;
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

      const extent = Math.max(W, H);
      sun.position.set(W, extent * 1.5, H * 0.3);
      sun.target.position.set(W / 2, 0, H / 2);
      sun.target.updateMatrixWorld();
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -extent;
      cam.right = cam.top = extent;
      cam.far = extent * 5;
      cam.updateProjectionMatrix();

      buildWalls();
      buildWindows();
      buildDoors();
      computeFit();
      buildRooms();
      // 처음 여는 도면은 평면이다. 입체는 눌러서 본다
      applyViewMode();
      fitCamera(viewDirection());
    },
    setWalls(next) {
      polygons = next;
      buildWalls();
      applyViewMode();
    },
    setRooms(next, names = {}) {
      roomList = next;
      roomNames = names;
      buildRooms();
    },
    setHighlightedRoom(id) {
      highlightedRoom = id;
      buildRooms();
    },
    setWindows(rects) {
      windowRects = rects;
      buildWindows();
    },
    setDoors(rects) {
      doorRects = rects;
      buildDoors();
    },
    setHeight(meters) {
      height = meters;
      buildWalls();
      buildWindows();
      buildDoors();
      applyViewMode();
    },
    setFloorVisible(visible) {
      floor.visible = visible;
    },
    setGuide(polygon, tone = 'add') {
      if (guide) { guide.geometry.dispose(); scene.remove(guide); guide = null; }
      if (!polygon || polygon.length < 3) return;
      const depth = tone === 'add' ? height * 1.01 : tone === 'erase' ? height * 1.05 : 0.05;
      const geo = new T.ExtrudeGeometry(toShape({ outer: polygon, holes: [] }), { depth, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, depth, 0);
      guide = new T.Mesh(geo, guideMats[tone]);
      scene.add(guide);
    },
    setEditing(next) {
      handlers = next;
      dragging = false;
      applyControls();
      canvas.style.cursor = next ? 'crosshair' : '';
    },
    setViewMode(next) {
      switchView(next);
    },
    fitView() {
      fitCamera(viewDirection());
    },
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      disposeGroup(walls);
      disposeGroup(rooms);
      disposeGroup(windows);
      disposeGroup(doors);
      guide?.geometry.dispose();
      floor.geometry.dispose();
      floorMat.map?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
