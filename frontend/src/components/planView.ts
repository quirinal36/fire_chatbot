/**
 * 도면 탭. 2D 도면 이미지를 받아 브라우저 안에서 벽을 골라내고 3D 로 세운다. 벽을 긋고 지우고,
 * 축척을 맞춰 방 면적을 잰다. 서버로 보내지 않는다.
 * 캔버스가 유지되어야 하므로 panel 은 이 요소를 innerHTML 로 다시 그리지 않고 붙였다 뗀다.
 */
import { esc, must, onAction } from '../lib/dom';
import { fillRect, paintWall, polygonsFromMask, snapToAxis, wallMask, wallOutline, wallSegmentAt, type Pt, type Rect } from '../plan/walls';
import { findRooms, type RoomReport } from '../plan/rooms';
import type { EditHandlers, Viewer } from '../plan/viewer';

/** 분석용 이미지 최대 변 길이(px). 더 크면 줄여서 분석한다 */
const MAX_SIDE = 1600;
/** 축척을 모를 때 벽 두께로 가정하는 값(m) */
const ASSUMED_WALL_M = 0.2;
const UNDO_LIMIT = 20;
const PYEONG = 3.3058;
/** 도면 첨부 버튼이 파일 고르기를 요청할 때 쓰는 이벤트 이름 */
export const PLAN_PICK_EVENT = 'plan:pick';

type Mode = 'view' | 'add' | 'erase' | 'scale';

export interface PlanView {
  readonly el: HTMLElement;
  /** 파일 고르기 창을 연다. 사용자 클릭 안에서만 불러야 한다 */
  pick(): void;
  dispose(): void;
}

const fmtArea = (m2: number): string => `${m2.toFixed(1)}㎡ (${(m2 / PYEONG).toFixed(1)}평)`;

export function createPlanView(): PlanView {
  const el = document.createElement('div');
  el.className = 'plan3d';
  el.innerHTML = `
    <div class="plan3d__bar">
      <label class="btn btn--compact plan3d__upload">
        도면 올리기
        <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" aria-label="도면 이미지 선택">
      </label>
      <span class="plan3d__status" aria-live="polite">벽·출입구·창문만 있는 2D 도면(PNG·JPG)을 올리면 벽을 3D 로 세웁니다.</span>
    </div>
    <div class="plan3d__tools" hidden>
      <div class="plan3d__modes" role="group" aria-label="편집 모드">
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="view" aria-pressed="true">보기</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="add" aria-pressed="false">벽 추가</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="erase" aria-pressed="false">벽 지우기</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="scale" aria-pressed="false">축척</button>
      </div>
      <div class="plan3d__modes">
        <button type="button" class="btn btn--quiet btn--compact" data-action="undo" disabled>되돌리기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="top">위에서 보기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="fit">전체 보기</button>
      </div>
    </div>
    <p class="plan3d__help" hidden></p>
    <div class="plan3d__edit" hidden>
      <label class="plan3d__field plan3d__field--num">
        <span>길이 (m, 비우면 드래그한 만큼)</span>
        <input type="number" data-ctl="length" min="0.1" step="0.1" placeholder="예: 3.5">
      </label>
      <label class="plan3d__field plan3d__field--num">
        <span>벽 두께 (m)</span>
        <input type="number" data-ctl="thickM" min="0.05" step="0.05" value="${ASSUMED_WALL_M}">
      </label>
    </div>
    <form class="plan3d__scale" hidden>
      <label class="plan3d__field plan3d__field--num">
        <span>그은 선의 실제 길이 (m)</span>
        <input type="number" data-ctl="scaleM" min="0.1" step="0.01" required placeholder="예: 4.2">
      </label>
      <button type="submit" class="btn btn--accent btn--compact">적용</button>
    </form>
    <div class="plan3d__stage" data-empty="true">
      <p class="plan3d__hint">이미지를 여기에 끌어다 놓아도 됩니다.<br>도면은 서버로 보내지 않고 이 브라우저 안에서만 처리합니다.</p>
    </div>
    <div class="plan3d__ctl" hidden>
      <label class="plan3d__field">
        <span>벽 높이 <output data-out="height">2.7</output> m</span>
        <input type="range" data-ctl="height" min="0.3" max="4" step="0.1" value="2.7">
      </label>
      <label class="plan3d__field">
        <span>벽 두께 기준 <output data-out="thick">-</output> px</span>
        <input type="range" data-ctl="thick" min="2" max="40" step="1" value="8">
      </label>
      <label class="plan3d__field plan3d__field--check">
        <input type="checkbox" data-ctl="floor" checked>
        <span>바닥에 원본 도면 깔기</span>
      </label>
    </div>
    <div class="plan3d__areas" hidden></div>
    <p class="plan3d__note">두꺼운 검은 선만 벽으로 봅니다. 가구·글자가 벽으로 잡히거나 벽이 빠지면 벽 두께 기준을 조절하세요.
      벽이 끊긴 자리가 출입구·창문입니다. 축척을 맞추기 전에는 벽 두께 ${ASSUMED_WALL_M}m 로 가정합니다.</p>
  `;

  const input = must<HTMLInputElement>('input[type="file"]', el);
  const status = must<HTMLSpanElement>('.plan3d__status', el);
  const tools = must<HTMLDivElement>('.plan3d__tools', el);
  const help = must<HTMLParagraphElement>('.plan3d__help', el);
  const editBox = must<HTMLDivElement>('.plan3d__edit', el);
  const scaleForm = must<HTMLFormElement>('.plan3d__scale', el);
  const stage = must<HTMLDivElement>('.plan3d__stage', el);
  const ctl = must<HTMLDivElement>('.plan3d__ctl', el);
  const areas = must<HTMLDivElement>('.plan3d__areas', el);
  const heightIn = must<HTMLInputElement>('[data-ctl="height"]', el);
  const thickIn = must<HTMLInputElement>('[data-ctl="thick"]', el);
  const floorIn = must<HTMLInputElement>('[data-ctl="floor"]', el);
  const lengthIn = must<HTMLInputElement>('[data-ctl="length"]', el);
  const thickMIn = must<HTMLInputElement>('[data-ctl="thickM"]', el);
  const scaleMIn = must<HTMLInputElement>('[data-ctl="scaleM"]', el);
  const heightOut = must<HTMLOutputElement>('[data-out="height"]', el);
  const thickOut = must<HTMLOutputElement>('[data-out="thick"]', el);
  const undoBtn = must<HTMLButtonElement>('[data-action="undo"]', el);
  const modeBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-action="mode"]'));

  const HELP: Record<Mode, string> = {
    view: '',
    add: '바닥을 끌어 벽을 긋습니다. 수평·수직에 가까우면 축에 붙습니다. 길이를 적어 두면 방향만 긋고 길이는 적은 값을 씁니다.',
    erase: '벽을 클릭하면 교차점 사이 한 구간이 지워지고, 끌어서 사각형을 그리면 그 안의 벽이 모두 지워집니다.',
    scale: '길이를 아는 벽이나 치수선을 따라 선을 그은 뒤 실제 길이를 넣으세요. 이후 길이·면적이 그 축척으로 계산됩니다.',
  };

  let viewer: Viewer | null = null;
  let source: HTMLCanvasElement | null = null;
  let pixels: ImageData | null = null;
  let mask: Uint8Array | null = null;
  let wallPx = 8;
  let userThick: number | null = null;
  let pxPerMeter = wallPx / ASSUMED_WALL_M;
  let scaleFixed = false;
  let mode: Mode = 'view';
  const undo: Uint8Array[] = [];
  let roomsTimer: ReturnType<typeof setTimeout> | null = null;
  let report: RoomReport | null = null;
  let scaleLinePx = 0;

  function say(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.classList.toggle('tone-flag', tone === 'error');
  }

  const W = (): number => pixels?.width ?? 0;
  const H = (): number => pixels?.height ?? 0;
  const thickPx = (): number => Math.max(2, Math.round((Number(thickMIn.value) || ASSUMED_WALL_M) * pxPerMeter));
  const metersOf = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]) / pxPerMeter;

  async function ensureViewer(): Promise<Viewer> {
    if (viewer) return viewer;
    const { createViewer } = await import('../plan/viewer');
    const host = document.createElement('div');
    host.className = 'plan3d__canvas';
    stage.replaceChildren(host);
    stage.dataset['empty'] = 'false';
    viewer = await createViewer(host);
    viewer.setHeight(Number(heightIn.value));
    viewer.setFloorVisible(floorIn.checked);
    return viewer;
  }

  /** 마스크가 바뀐 뒤: 벽을 다시 세우고 방 면적은 잠시 뒤 다시 잰다 */
  function rebuild(): void {
    if (!mask || !viewer) return;
    viewer.setWalls(polygonsFromMask(mask, W(), H()));
    scheduleRooms();
  }

  function scheduleRooms(): void {
    if (roomsTimer) clearTimeout(roomsTimer);
    roomsTimer = setTimeout(measureRooms, 250);
  }

  function measureRooms(): void {
    if (!mask || !viewer) return;
    report = findRooms(mask, W(), H(), pxPerMeter);
    viewer.setRooms(report.rooms);
    renderAreas();
  }

  function renderAreas(): void {
    if (!report) { areas.hidden = true; return; }
    areas.hidden = false;
    const scaleNote = scaleFixed ? '축척 적용됨' : `벽 두께 ${ASSUMED_WALL_M}m 가정. 축척 모드로 실제 길이를 넣으면 정확해집니다`;
    const rows = report.rooms
      .map((r, i) => `<li class="plan3d__room"><span class="plan3d__swatch" style="--hue:${[18, 200, 140, 280, 40, 320, 100, 240, 0, 170, 60, 300][i % 12]}"></span>
        <span>구역 ${r.id}</span><span class="plan3d__room-area">${esc(fmtArea(r.area))}</span></li>`)
      .join('');
    areas.innerHTML = `
      <p class="plan3d__total">바닥 면적 <strong>${esc(fmtArea(report.floorArea))}</strong>
        <span class="plan3d__sub">· 벽 포함 ${esc(fmtArea(report.footprintArea))} · ${esc(scaleNote)}</span></p>
      ${report.rooms.length ? `<ol class="plan3d__rooms">${rows}</ol>` : '<p class="plan3d__sub">닫힌 구역을 찾지 못했습니다. 벽을 그어 방을 닫으면 면적이 나옵니다.</p>'}`;
  }

  function pushUndo(): void {
    if (!mask) return;
    undo.push(mask.slice());
    if (undo.length > UNDO_LIMIT) undo.shift();
    undoBtn.disabled = false;
  }

  function popUndo(): void {
    const prev = undo.pop();
    if (!prev) return;
    mask = prev;
    undoBtn.disabled = undo.length === 0;
    rebuild();
  }

  // ---- 편집 모드
  let dragStart: Pt | null = null;

  /** 벽 끝점: 축에 붙이고, 길이를 적어 두었으면 그 길이로 맞춘다 */
  function addEnd(start: Pt, p: Pt): Pt {
    const snapped = snapToAxis(start, p);
    const wantM = Number(lengthIn.value);
    if (!(wantM > 0)) return snapped;
    const dx = snapped[0] - start[0];
    const dy = snapped[1] - start[1];
    const len = Math.hypot(dx, dy) || 1;
    const px = wantM * pxPerMeter;
    return [start[0] + (dx / len) * px, start[1] + (dy / len) * px];
  }

  const rectOf = (a: Pt, b: Pt): Rect => ({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
  const rectPoly = (r: Rect): Pt[] => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];

  const editHandlers: EditHandlers = {
    start(p) {
      dragStart = p;
    },
    move(p) {
      if (!dragStart || !viewer) return;
      if (mode === 'add') {
        const end = addEnd(dragStart, p);
        viewer.setGuide(wallOutline(dragStart, end, thickPx()), 'add');
        say(`벽 길이 ${metersOf(dragStart, end).toFixed(2)} m`);
      } else if (mode === 'erase') {
        viewer.setGuide(rectPoly(rectOf(dragStart, p)), 'erase');
      } else if (mode === 'scale') {
        viewer.setGuide(wallOutline(dragStart, p, 2 / (pxPerMeter / 30)), 'scale');
        say(`선 길이 ${Math.hypot(p[0] - dragStart[0], p[1] - dragStart[1]).toFixed(0)} px`);
      }
    },
    end(p) {
      if (!dragStart || !mask || !viewer) return;
      const start = dragStart;
      dragStart = null;
      viewer.setGuide(null);
      const moved = Math.hypot(p[0] - start[0], p[1] - start[1]);
      if (mode === 'add') {
        const end = addEnd(start, p);
        if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 2) return;
        pushUndo();
        paintWall(mask, W(), H(), start, end, thickPx());
        say(`벽 ${metersOf(start, end).toFixed(2)} m 를 추가했습니다.`);
        rebuild();
      } else if (mode === 'erase') {
        if (moved < 3) {
          const seg = wallSegmentAt(mask, W(), H(), p, wallPx);
          if (!seg) { say('그 자리에 벽이 없습니다.'); return; }
          pushUndo();
          fillRect(mask, W(), H(), seg, 0);
          say(`벽 한 구간(${((seg.x1 - seg.x0 > seg.y1 - seg.y0 ? seg.x1 - seg.x0 : seg.y1 - seg.y0) / pxPerMeter).toFixed(2)} m)을 지웠습니다.`);
        } else {
          pushUndo();
          fillRect(mask, W(), H(), rectOf(start, p), 0);
          say('사각형 안의 벽을 지웠습니다.');
        }
        rebuild();
      } else if (mode === 'scale') {
        if (moved < 5) return;
        scaleLinePx = moved;
        scaleForm.hidden = false;
        scaleMIn.focus();
        say(`선을 그었습니다 (${moved.toFixed(0)} px). 실제 길이를 넣고 적용하세요.`);
        viewer.setGuide(wallOutline(start, p, 2 / (pxPerMeter / 30)), 'scale');
      }
    },
  };

  function setMode(next: Mode): void {
    const wasView = mode === 'view';
    mode = next;
    dragStart = null;
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset['mode'] === next));
    help.textContent = HELP[next];
    help.hidden = next === 'view';
    editBox.hidden = next !== 'add';
    if (next !== 'scale') { scaleForm.hidden = true; viewer?.setGuide(null); }
    viewer?.setEditing(next === 'view' ? null : editHandlers);
    if (wasView && next !== 'view') viewer?.topView();
  }

  onAction(el, {
    mode: (b) => {
      const m = b.dataset['mode'];
      if (m === 'view' || m === 'add' || m === 'erase' || m === 'scale') setMode(m);
    },
    undo: () => popUndo(),
    top: () => viewer?.topView(),
    fit: () => viewer?.fitView(),
  });

  scaleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = Number(scaleMIn.value);
    if (!(m > 0) || scaleLinePx <= 0) return;
    pxPerMeter = scaleLinePx / m;
    scaleFixed = true;
    scaleForm.hidden = true;
    viewer?.setGuide(null);
    applyScale();
    say(`축척을 맞췄습니다. 1m = ${pxPerMeter.toFixed(1)} px`);
    setMode('view');
  });

  /** 축척이 바뀌면 세계 크기가 바뀌므로 모델을 다시 놓는다 */
  function applyScale(): void {
    if (!viewer || !mask) return;
    viewer.setWalls(polygonsFromMask(mask, W(), H()));
    viewer.setModel(W(), H(), source, pxPerMeter);
    scheduleRooms();
  }

  // ---- 분석
  async function show(): Promise<void> {
    if (!pixels || !source) return;
    const opts = userThick === null ? {} : { wallPx: userThick };
    const result = wallMask(pixels.data, pixels.width, pixels.height, opts);
    mask = result.mask;
    wallPx = result.wallPx;
    undo.length = 0;
    undoBtn.disabled = true;
    if (!scaleFixed) pxPerMeter = wallPx / ASSUMED_WALL_M;
    if (userThick === null) thickIn.value = String(Math.min(40, wallPx));
    thickOut.value = String(wallPx);
    const v = await ensureViewer();
    v.setWalls(polygonsFromMask(mask, W(), H()));
    v.setModel(W(), H(), source, pxPerMeter);
    ctl.hidden = false;
    tools.hidden = false;
    scheduleRooms();
    say('벽을 세웠습니다. 끌어서 돌리고 휠로 확대합니다. 벽 추가·지우기·축척은 위 버튼으로 바꿉니다.');
  }

  async function load(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      say('PNG·JPG·WebP 이미지만 올릴 수 있습니다.', 'error');
      return;
    }
    say(`${file.name} 을 분석하는 중…`);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      source = canvas;
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      userThick = null;
      scaleFixed = false;
      setMode('view');
      await show();
    } catch (err) {
      say(`도면을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void load(file);
    input.value = '';
  });

  stage.addEventListener('dragover', (e) => {
    e.preventDefault();
    stage.classList.add('is-over');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('is-over'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('is-over');
    const file = e.dataTransfer?.files[0];
    if (file) void load(file);
  });

  heightIn.addEventListener('input', () => {
    heightOut.value = heightIn.value;
    viewer?.setHeight(Number(heightIn.value));
  });
  thickIn.addEventListener('change', () => {
    userThick = Number(thickIn.value);
    void show();
  });
  floorIn.addEventListener('change', () => viewer?.setFloorVisible(floorIn.checked));

  const onKey = (e: KeyboardEvent): void => {
    if (mode === 'view' || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    popUndo();
  };
  document.addEventListener('keydown', onKey);

  const onPick = (): void => input.click();
  document.addEventListener(PLAN_PICK_EVENT, onPick);

  return {
    el,
    pick: onPick,
    dispose() {
      document.removeEventListener(PLAN_PICK_EVENT, onPick);
      document.removeEventListener('keydown', onKey);
      if (roomsTimer) clearTimeout(roomsTimer);
      viewer?.dispose();
      viewer = null;
    },
  };
}
