/**
 * 도면 탭. 2D 도면 이미지를 받아 브라우저 안에서 벽을 골라내고 3D 로 세운다.
 * 서버로 보내지 않는다. 캔버스가 유지되어야 하므로 panel 은 이 요소를 innerHTML 로 다시 그리지 않고 붙였다 뗀다.
 */
import { must } from '../lib/dom';
import { extractWalls, type WallModel } from '../plan/walls';
import type { Viewer } from '../plan/viewer';

/** 분석용 이미지 최대 변 길이(px). 더 크면 줄여서 분석한다 */
const MAX_SIDE = 1600;
/** 축척을 모를 때 벽 두께로 가정하는 값(m) */
const ASSUMED_WALL_M = 0.2;
/** 도면 첨부 버튼이 파일 고르기를 요청할 때 쓰는 이벤트 이름 */
export const PLAN_PICK_EVENT = 'plan:pick';

export interface PlanView {
  readonly el: HTMLElement;
  /** 파일 고르기 창을 연다. 사용자 클릭 안에서만 불러야 한다 */
  pick(): void;
  dispose(): void;
}

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
    <p class="plan3d__note">두꺼운 검은 선만 벽으로 봅니다. 가구·글자가 벽으로 잡히거나 벽이 빠지면 벽 두께 기준을 조절하세요.
      벽이 끊긴 자리가 출입구·창문입니다. 축척은 벽 두께 ${ASSUMED_WALL_M}m 로 가정합니다.</p>
  `;

  const input = must<HTMLInputElement>('input[type="file"]', el);
  const status = must<HTMLSpanElement>('.plan3d__status', el);
  const stage = must<HTMLDivElement>('.plan3d__stage', el);
  const ctl = must<HTMLDivElement>('.plan3d__ctl', el);
  const heightIn = must<HTMLInputElement>('[data-ctl="height"]', el);
  const thickIn = must<HTMLInputElement>('[data-ctl="thick"]', el);
  const floorIn = must<HTMLInputElement>('[data-ctl="floor"]', el);
  const heightOut = must<HTMLOutputElement>('[data-out="height"]', el);
  const thickOut = must<HTMLOutputElement>('[data-out="thick"]', el);

  let viewer: Viewer | null = null;
  let source: HTMLCanvasElement | null = null;
  let pixels: ImageData | null = null;
  let userThick: number | null = null;

  function say(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.classList.toggle('tone-flag', tone === 'error');
  }

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

  function analyze(): WallModel | null {
    if (!pixels) return null;
    const opts = userThick === null ? {} : { wallPx: userThick };
    return extractWalls(pixels.data, pixels.width, pixels.height, opts);
  }

  async function show(): Promise<void> {
    const model = analyze();
    if (!model || !source) return;
    if (userThick === null) thickIn.value = String(Math.min(40, model.wallPx));
    thickOut.value = String(model.wallPx);
    const v = await ensureViewer();
    v.setModel(model, source, model.wallPx / ASSUMED_WALL_M);
    ctl.hidden = false;
    const holes = model.polygons.reduce((n, p) => n + p.holes.length, 0);
    say(
      model.polygons.length === 0
        ? '벽을 찾지 못했습니다. 벽 두께 기준을 낮추거나 벽이 진하게 그려진 도면을 써 보세요.'
        : `벽 ${model.polygons.length}덩어리, 닫힌 구역 ${holes}개. 끌어서 돌리고 휠로 확대합니다.`,
    );
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

  const onPick = (): void => input.click();
  document.addEventListener(PLAN_PICK_EVENT, onPick);

  return {
    el,
    pick: onPick,
    dispose() {
      document.removeEventListener(PLAN_PICK_EVENT, onPick);
      viewer?.dispose();
      viewer = null;
    },
  };
}
