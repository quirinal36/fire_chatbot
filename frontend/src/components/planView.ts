/**
 * 도면 탭. 2D 도면 이미지를 받아 브라우저 안에서 벽을 골라내고 3D 로 세운다. 벽을 긋고 지우고,
 * 축척을 맞춰 방 면적을 잰다. 서버로 보내지 않는다.
 * 캔버스가 유지되어야 하므로 panel 은 이 요소를 innerHTML 로 다시 그리지 않고 붙였다 뗀다.
 */
import { esc, must, onAction } from '../lib/dom';
import { createPlan, deletePlan, getPlan, listPlans, readPlanScale, reviewPlan, updatePlan, type PlanReview, type PlanSummary, type ReviewContext, type ScaleStatus } from '../api/plans';
import { cutOpening, DEFAULT_DARK, fillRect, labelComponents, nearestWall, paintWall, pointInPolygon, polygonsFromMask, snapToAxis, wallMask, wallOutline, wallSegmentAt, type Pt, type Rect } from '../plan/walls';
import { findRooms, type Barrier, type RoomReport } from '../plan/rooms';
import { findOpenings, type Opening } from '../plan/openings';
import { decideImport, IMPORT_TARGETS, type AreaChoice } from '../plan/areaImport';
import { describeFailure, failureInput, noScaleFound, type Failure, type RecoveryAction } from '../plan/failure';
import type { EditHandlers, Viewer } from '../plan/viewer';
import type { AppActions } from '../actions';
import type { AppState } from '../types';

/** 분석용 이미지 최대 변 길이(px). 더 크면 줄여서 분석한다 */
const MAX_SIDE = 1600;
/** 축척을 모를 때 벽 두께로 가정하는 값(m) */
const ASSUMED_WALL_M = 0.2;
/** 문 기본 폭(m). 외여닫이문 유효폭 */
const DEFAULT_DOOR_M = 0.9;
const UNDO_LIMIT = 20;
const PYEONG = 3.3058;
/** AI 검토에 보내는 그림의 최대 폭(px)과 격자 열 수 */
const REVIEW_MAX_W = 1024;
/** 축척 읽기용 그림 최대 폭. 치수 글자가 작아 검토용보다 크게 보낸다 */
const SCALE_MAX_W = 1600;
const REVIEW_COLS = 12;
/** 판정 전에는 이 폭(m) 이하의 개구부 후보만 문으로 보고 방을 나눈다. 그보다 넓으면 AI·사용자 판정을 기다린다 */
const DEFAULT_SEAL_M = 1.3;
/** AI 검토에 보내는 개구부 후보 최대 수 (서버 스키마와 같아야 한다) */
const MAX_REVIEW_OPENINGS = 120;
/** AI 가 제안한 빠진 벽은 원본에 어두운 선이 이 비율 이상 보여야 기본으로 고른다 */
const MISSING_EVIDENCE = 0.6;

/** 개구부 후보의 판정. 후보 번호는 마스크가 바뀌면 달라지므로 선분의 양 끝으로 기억한다 */
type OpeningKind = 'door' | 'window' | 'open' | 'not_opening';
interface OpeningJudgment {
  readonly a: Pt;
  readonly b: Pt;
  readonly kind: OpeningKind;
}
/** 되돌리기 한 단계. 벽만 되돌리면 판정·축척과 어긋나므로 함께 담는다 */
interface Snapshot {
  readonly mask: Uint8Array;
  readonly doorRects: Rect[];
  readonly windowRects: Rect[];
  readonly roomNames: Record<number, string>;
  readonly judgments: OpeningJudgment[];
  readonly pxPerMeter: number;
  readonly scaleFixed: boolean;
  readonly scaleStatus: ScaleStatus;
  readonly scaleSource: string | null;
}
/** 도면 첨부 버튼이 파일 고르기를 요청할 때 쓰는 이벤트 이름 */
export const PLAN_PICK_EVENT = 'plan:pick';
/** 도면 탭을 처음 열면 자동으로 올리는 기본 도면. frontend/public/plans/ 에 둔다 */
const DEFAULT_PLAN_URL = '/plans/default.png';

/** 편집 모드. 버튼·도움말·런타임 검사가 모두 이 목록에서 파생된다 */
const MODES = ['view', 'add', 'erase', 'door', 'scale'] as const;
type Mode = (typeof MODES)[number];

export interface PlanView {
  readonly el: HTMLElement;
  /** 파일 고르기 창을 연다. 사용자 클릭 안에서만 불러야 한다 */
  pick(): void;
  /** 탭이 화면에 보일 때 부른다. 아직 도면이 없으면 기본 도면을 올린다 */
  activate(): void;
  /** 로그인 상태가 바뀌면 저장 목록을 다시 읽는다 */
  update(state: AppState): void;
  dispose(): void;
}

const fmtArea = (m2: number, approximate = false): string => `${approximate ? '약 ' : ''}${m2.toFixed(1)}㎡ (${(m2 / PYEONG).toFixed(1)}평)`;

export function createPlanView(actions: AppActions): PlanView {
  const el = document.createElement('div');
  el.className = 'plan3d';
  el.innerHTML = `
    <div class="plan3d__bar">
      <div class="plan3d__file-tools" aria-label="도면 파일과 분석 도구">
        <label class="btn btn--compact plan3d__upload">
          도면 올리기
          <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" aria-label="도면 이미지 선택">
        </label>
        <button type="button" class="btn btn--quiet btn--compact" data-action="default">예시 도면</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="save-open" disabled>저장</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="scale-read" disabled>도면의 치수 자동 읽기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="review" disabled>도면 인식 검토</button>
      </div>
      <p class="plan3d__status" aria-live="polite">벽·출입구·창문만 있는 2D 도면(PNG·JPG)을 올리면 벽을 3D 로 세웁니다.</p>
      <div class="plan3d__recovery" role="group" aria-label="다음에 할 수 있는 일" hidden></div>
    </div>
    <div class="plan3d__journey" hidden aria-label="도면 검토 진행 상태"></div>
    <form class="plan3d__save" hidden>
      <label class="plan3d__field plan3d__field--num plan3d__field--grow">
        <span>도면 이름</span>
        <input type="text" data-ctl="name" maxlength="80" required placeholder="예: 3층 학원">
      </label>
      <button type="submit" class="btn btn--accent btn--compact" data-save="update" hidden>덮어쓰기</button>
      <button type="submit" class="btn btn--accent btn--compact" data-save="create">새로 저장</button>
      <button type="button" class="btn btn--quiet btn--compact" data-action="save-close">닫기</button>
    </form>
    <div class="plan3d__review" hidden></div>
    <div class="plan3d__saved" hidden>
      <label class="plan3d__field plan3d__field--num plan3d__field--grow">
        <span>내 도면</span>
        <select data-ctl="saved"></select>
      </label>
      <button type="button" class="btn btn--compact" data-action="load-saved">불러오기</button>
      <button type="button" class="btn btn--quiet btn--compact" data-action="delete-saved">삭제</button>
    </div>
    <div class="plan3d__tools" hidden>
      <div class="plan3d__modes" role="group" aria-label="편집 모드">
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="view" aria-pressed="true">도면 둘러보기</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="add" aria-pressed="false">벽 추가</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="erase" aria-pressed="false">벽 지우기</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="door" aria-pressed="false">문 추가</button>
        <button type="button" class="btn btn--compact" data-action="mode" data-mode="scale" aria-pressed="false">실제 길이 맞추기</button>
      </div>
      <div class="plan3d__modes">
        <button type="button" class="btn btn--quiet btn--compact is-invisible" data-action="finish-edit">편집 끝내기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="undo" disabled>되돌리기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="top">평면 보기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="fit">3D 보기</button>
      </div>
    </div>
    <div class="plan3d__context" aria-live="polite">
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
      <div class="plan3d__door" hidden>
        <label class="plan3d__field plan3d__field--num">
          <span>문 폭 (m, 끌면 끈 만큼)</span>
          <input type="number" data-ctl="doorM" min="0.3" max="6" step="0.1" value="${DEFAULT_DOOR_M}">
        </label>
      </div>
      <form class="plan3d__scale" hidden>
        <label class="plan3d__field plan3d__field--num">
          <span>그은 선의 실제 길이 (m)</span>
          <input type="number" data-ctl="scaleM" min="0.1" step="0.01" required placeholder="예: 4.2">
        </label>
        <button type="submit" class="btn btn--accent btn--compact">적용</button>
      </form>
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
        <span>원본 도면 표시</span>
      </label>
    </div>
    <div class="plan3d__areas" hidden></div>
    <p class="plan3d__note">두꺼운 검은 선만 벽으로 봅니다. 가구·글자가 벽으로 잡히거나 벽이 빠지면 벽 두께 기준을 조절하세요.
      벽이 끊긴 자리가 출입구·창문입니다. 축척을 맞추기 전에는 벽 두께 ${ASSUMED_WALL_M}m 로 가정합니다.</p>
  `;

  const input = must<HTMLInputElement>('input[type="file"]', el);
  const status = must<HTMLSpanElement>('.plan3d__status', el);
  const recovery = must<HTMLDivElement>('.plan3d__recovery', el);
  const journey = must<HTMLDivElement>('.plan3d__journey', el);
  const tools = must<HTMLDivElement>('.plan3d__tools', el);
  const help = must<HTMLParagraphElement>('.plan3d__help', el);
  const editBox = must<HTMLDivElement>('.plan3d__edit', el);
  const doorBox = must<HTMLDivElement>('.plan3d__door', el);
  const scaleForm = must<HTMLFormElement>('.plan3d__scale', el);
  const stage = must<HTMLDivElement>('.plan3d__stage', el);
  const ctl = must<HTMLDivElement>('.plan3d__ctl', el);
  const areas = must<HTMLDivElement>('.plan3d__areas', el);
  const heightIn = must<HTMLInputElement>('[data-ctl="height"]', el);
  const thickIn = must<HTMLInputElement>('[data-ctl="thick"]', el);
  const floorIn = must<HTMLInputElement>('[data-ctl="floor"]', el);
  const lengthIn = must<HTMLInputElement>('[data-ctl="length"]', el);
  const thickMIn = must<HTMLInputElement>('[data-ctl="thickM"]', el);
  const doorMIn = must<HTMLInputElement>('[data-ctl="doorM"]', el);
  const scaleMIn = must<HTMLInputElement>('[data-ctl="scaleM"]', el);
  const heightOut = must<HTMLOutputElement>('[data-out="height"]', el);
  const thickOut = must<HTMLOutputElement>('[data-out="thick"]', el);
  const undoBtn = must<HTMLButtonElement>('[data-action="undo"]', el);
  const finishEditBtn = must<HTMLButtonElement>('[data-action="finish-edit"]', el);
  const saveBtn = must<HTMLButtonElement>('[data-action="save-open"]', el);
  const reviewBtn = must<HTMLButtonElement>('[data-action="review"]', el);
  const scaleBtn = must<HTMLButtonElement>('[data-action="scale-read"]', el);
  const reviewBox = must<HTMLDivElement>('.plan3d__review', el);
  const saveForm = must<HTMLFormElement>('.plan3d__save', el);
  const nameIn = must<HTMLInputElement>('[data-ctl="name"]', el);
  const updateBtn = must<HTMLButtonElement>('[data-save="update"]', el);
  const createBtn = must<HTMLButtonElement>('[data-save="create"]', el);
  const savedBox = must<HTMLDivElement>('.plan3d__saved', el);
  const savedSel = must<HTMLSelectElement>('[data-ctl="saved"]', el);
  const modeBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-action="mode"]'));

  const HELP: Record<Mode, string> = {
    view: '',
    add: '바닥을 끌어 벽을 긋습니다. 수평·수직에 가까우면 축에 붙습니다. 길이를 적어 두면 방향만 긋고 길이는 적은 값을 씁니다.',
    erase: '벽을 클릭하면 교차점 사이 한 구간이 지워지고, 끌어서 사각형을 그리면 그 안의 벽이 모두 지워집니다.',
    door: '벽을 클릭하면 그 자리에 문 폭만큼 개구부가 뚫립니다. 벽을 따라 끌면 끈 만큼이 폭이 됩니다. 문 위에는 인방이 남아 3D 에서 문으로 보입니다.',
    scale: '길이를 아는 벽이나 치수선을 따라 선을 그은 뒤 실제 길이를 넣으세요. 이후 길이·면적이 그 축척으로 계산됩니다.',
  };

  let viewer: Viewer | null = null;
  let source: HTMLCanvasElement | null = null;
  let sourceName = '';
  let sourceKind: 'sample' | 'upload' | 'saved' | null = null;
  let pixels: ImageData | null = null;
  let mask: Uint8Array | null = null;
  let wallPx = 8;
  /** 이미지에서 스스로 잰 굵은 벽 두께. 축척 가정은 항상 이 값으로 한다 —
   *  두께 슬라이더를 내렸다고 도면이 커지면 안 된다 */
  let autoWallPx = 8;
  /** 얇은 벽(빗금 내벽 등)을 따로 찾았으면 그 두께 */
  let thinPx: number | null = null;
  let userThick: number | null = null;
  let pxPerMeter = autoWallPx / ASSUMED_WALL_M;
  let scaleFixed = false;
  /** 축척의 근거. 상태 메시지는 곧 덮이므로 면적 옆에 남겨 둔다 */
  let scaleSource: string | null = null;
  /** 자동 인식과 사용자의 확인을 구분한다. 면적은 이 값이 확인 전이면 추정으로 표시한다. */
  let scaleStatus: ScaleStatus = 'assumed';
  let mode: Mode = 'view';
  const undo: Snapshot[] = [];
  let roomsTimer: ReturnType<typeof setTimeout> | null = null;
  let report: RoomReport | null = null;
  let highlightedRoom: number | null = null;
  let scaleLinePx = 0;
  /** 계정에 저장된 도면 중 지금 열려 있는 것 */
  let currentPlan: { id: string; name: string } | null = null;
  let userId: string | null = null;
  /** 정식 로그인 상태. 익명 세션은 false — 로그인이 한도를 올려 줄 때만 로그인을 권한다 */
  let signedIn = false;
  let saved: PlanSummary[] = [];
  let busy = false;
  let retrySave: 'create' | 'update' | null = null;
  /** 어두움 기준. AI 가 권하면 바뀐다 */
  let userDark: number | null = null;
  /** 창문으로 판정된 개구부(픽셀 사각형) */
  let windowRects: Rect[] = [];
  /** 문으로 뚫거나 판정된 개구부(픽셀 사각형) */
  let doorRects: Rect[] = [];
  /** 구역 이름 (구역 번호 → 이름) */
  let roomNames: Record<number, string> = {};
  let lastOpenings: Opening[] = [];
  /** 개구부 후보 판정 (AI 제안을 적용했거나 저장본에서 읽은 것) */
  let judgments: OpeningJudgment[] = [];
  let pendingReview: PlanReview | null = null;
  /** 검토 결과가 도착했을 때의 후보 목록과 도면 상태. 적용할 때 같은 상태여야 한다 */
  let pendingOpenings: Opening[] = [];
  let pendingRev = -1;
  /** 벽·축척·판정이 바뀔 때마다 올라간다. 늦게 도착한 AI 제안이 바뀐 도면에 적용되는 것을 막는다 */
  let rev = 0;
  let recognitionConfirmed = false;
  /** 면적 가져오기 상자를 열어 두었는가. 사용자가 열었을 때만 그린다 */
  let importOpen = false;
  /** 가져오기 상자에서 고른 면적·항목·확인 표시. 면적을 다시 잴 때마다 상자를 새로 그리므로 여기에 둔다 */
  let importChoiceId = 'floor';
  let importTargetKey: string = IMPORT_TARGETS[0].key;
  let importAck = false;
  /** 조건 카드가 열려 있고 저장할 수 있는가 */
  let caseReady = false;
  let caseSaving = false;
  /** 조건에 보낸 값. 저장이 끝나면 실제로 들어갔는지 확인해 알린다 */
  let importSent: { key: string; value: number } | null = null;
  /** 도면을 새로 올릴 때마다 올라간다. 늦게 도착한 AI 검토 결과를 버리는 데 쓴다 */
  let planGen = 0;

  /** 저장 중에는 버튼이 눌리지 않게 하고, 서버가 성공을 돌려주기 전에는 저장했다고 하지 않는다 */
  function setSaving(on: boolean): void {
    createBtn.disabled = on;
    updateBtn.disabled = on;
    createBtn.textContent = on ? '저장 중…' : '새로 저장';
    updateBtn.textContent = on ? '저장 중…' : '덮어쓰기';
  }

  function say(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.classList.toggle('tone-flag', tone === 'error');
    recovery.replaceChildren();
    recovery.hidden = true;
  }

  const RECOVERY_LABEL: Record<RecoveryAction, string> = {
    'scale-mode': '직접 길이 입력',
    'scale-retry': '다시 읽기',
    'review-retry': '다시 검토',
    login: '로그인',
    'save-retry': '다시 저장',
  };

  /** 실패 안내와 복구 버튼을 같은 자리에 놓는다. 포커스는 옮기지 않는다 — 하던 일을 끊지 않기 위해서다 */
  function offerRecovery(failure: Failure): void {
    say(failure.message, 'error');
    recovery.innerHTML = failure.actions
      .map((action) => `<button type="button" class="btn btn--quiet btn--compact" data-action="${action}">${RECOVERY_LABEL[action]}</button>`)
      .join('');
    recovery.hidden = failure.actions.length === 0;
  }

  function renderJourney(): void {
    if (!pixels || sourceKind === null) { journey.hidden = true; return; }
    journey.hidden = false;
    const origin = sourceKind === 'sample' ? '예시 도면' : sourceKind === 'saved' ? '저장한 도면' : '내 도면';
    const scaleDone = scaleStatus === 'confirmed';
    journey.innerHTML = `<p class="plan3d__origin"><strong>${esc(origin)}</strong> · ${esc(sourceName)}</p>
      <ol class="plan3d__steps">
        <li class="is-done">1. 도면 준비</li>
        <li class="${scaleDone ? 'is-done' : 'is-current'}">2. ${scaleDone ? '실제 길이 확인됨' : '실제 길이 확인 필요'}${scaleDone ? '' : ' <button type="button" class="link" data-action="scale-mode">실제 길이 맞추기</button>'}</li>
        <li class="${recognitionConfirmed ? 'is-done' : scaleDone ? 'is-current' : ''}">3. ${recognitionConfirmed ? '인식 결과 확인됨' : '인식 결과 확인 필요'}${recognitionConfirmed ? '' : ' <button type="button" class="link" data-action="recognition-confirm">맞아요</button> <button type="button" class="link" data-action="recognition-edit">수정하기</button>'}</li>
        <li class="${recognitionConfirmed && scaleDone ? 'is-current' : ''}">4. 소방시설 검토</li>
      </ol>`;
  }

  const W = (): number => pixels?.width ?? 0;
  const H = (): number => pixels?.height ?? 0;
  const thickPx = (): number => Math.max(2, Math.round((Number(thickMIn.value) || ASSUMED_WALL_M) * pxPerMeter));
  const metersOf = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]) / pxPerMeter;
  const doorPx = (): number => Math.max(2, Math.round((Number(doorMIn.value) || DEFAULT_DOOR_M) * pxPerMeter));

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

  /** 두 후보가 같은 자리인지. 양 끝이 벽 두께 안에서 맞으면 같은 개구부다 */
  function sameOpening(a1: Pt, b1: Pt, a2: Pt, b2: Pt): boolean {
    const tol = Math.max(6, wallPx * 1.5);
    const near = (p: Pt, q: Pt): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
    return (near(a1, a2) && near(b1, b2)) || (near(a1, b2) && near(b1, a2));
  }
  function judgedKind(o: Opening): OpeningKind | null {
    return judgments.find((j) => sameOpening(j.a, j.b, o.a, o.b))?.kind ?? null;
  }
  function setJudgment(o: Opening, kind: OpeningKind): void {
    judgments = judgments.filter((j) => !sameOpening(j.a, j.b, o.a, o.b));
    judgments.push({ a: o.a, b: o.b, kind });
    rev++;
  }
  /** 방 계산에서 막을 선분: 문·창으로 판정된 후보, 판정 전이면 문 폭 이하의 후보 */
  function barriersOf(openings: readonly Opening[]): Barrier[] {
    return openings
      .filter((o) => {
        const k = judgedKind(o);
        return k === null ? o.widthM <= DEFAULT_SEAL_M : k === 'door' || k === 'window';
      })
      .map((o) => ({ a: o.a, b: o.b }));
  }

  function measureRooms(): void {
    if (!mask || !viewer) return;
    lastOpenings = findOpenings(mask, W(), H(), wallPx, pxPerMeter);
    report = findRooms(mask, W(), H(), pxPerMeter, { barriers: barriersOf(lastOpenings) });
    if (!report.rooms.some((room) => room.id === highlightedRoom)) highlightedRoom = null;
    viewer.setRooms(report.rooms, roomNames);
    viewer.setHighlightedRoom(highlightedRoom);
    renderAreas();
  }

  /** 점이 어느 구역 안에 있는지. 구역 다각형의 바깥 테두리 안이고 구멍 밖이면 그 구역이다 */
  function roomAt(p: Pt): number | null {
    for (const room of report?.rooms ?? []) {
      for (const poly of room.polygons) {
        if (pointInPolygon(p, poly.outer) && !poly.holes.some((hole) => pointInPolygon(p, hole))) return room.id;
      }
    }
    return null;
  }

  /**
   * 후보 양쪽의 구역 번호. 선분 가운데에서 직각 방향으로 벽 두께 두 배만큼 떨어진 두 점이 어느 구역인지 본다.
   * AI 에 "구역 2↔3 사이" 로 알려 주면 문인지 트인 곳인지 판단이 쉬워진다. 같은 번호면 지금 나뉘지 않은 것이다.
   */
  function roomsBeside(o: Opening): number[] {
    const mx = (o.a[0] + o.b[0]) / 2;
    const my = (o.a[1] + o.b[1]) / 2;
    const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) || 1;
    const nx = -(o.b[1] - o.a[1]) / len;
    const ny = (o.b[0] - o.a[0]) / len;
    const d = wallPx * 2 + 2;
    const out: number[] = [];
    for (const sign of [1, -1]) {
      const id = roomAt([mx + nx * d * sign, my + ny * d * sign]);
      if (id !== null) out.push(id);
    }
    return out;
  }

  /** AI 가 준 빠진 벽 양 끝을 기존 벽에 붙인다. 너무 짧으면 null */
  function snapMissing(m: { from: { x: number; y: number }; to: { x: number; y: number } }, base: Uint8Array): [Pt, Pt] | null {
    const reach = wallPx * 2;
    const a = nearestWall(base, W(), H(), [m.from.x * W(), m.from.y * H()], reach);
    const b = nearestWall(base, W(), H(), snapToAxis(a, [m.to.x * W(), m.to.y * H()]), reach);
    return Math.hypot(b[0] - a[0], b[1] - a[1]) < 2 ? null : [a, b];
  }

  /**
   * 선분을 따라 원본에 어두운 선이 있는 비율. 시각 모델은 없는 벽을 지어내기도 하므로(없는 대상 거부율이
   * 거의 0 인 벤치마크가 있다) 원본 증거가 없는 제안은 기본으로 고르지 않는다. 선 근처 ±3px 를 본다.
   */
  function darkEvidence(a: Pt, b: Pt): number {
    if (!pixels) return 0;
    const dark = userDark ?? DEFAULT_DARK;
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])));
    const len = n || 1;
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    let hit = 0;
    for (let i = 0; i <= n; i++) {
      const cx = a[0] + ((b[0] - a[0]) * i) / n;
      const cy = a[1] + ((b[1] - a[1]) * i) / n;
      let found = false;
      for (let k = -3; k <= 3 && !found; k++) {
        const x = Math.round(cx + nx * k);
        const y = Math.round(cy + ny * k);
        if (x < 0 || y < 0 || x >= W() || y >= H()) continue;
        const p = (y * W() + x) * 4;
        const lum = (299 * (pixels.data[p] ?? 255) + 587 * (pixels.data[p + 1] ?? 255) + 114 * (pixels.data[p + 2] ?? 255)) / 1000;
        if (lum < dark) found = true;
      }
      if (found) hit++;
    }
    return hit / (n + 1);
  }

  function renderAreas(): void {
    if (!report) { areas.hidden = true; return; }
    areas.hidden = false;
    const approximate = scaleStatus !== 'confirmed';
    const scale = {
      assumed: {
        label: '임시 추정 · 실제 길이 미설정',
        detail: `벽 두께 ${ASSUMED_WALL_M}m 가정`,
        action: '실제 길이 맞추기',
      },
      estimated: {
        label: '추정 · 표준 치수 기준',
        detail: scaleSource ?? '표준 치수로 어림',
        action: '실제 길이 맞추기',
      },
      auto: {
        label: '자동 인식 · 확인 필요',
        detail: scaleSource ?? '도면의 치수를 읽음',
        action: '읽은 치수 확인',
      },
      confirmed: {
        label: '사용자 확인 · 입력 치수 기준',
        detail: scaleSource ?? '직접 입력',
        action: '기준 길이 수정',
      },
    }[scaleStatus];
    const rows = report.rooms
      .map((r, i) => `<li><button type="button" class="plan3d__room" data-action="room-select" data-room="${r.id}" aria-pressed="${highlightedRoom === r.id}"><span class="plan3d__swatch" style="--hue:${[18, 200, 140, 280, 40, 320, 100, 240, 0, 170, 60, 300][i % 12]}"></span>
        <span>${esc(roomNames[r.id] ?? `구역 ${r.id}`)}</span><span class="plan3d__room-area">${esc(fmtArea(r.area, approximate))}</span></button></li>`)
      .join('');
    areas.innerHTML = `
      <p class="plan3d__total">바닥 면적 <strong>${esc(fmtArea(report.floorArea, approximate))}</strong>
        <span class="plan3d__sub">· 벽 포함 ${esc(fmtArea(report.footprintArea, approximate))}</span></p>
      <p class="plan3d__scale-state"><strong>${esc(scale.label)}</strong> · ${esc(scale.detail)} · 1m = ${pxPerMeter.toFixed(1)}px
        ${scaleStatus === 'auto'
          ? '<button type="button" class="link" data-action="scale-confirm">읽은 치수 확인</button>'
          : `<button type="button" class="link" data-action="scale-mode">${esc(scale.action)}</button>`}</p>
      ${report.rooms.length ? `<ol class="plan3d__rooms">${rows}</ol>` : '<p class="plan3d__sub">닫힌 구역을 찾지 못했습니다. 벽을 그어 방을 닫으면 면적이 나옵니다.</p>'}
      ${renderImport(`${scale.label} · ${scale.detail}`)}`;
    renderJourney();
  }

  /** 조건으로 가져갈 수 있는 면적 목록. 전체 바닥 면적과 구역 하나하나 */
  function areaChoices(): AreaChoice[] {
    if (!report) return [];
    return [
      { id: 'floor', label: '전체 바닥 면적', areaM2: report.floorArea },
      ...report.rooms.map((r) => ({ id: `room:${r.id}`, label: roomNames[r.id] ?? `구역 ${r.id}`, areaM2: r.area })),
    ];
  }

  /**
   * 면적을 영업장 조건으로 가져오는 상자. 값·출처·추정 여부·넣을 항목을 보여 주고 따로 확인을 받는다.
   * 저절로 들어가면 계산값이 확인된 조건으로 둔갑하므로 누르기 전에는 아무것도 바꾸지 않는다.
   */
  function renderImport(origin: string): string {
    if (!importOpen) {
      return `<p class="plan3d__import-open"><button type="button" class="btn btn--quiet btn--compact" data-action="area-import-open">영업장 조건에 면적 넣기</button>
        <span class="plan3d__sub">도면 면적은 확인 없이 조건에 반영되지 않습니다.</span></p>`;
    }
    const choices = areaChoices();
    const choice = choices.find((c) => c.id === importChoiceId) ?? choices[0] ?? null;
    if (choice) importChoiceId = choice.id;
    const decision = decideImport(
      { choice, targetKey: importTargetKey, scaleStatus, caseReady, acknowledged: importAck },
      scaleSource,
    );
    const target = IMPORT_TARGETS.find((t) => t.key === importTargetKey) ?? IMPORT_TARGETS[0];
    const blocked = decision.ok ? null : decision;
    const fix =
      blocked?.block === 'scale-unconfirmed'
        ? ' <button type="button" class="link" data-action="scale-mode">실제 길이 맞추기</button>'
        : blocked?.block === 'no-case'
          ? ' <button type="button" class="link" data-action="open-case">조건 입력 시작하기</button>'
          : '';
    return `<form class="plan3d__import">
      <p class="plan3d__import-title">영업장 조건에 면적 넣기</p>
      <label class="plan3d__field plan3d__field--num">
        <span>가져올 면적</span>
        <select data-ctl="import-choice">
          ${choices.map((c) => `<option value="${esc(c.id)}" ${c.id === importChoiceId ? 'selected' : ''}>${esc(c.label)} · ${esc(fmtArea(c.areaM2, scaleStatus !== 'confirmed'))}</option>`).join('')}
        </select>
      </label>
      <label class="plan3d__field plan3d__field--num">
        <span>넣을 조건 항목</span>
        <select data-ctl="import-target">
          ${IMPORT_TARGETS.map((t) => `<option value="${t.key}" ${t.key === importTargetKey ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
        </select>
      </label>
      <p class="plan3d__sub">넣을 값 <strong>${choice ? esc(fmtArea(choice.areaM2, scaleStatus !== 'confirmed')) : '-'}</strong> · 출처 ${esc(origin)}</p>
      <p class="plan3d__sub">${esc(target.hint)} 건물 연면적처럼 건축물대장에서 확인하는 항목에는 도면 면적을 넣지 않습니다.</p>
      <label class="plan3d__field plan3d__field--check">
        <input type="checkbox" data-ctl="import-ack" ${importAck ? 'checked' : ''}>
        <span>인식한 벽과 구역으로 계산한 값이며 실측·공식 면적이 아님을 확인했습니다.</span>
      </label>
      ${blocked ? `<p class="plan3d__sub tone-flag" role="status">${esc(blocked.message)}${fix}</p>` : ''}
      <p class="plan3d__import-actions">
        <button type="submit" class="btn btn--accent btn--compact" ${decision.ok && !caseSaving ? '' : 'disabled'}>${caseSaving ? '저장 중…' : '조건에 넣기'}</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="area-import-close">닫기</button>
      </p>
    </form>`;
  }

  /** 가져오기 상자의 고른 값은 다시 그릴 때 살아 있어야 한다 */
  areas.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) && !(t instanceof HTMLInputElement)) return;
    const ctl = t.dataset['ctl'];
    if (ctl === 'import-choice' && t instanceof HTMLSelectElement) importChoiceId = t.value;
    else if (ctl === 'import-target' && t instanceof HTMLSelectElement) importTargetKey = t.value;
    else if (ctl === 'import-ack' && t instanceof HTMLInputElement) importAck = t.checked;
    else return;
    renderAreas();
  });

  areas.addEventListener('submit', (e) => {
    if (!(e.target instanceof HTMLFormElement) || !e.target.classList.contains('plan3d__import')) return;
    e.preventDefault();
    applyImport();
  });

  function applyImport(): void {
    const choice = areaChoices().find((c) => c.id === importChoiceId) ?? null;
    const decision = decideImport(
      { choice, targetKey: importTargetKey, scaleStatus, caseReady, acknowledged: importAck },
      scaleSource,
    );
    if (!decision.ok) { say(decision.message, 'error'); return; }
    importSent = { key: decision.key, value: decision.value };
    caseSaving = true;
    actions.saveCaseFields({ [decision.key]: { value: decision.value, state: 'user_confirmed', note: decision.note } });
    say(`${IMPORT_TARGETS.find((t) => t.key === decision.key)?.label}에 ${decision.value}㎡ 를 넣는 중…`);
    renderAreas();
  }

  function snapshot(): Snapshot | null {
    if (!mask) return null;
    return { mask: mask.slice(), doorRects: [...doorRects], windowRects: [...windowRects], roomNames: { ...roomNames }, judgments: [...judgments], pxPerMeter, scaleFixed, scaleStatus, scaleSource };
  }

  /** 편집·판정·축척을 바꾸기 전에 부른다. 벽뿐 아니라 판정·축척도 함께 되돌린다 */
  function pushUndo(): void {
    const s = snapshot();
    if (!s) return;
    undo.push(s);
    if (undo.length > UNDO_LIMIT) undo.shift();
    undoBtn.disabled = false;
    rev++;
  }

  function popUndo(): void {
    const prev = undo.pop();
    if (!prev) return;
    mask = prev.mask;
    undoBtn.disabled = undo.length === 0;
    // 되돌린 마스크에 벽이 다시 생긴 자리는 더 이상 문이 아니다
    doorRects = prev.doorRects.filter((r) => !wallFills(prev.mask, r));
    windowRects = prev.windowRects;
    roomNames = prev.roomNames;
    judgments = prev.judgments;
    const scaleChanged = prev.pxPerMeter !== pxPerMeter;
    pxPerMeter = prev.pxPerMeter;
    scaleFixed = prev.scaleFixed;
    scaleStatus = prev.scaleStatus;
    scaleSource = prev.scaleSource;
    viewer?.setDoors(doorRects);
    viewer?.setWindows(windowRects);
    rev++;
    if (scaleChanged) applyScale();
    else rebuild();
  }

  /** 사각형 안이 벽으로 거의 채워져 있으면 true. 되돌리기로 문이 메워졌는지 본다 */
  function wallFills(m: Uint8Array, r: Rect): boolean {
    const x0 = Math.max(0, Math.floor(r.x0));
    const y0 = Math.max(0, Math.floor(r.y0));
    const x1 = Math.min(W(), Math.ceil(r.x1));
    const y1 = Math.min(H(), Math.ceil(r.y1));
    let total = 0;
    let filled = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        total++;
        if (m[y * W() + x]) filled++;
      }
    }
    return total > 0 && filled > total * 0.6;
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
      } else if (mode === 'door') {
        const cut = cutOpening(mask as Uint8Array, W(), H(), dragStart, p, wallPx, doorPx());
        viewer.setGuide(cut ? rectPoly(cut.rect) : null, 'erase');
        say(cut ? `문 폭 ${(cut.widthPx / pxPerMeter).toFixed(2)} m` : '벽 위에서 시작하세요.');
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
      } else if (mode === 'door') {
        const cut = cutOpening(mask, W(), H(), start, moved >= 3 ? p : null, wallPx, doorPx());
        if (!cut) { say('그 자리에 벽이 없습니다. 벽 위에서 시작하세요.', 'error'); return; }
        pushUndo();
        fillRect(mask, W(), H(), cut.rect, 0);
        doorRects.push(cut.rect);
        viewer.setDoors(doorRects);
        say(`문 ${(cut.widthPx / pxPerMeter).toFixed(2)} m 를 냈습니다.`);
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
    doorBox.hidden = next !== 'door';
    // 버튼을 아예 감추면 도구 줄이 다시 감겨 캔버스가 위아래로 움직인다. 자리는 지키고 보이지만 않게 한다
    finishEditBtn.classList.toggle('is-invisible', next === 'view');
    if (next !== 'scale') { scaleForm.hidden = true; viewer?.setGuide(null); }
    viewer?.setEditing(next === 'view' ? null : editHandlers);
    if (wasView && next !== 'view') viewer?.topView();
  }

  onAction(el, {
    mode: (b) => {
      const m = b.dataset['mode'];
      const hit = MODES.find((x) => x === m);
      if (hit) setMode(hit);
    },
    undo: () => popUndo(),
    'finish-edit': () => setMode('view'),
    default: () => void loadDefault(true),
    'save-open': () => {
      if (!mask) return;
      if (!userId) { actions.openLogin(); return; }
      nameIn.value = currentPlan?.name ?? nameIn.value;
      updateBtn.hidden = currentPlan === null;
      saveForm.hidden = false;
      nameIn.focus();
    },
    'save-close': () => { saveForm.hidden = true; },
    'load-saved': () => { if (savedSel.value) void openSaved(savedSel.value); },
    review: () => void runReview(),
    'scale-read': () => void runScaleRead(),
    'scale-mode': () => setMode('scale'),
    'scale-retry': () => void runScaleRead(),
    'review-retry': () => void runReview(),
    login: () => actions.openLogin(),
    'save-retry': () => { if (retrySave) void save(retrySave); },
    'scale-confirm': () => {
      if (scaleStatus !== 'auto') return;
      scaleStatus = 'confirmed';
      renderAreas();
      say('자동으로 읽은 치수를 확인했습니다. 기준 길이는 언제든 수정할 수 있습니다.');
    },
    'recognition-confirm': () => {
      recognitionConfirmed = true;
      renderJourney();
      say('도면 인식 결과를 확인했습니다. 벽이나 문을 바꾸면 다시 확인해 주세요.');
    },
    'recognition-edit': () => {
      setMode('add');
      say('수정할 도구를 선택한 뒤 도면에서 편집하세요.');
    },
    'room-select': (b) => {
      const id = Number(b.dataset['room']);
      highlightedRoom = highlightedRoom === id ? null : id;
      viewer?.setHighlightedRoom(highlightedRoom);
      renderAreas();
    },
    'area-import-open': () => { importOpen = true; renderAreas(); },
    'area-import-close': () => { importOpen = false; renderAreas(); },
    'open-case': () => actions.startCase(),
    'review-apply': () => applyReview(),
    'review-close': () => { pendingReview = null; reviewBox.hidden = true; },
    'delete-saved': () => { if (savedSel.value) void removeSaved(savedSel.value); },
    top: () => viewer?.topView(),
    fit: () => viewer?.fitView(),
  });

  scaleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const m = Number(scaleMIn.value);
    if (!(m > 0) || scaleLinePx <= 0) {
      scaleMIn.setCustomValidity('0보다 큰 실제 길이를 입력해 주세요.');
      scaleMIn.reportValidity();
      say('실제 길이를 0보다 큰 값으로 입력해 주세요.', 'error');
      return;
    }
    scaleMIn.setCustomValidity('');
    pushUndo();
    pxPerMeter = scaleLinePx / m;
    scaleFixed = true;
    scaleSource = '직접 지정';
    scaleStatus = 'confirmed';
    scaleForm.hidden = true;
    viewer?.setGuide(null);
    applyScale();
    say(`축척을 맞췄습니다. 1m = ${pxPerMeter.toFixed(1)} px`);
    setMode('view');
    renderJourney();
  });

  /** 축척이 바뀌면 세계 크기가 바뀌므로 모델을 다시 놓는다 */
  function applyScale(): void {
    if (!viewer || !mask) return;
    rev++;
    viewer.setWalls(polygonsFromMask(mask, W(), H()));
    viewer.setModel(W(), H(), source, pxPerMeter);
    scheduleRooms();
  }

  // ---- 분석
  async function show(): Promise<void> {
    if (!pixels || !source) return;
    const result = wallMask(pixels.data, pixels.width, pixels.height, {
      ...(userThick === null ? {} : { wallPx: userThick }),
      ...(userDark === null ? {} : { dark: userDark }),
    });
    mask = result.mask;
    wallPx = result.wallPx;
    thinPx = result.thinPx;
    if (userThick === null) autoWallPx = result.wallPx;
    undo.length = 0;
    undoBtn.disabled = true;
    judgments = [];
    lastOpenings = [];
    rev++;
    if (!scaleFixed) pxPerMeter = autoWallPx / ASSUMED_WALL_M;
    if (!scaleFixed) scaleStatus = 'assumed';
    if (userThick === null) thickIn.value = String(Math.min(40, wallPx));
    thickOut.value = String(wallPx);
    const v = await ensureViewer();
    v.setWalls(polygonsFromMask(mask, W(), H()));
    v.setModel(W(), H(), source, pxPerMeter);
    v.topView();
    windowRects = [];
    doorRects = [];
    roomNames = {};
    recognitionConfirmed = false;
    v.setWindows([]);
    v.setDoors([]);
    // 마스크가 바뀌었으니 지난 검토 제안과 방 목록은 버린다.
    // report 를 비워 두면 뒤따르는 AI 검토가 새 방 목록을 즉시 계산한다
    pendingReview = null;
    reviewBox.hidden = true;
    report = null;
    highlightedRoom = null;
    ctl.hidden = false;
    tools.hidden = false;
    saveBtn.disabled = false;
    reviewBtn.disabled = false;
    scaleBtn.disabled = false;
    scheduleRooms();
    const twoScale = thinPx === null ? '' : ` 벽이 두 가지로 그려져 있어 얇은 쪽(${thinPx}px)까지 잡았습니다.`;
    say(`벽을 세웠습니다.${twoScale} 끌어서 돌리고 휠로 확대합니다. 벽 추가·지우기·축척은 위 버튼으로 바꿉니다.`);
  }

  /** autoReview 면 벽을 세운 뒤 AI 검토를 한 번 자동으로 돌린다 */
  async function load(file: File, autoReview = false): Promise<void> {
    if (!file.type.startsWith('image/')) {
      say('PNG·JPG·WebP 이미지만 올릴 수 있습니다.', 'error');
      return;
    }
    planGen++;
    const gen = planGen;
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
      userDark = null;
      scaleFixed = false;
      scaleSource = null;
      scaleStatus = 'assumed';
      sourceName = file.name;
      sourceKind = file.name === 'default.png' ? 'sample' : 'upload';
      currentPlan = null;
      setMode('view');
      await show();
      // 도면을 먼저 화면에 띄우고, AI 는 그다음에 돌린다. 기다리며 빈 화면을 보여 주지 않는다.
      // 축척을 먼저 맞춰야 검토가 맞는 면적·개구부 폭을 보고 판단한다
      if (autoReview) {
        void (async () => {
          await runScaleRead({ auto: true });
          if (gen === planGen) await runReview({ auto: true });
        })();
      }
    } catch (err) {
      say(`도면을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  // ---- 계정에 저장
  function maskPng(): Promise<Blob> {
    const c = document.createElement('canvas');
    c.width = W();
    c.height = H();
    const ctx = c.getContext('2d');
    if (!ctx || !mask) return Promise.reject(new Error('마스크가 없습니다'));
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const v = mask[i] ? 0 : 255; // 벽은 검정
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return toBlob(c, 'image/png');
  }

  function toBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다'))), type, quality));
  }

  async function payload(name: string) {
    if (!source || !mask) throw new Error('저장할 도면이 없습니다');
    const [image, maskBlob] = await Promise.all([toBlob(source, 'image/jpeg', 0.85), maskPng()]);
    const annotations = JSON.stringify({ v: 1, judgments, doorRects, windowRects, roomNames });
    return { name, width: W(), height: H(), wallPx, pxPerMeter, scaleFixed, scaleStatus, wallHeightM: Number(heightIn.value), annotations, image, mask: maskBlob };
  }

  /** 저장본의 판정·문·창·이름. 형식이 어긋난 항목은 그 항목만 비운다 (구버전 저장본은 null) */
  function readAnnotations(raw: unknown): { judgments: OpeningJudgment[]; doorRects: Rect[]; windowRects: Rect[]; roomNames: Record<number, string> } {
    const out = { judgments: [] as OpeningJudgment[], doorRects: [] as Rect[], windowRects: [] as Rect[], roomNames: {} as Record<number, string> };
    if (!raw || typeof raw !== 'object') return out;
    const o = raw as Record<string, unknown>;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const pt = (v: unknown): Pt | null => (Array.isArray(v) && num(v[0]) && num(v[1]) ? [v[0], v[1]] : null);
    const rect = (v: unknown): Rect | null => {
      if (!v || typeof v !== 'object') return null;
      const r = v as Record<string, unknown>;
      const x0 = r['x0'];
      const y0 = r['y0'];
      const x1 = r['x1'];
      const y1 = r['y1'];
      return num(x0) && num(y0) && num(x1) && num(y1) ? { x0, y0, x1, y1 } : null;
    };
    const KINDS: readonly OpeningKind[] = ['door', 'window', 'open', 'not_opening'];
    if (Array.isArray(o['judgments'])) {
      for (const j of o['judgments'] as unknown[]) {
        if (!j || typeof j !== 'object') continue;
        const r = j as Record<string, unknown>;
        const a = pt(r['a']);
        const b = pt(r['b']);
        const kind = KINDS.find((k) => k === r['kind']);
        if (a && b && kind) out.judgments.push({ a, b, kind });
      }
    }
    for (const key of ['doorRects', 'windowRects'] as const) {
      if (!Array.isArray(o[key])) continue;
      for (const v of o[key] as unknown[]) {
        const r = rect(v);
        if (r) out[key].push(r);
      }
    }
    const names = o['roomNames'];
    if (names && typeof names === 'object') {
      for (const [k, v] of Object.entries(names as Record<string, unknown>)) if (typeof v === 'string' && /^\d+$/.test(k)) out.roomNames[Number(k)] = v.slice(0, 40);
    }
    return out;
  }

  async function save(mode: 'create' | 'update'): Promise<void> {
    const name = nameIn.value.trim();
    if (!name || busy) return;
    busy = true;
    setSaving(true);
    say(`“${name}” 으로 저장하는 중…`);
    try {
      const body = await payload(name);
      const detail = mode === 'update' && currentPlan ? await updatePlan(currentPlan.id, body) : await createPlan(body);
      currentPlan = { id: detail.id, name: detail.name };
      saveForm.hidden = true;
      await refreshSaved();
      savedSel.value = detail.id;
      retrySave = null;
      say(`"${detail.name}" 으로 저장했습니다.`);
    } catch (err) {
      console.warn('[plan] 도면 저장 실패', err);
      retrySave = mode;
      offerRecovery(describeFailure('save', failureInput(err), signedIn));
    } finally {
      busy = false;
      setSaving(false);
    }
  }

  async function refreshSaved(): Promise<void> {
    if (!userId) { saved = []; renderSaved(); return; }
    try {
      saved = await listPlans();
    } catch {
      saved = [];
    }
    renderSaved();
  }

  function renderSaved(): void {
    savedBox.hidden = saved.length === 0;
    const keep = savedSel.value;
    savedSel.innerHTML = saved
      .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.updatedAt.slice(0, 10))}</option>`)
      .join('');
    if (saved.some((p) => p.id === keep)) savedSel.value = keep;
  }

  async function loadImage(url: string): Promise<HTMLCanvasElement> {
    const blob = await (await fetch(url)).blob();
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return c;
  }

  async function openSaved(id: string): Promise<void> {
    if (busy) return;
    planGen++;
    busy = true;
    say('저장한 도면을 불러오는 중…');
    try {
      const d = await getPlan(id);
      const [img, mk] = await Promise.all([loadImage(d.imageUrl), loadImage(d.maskUrl)]);
      if (mk.width !== d.width || mk.height !== d.height) throw new Error('저장된 도면 크기가 맞지 않습니다');
      const ctx = img.getContext('2d', { willReadFrequently: true });
      const mctx = mk.getContext('2d', { willReadFrequently: true });
      if (!ctx || !mctx) throw new Error('캔버스를 만들 수 없습니다');
      source = img;
      pixels = ctx.getImageData(0, 0, img.width, img.height);
      const md = mctx.getImageData(0, 0, mk.width, mk.height).data;
      const next = new Uint8Array(mk.width * mk.height);
      for (let i = 0, p = 0; i < next.length; i++, p += 4) next[i] = (md[p] ?? 255) < 128 ? 1 : 0;
      mask = next;
      wallPx = d.wallPx;
      autoWallPx = d.wallPx;
      userThick = d.wallPx;
      pxPerMeter = d.pxPerMeter;
      scaleFixed = d.scaleFixed;
      scaleStatus = d.scaleStatus;
      scaleSource = d.scaleStatus === 'confirmed' ? '저장된 입력값' : d.scaleStatus === 'auto' ? '저장된 자동 인식값' : d.scaleStatus === 'estimated' ? '저장된 표준 치수 어림' : null;
      heightIn.value = String(d.wallHeightM);
      heightOut.value = heightIn.value;
      thickIn.value = String(Math.min(40, wallPx));
      thickOut.value = String(wallPx);
      undo.length = 0;
      undoBtn.disabled = true;
      rev++;
      const ann = readAnnotations(d.annotations);
      judgments = ann.judgments;
      currentPlan = { id: d.id, name: d.name };
      sourceName = d.name;
      sourceKind = 'saved';
      recognitionConfirmed = false;
      highlightedRoom = null;
      defaultTried = true;
      setMode('view');
      const v = await ensureViewer();
      v.setHeight(d.wallHeightM);
      v.setWalls(polygonsFromMask(mask, W(), H()));
      v.setModel(W(), H(), source, pxPerMeter);
      v.topView();
      windowRects = ann.windowRects;
      doorRects = ann.doorRects;
      roomNames = ann.roomNames;
      v.setWindows(windowRects);
      v.setDoors(doorRects);
      ctl.hidden = false;
      tools.hidden = false;
      saveBtn.disabled = false;
      reviewBtn.disabled = false;
      scaleBtn.disabled = false;
      scheduleRooms();
      say(`"${d.name}" 을 불러왔습니다.`);
    } catch (err) {
      say(`불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      busy = false;
    }
  }

  async function removeSaved(id: string): Promise<void> {
    const target = saved.find((p) => p.id === id);
    if (!target || busy) return;
    if (!window.confirm(`"${target.name}" 도면을 지울까요? 되돌릴 수 없습니다.`)) return;
    busy = true;
    try {
      await deletePlan(id);
      if (currentPlan?.id === id) currentPlan = null;
      await refreshSaved();
      say(`"${target.name}" 을 지웠습니다.`);
    } catch (err) {
      say(`지우지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      busy = false;
    }
  }

  saveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const submitter = (e as SubmitEvent).submitter;
    void save(submitter instanceof HTMLButtonElement && submitter.dataset['save'] === 'update' ? 'update' : 'create');
  });

  // ---- AI 검토 (Gemini, OpenRouter). 알고리즘 결과를 그림으로 보여 주고 고칠 곳을 받아, 수정은 여기서 한다
  const colLetter = (c: number): string => String.fromCharCode(65 + c);
  function gridOf(): { cols: number; rows: number; cw: number; ch: number } {
    const cols = REVIEW_COLS;
    const rows = Math.max(2, Math.round((cols * H()) / W()));
    return { cols, rows, cw: W() / cols, ch: H() / rows };
  }
  function cellOf(p: Pt): string {
    const g = gridOf();
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor(p[0] / g.cw)));
    const r = Math.min(g.rows - 1, Math.max(0, Math.floor(p[1] / g.ch)));
    return `${colLetter(c)}${r + 1}`;
  }
  function rectOfCell(cell: string): Rect | null {
    const m = /^([A-Z])(\d{1,2})$/.exec(cell.trim().toUpperCase());
    if (!m) return null;
    const g = gridOf();
    const c = (m[1] as string).charCodeAt(0) - 65;
    const r = Number(m[2]) - 1;
    if (c < 0 || c >= g.cols || r < 0 || r >= g.rows) return null;
    return { x0: c * g.cw, y0: r * g.ch, x1: (c + 1) * g.cw, y1: (r + 1) * g.ch };
  }

  /** 원본 + 빨간 벽 + 격자 + 파란 개구부 번호 + 초록 구역 번호 */
  function buildOverlay(openings: readonly Opening[]): { canvas: HTMLCanvasElement; scale: number } {
    if (!source || !mask) throw new Error('도면이 없습니다');
    const scale = Math.min(1, REVIEW_MAX_W / W());
    const c = document.createElement('canvas');
    c.width = Math.round(W() * scale);
    c.height = Math.round(H() * scale);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('캔버스를 만들 수 없습니다');
    ctx.drawImage(source, 0, 0, c.width, c.height);
    // 벽 마스크를 빨강 반투명으로
    const layer = document.createElement('canvas');
    layer.width = W();
    layer.height = H();
    const lctx = layer.getContext('2d');
    if (!lctx) throw new Error('캔버스를 만들 수 없습니다');
    const img = lctx.createImageData(W(), H());
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      if (!mask[i]) continue;
      img.data[p] = 220;
      img.data[p + 1] = 30;
      img.data[p + 2] = 30;
      img.data[p + 3] = 150;
    }
    lctx.putImageData(img, 0, 0);
    ctx.drawImage(layer, 0, 0, c.width, c.height);
    // 격자
    const g = gridOf();
    ctx.strokeStyle = 'rgba(60,60,60,0.45)';
    ctx.lineWidth = 1;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    for (let col = 0; col < g.cols; col++) {
      for (let row = 0; row < g.rows; row++) {
        const x = col * g.cw * scale;
        const y = row * g.ch * scale;
        ctx.strokeRect(x, y, g.cw * scale, g.ch * scale);
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(x + 1, y + 1, 22, 13);
        ctx.fillStyle = '#333';
        ctx.fillText(`${colLetter(col)}${row + 1}`, x + 3, y + 2);
      }
    }
    // 개구부: 파랑
    ctx.lineWidth = 2;
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const o of openings) {
      // 후보를 선분으로 그린다. 사각형이 아니라 선분이어야 사선(모서리 문)도 제 자리에 보인다
      ctx.strokeStyle = '#1d5fd6';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(o.a[0] * scale, o.a[1] * scale);
      ctx.lineTo(o.b[0] * scale, o.b[1] * scale);
      ctx.stroke();
      const cx = ((o.a[0] + o.b[0]) / 2) * scale + (o.axis === 'v' ? 14 : 0);
      const cy = ((o.a[1] + o.b[1]) / 2) * scale + (o.axis === 'h' ? 14 : 0);
      ctx.fillStyle = '#1d5fd6';
      ctx.fillRect(cx - 10, cy - 8, 20, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(o.id), cx, cy);
    }
    // 구역: 초록
    for (const room of report?.rooms ?? []) {
      const cx = room.center[0] * scale;
      const cy = room.center[1] * scale;
      ctx.fillStyle = '#1f8a4c';
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(String(room.id), cx, cy);
    }
    return { canvas: c, scale };
  }

  /**
   * 치수선을 읽어 축척을 정한다. 벽 두께 가정보다 훨씬 정확하고, 면적은 축척의 제곱으로 움직이므로
   * 이것이 맞아야 나머지 수치가 쓸모 있다. 읽지 못하면 가정을 그대로 두고 조용히 넘어간다.
   */
  async function runScaleRead(opts: { auto?: boolean } = {}): Promise<void> {
    if (!source || !pixels || busy) return;
    const gen = planGen;
    busy = true;
    scaleBtn.disabled = true;
    if (!opts.auto) say('치수선을 읽는 중… (수십 초)');
    try {
      // 치수 글자는 작다. 검토용 그림(1024px)보다 크게, 겹쳐 그린 것 없이 원본 그대로 보낸다
      const scale = Math.min(1, SCALE_MAX_W / W());
      const c = document.createElement('canvas');
      c.width = Math.round(W() * scale);
      c.height = Math.round(H() * scale);
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, c.width, c.height);
      const res = await readPlanScale(await toBlob(c, 'image/jpeg', 0.9), c.width, c.height);
      if (gen !== planGen) return; // 읽는 사이에 다른 도면을 올렸다
      if (!res.estimate && !res.guess) {
        // 자동 호출은 조용히 넘어가지만, 왜 못 읽었는지는 남겨야 원인을 찾을 수 있다
        console.warn('[plan] 치수 읽기: 쓸 만한 치수가 없음', res.note);
        if (!opts.auto) offerRecovery(noScaleFound(res.note));
        return;
      }
      // 보낸 그림 기준 축척을 마스크 기준으로 되돌린다
      if (res.estimate) {
        pxPerMeter = res.estimate.pxPerMeter / scale;
        scaleSource = `치수선 ${res.estimate.used}개`;
        scaleStatus = 'auto';
        const labels = res.estimate.labels.slice(0, 4).join(', ');
        say(`치수선으로 축척을 맞췄습니다. 1m = ${pxPerMeter.toFixed(1)}px (치수 ${res.estimate.used}개가 서로 맞음: ${labels}).`);
      } else {
        // 치수선이 없는 도면이다. 벽 두께 0.2m 가정보다는 표준 치수 어림이 훨씬 낫다
        const g = res.guess as NonNullable<typeof res.guess>;
        pxPerMeter = g.pxPerMeter / scale;
        scaleSource = `표준 치수 ${g.used}개 어림`;
        scaleStatus = 'estimated';
        say(`치수선이 없어 표준 치수로 어림했습니다. 1m = ${pxPerMeter.toFixed(1)}px (${g.basis}). 어림이라 오차가 있습니다. 정확히 맞추려면 축척 모드를 쓰세요.`);
      }
      scaleFixed = true;
      applyScale();
    } catch (err) {
      console.warn('[plan] 치수 읽기 실패', err);
      if (gen !== planGen || opts.auto) return;
      offerRecovery(describeFailure('scale', failureInput(err), signedIn));
    } finally {
      busy = false;
      scaleBtn.disabled = mask === null;
    }
  }

  async function runReview(opts: { auto?: boolean } = {}): Promise<void> {
    if (!mask || busy) return;
    const gen = planGen;
    const reqRev = rev;
    busy = true;
    reviewBtn.disabled = true;
    try {
      say(opts.auto ? '벽을 세웠습니다. 이어서 AI 가 검토하는 중… (수십 초)' : 'AI 가 벽 검출 결과를 검토하는 중… (수십 초)');
      // 후보와 방 목록은 지금 마스크 기준이어야 한다. 디바운스 중이면 이전 도면 것일 수 있다
      measureRooms();
      const openings = lastOpenings.slice(0, MAX_REVIEW_OPENINGS);
      const { canvas, scale } = buildOverlay(openings);
      const g = gridOf();
      const context: ReviewContext = {
        planId: currentPlan?.id ?? null,
        round: 1,
        grid: { cols: g.cols, rows: g.rows },
        params: { dark: userDark ?? DEFAULT_DARK, wallPx, pxPerMeter: pxPerMeter * scale },
        openings: openings.map((o) => ({ id: o.id, widthM: o.widthM, cell: cellOf([(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]), between: roomsBeside(o) })),
        rooms: (report?.rooms ?? []).map((r) => ({ id: r.id, areaM2: r.area, cell: cellOf(r.center) })),
      };
      const image = await toBlob(canvas, 'image/jpeg', 0.85);
      const res = await reviewPlan(image, canvas.width, canvas.height, context);
      if (gen !== planGen) return; // 검토하는 사이에 다른 도면을 올렸다
      if (reqRev !== rev) {
        // 검토하는 사이에 벽·축척·판정이 바뀌었다. 옛 상태에 대한 제안이므로 버린다
        say('검토하는 사이에 도면이 바뀌어 AI 제안을 버렸습니다. 다시 검토해 주세요.');
        return;
      }
      const rv = res.review;
      // 보낸 그림 기준 축척을 마스크 기준으로 되돌린다
      pendingReview = rv.scale.pxPerMeter !== null ? { ...rv, scale: { ...rv.scale, pxPerMeter: rv.scale.pxPerMeter / scale } } : rv;
      pendingOpenings = openings;
      pendingRev = rev;
      renderReview(pendingReview, res.model);
      say(`AI 검토가 끝났습니다 (품질 ${(rv.quality * 100).toFixed(0)}점). 적용할 제안을 골라 주세요.`);
    } catch (err) {
      console.warn('[plan] AI 검토 실패', err);
      if (gen === planGen) offerRecovery(describeFailure('review', failureInput(err), signedIn));
    } finally {
      busy = false;
      // 검토가 끝나면 다시 눌러 볼 수 있게 항상 되살린다
      reviewBtn.disabled = mask === null;
      scaleBtn.disabled = mask === null;
    }
  }

  function renderReview(rv: PlanReview, model: string): void {
    const items: string[] = [];
    const item = (kind: string, idx: number, text: string, checked = true): string =>
      `<li><label><input type="checkbox" data-kind="${kind}" data-idx="${idx}" ${checked ? 'checked' : ''}> ${esc(text)}</label></li>`;
    rv.falseWalls.forEach((f, i) => items.push(item('false', i, `${f.cell} 칸에서 주 벽에 붙지 않은 조각 지우기 (${f.what})`)));
    rv.missingWalls.forEach((m, i) => {
      const seg = mask ? snapMissing(m, mask) : null;
      const evidence = seg ? darkEvidence(seg[0], seg[1]) : 0;
      const ok = evidence >= MISSING_EVIDENCE;
      const len = seg ? (Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) / pxPerMeter).toFixed(1) : '?';
      items.push(item('missing', i, `벽 추가 ${len}m: ${m.why}${ok ? '' : ` — 원본에 선이 ${(evidence * 100).toFixed(0)}% 만 보여 확인이 필요합니다`}`, ok));
    });
    const KIND_TEXT: Record<OpeningKind, string> = {
      door: '문 — 방을 나누고 3D 에 인방을 남김',
      window: '창문 — 방을 나누고 창턱·유리를 세움',
      open: '트인 곳 — 방을 나누지 않음',
      not_opening: '개구부 아님 — 무시',
    };
    const byId = new Map(pendingOpenings.map((o) => [o.id, o]));
    rv.openings.forEach((o, i) => {
      const op = byId.get(o.id);
      if (!op) return;
      const changed = judgedKind(op) !== o.kind;
      items.push(item('opening', i, `개구부 ${o.id} (${op.widthM.toFixed(1)}m): ${KIND_TEXT[o.kind]}${changed ? '' : ' (지금과 같음)'}`, changed));
    });
    rv.rooms.forEach((r, i) => items.push(item('name', i, `구역 ${r.id} 이름을 "${r.name}" 으로`)));
    if (rv.scale.pxPerMeter !== null) items.push(item('scale', 0, `축척 1m = ${rv.scale.pxPerMeter.toFixed(1)}px 적용 (${rv.scale.basis})`, !scaleFixed));
    if (rv.params.dark !== null || rv.params.wallPx !== null) {
      const parts = [rv.params.dark !== null ? `어두움 기준 ${rv.params.dark}` : '', rv.params.wallPx !== null ? `벽 두께 ${rv.params.wallPx}px` : ''].filter(Boolean).join(', ');
      items.push(item('params', 0, `권고 매개변수(${parts})로 벽을 다시 추출 — 지금까지의 편집과 판정이 지워집니다`, false));
    }
    reviewBox.innerHTML = `
      <p class="plan3d__total">AI 검토 <strong>${(rv.quality * 100).toFixed(0)}점</strong>
        <span class="plan3d__sub">· ${esc(model)}</span></p>
      <p class="plan3d__sub">${esc(rv.summary)}</p>
      ${items.length ? `<ul class="plan3d__suggest">${items.join('')}</ul>` : '<p class="plan3d__sub">고칠 제안이 없습니다.</p>'}
      <div class="plan3d__modes">
        ${items.length ? '<button type="button" class="btn btn--accent btn--compact" data-action="review-apply">선택한 제안 적용</button>' : ''}
        <button type="button" class="btn btn--quiet btn--compact" data-action="review-close">닫기</button>
      </div>`;
    reviewBox.hidden = false;
  }

  function applyReview(): void {
    const rv = pendingReview;
    if (!rv || !mask || !viewer) return;
    if (pendingRev !== rev) {
      pendingReview = null;
      reviewBox.hidden = true;
      say('검토 뒤에 도면이 바뀌어 이 제안은 적용할 수 없습니다. 다시 검토해 주세요.', 'error');
      return;
    }
    const picked = Array.from(reviewBox.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'));
    const has = (kind: string, idx: number): boolean => picked.some((c) => c.dataset['kind'] === kind && Number(c.dataset['idx']) === idx);
    if (!picked.length) {
      pendingReview = null;
      reviewBox.hidden = true;
      return;
    }
    if (has('params', 0)) {
      // 다시 추출하면 마스크·판정·되돌리기가 모두 새로 시작한다. 다른 제안은 새 마스크에 맞지 않으므로 함께 적용하지 않는다
      if (rv.params.dark !== null) userDark = rv.params.dark;
      if (rv.params.wallPx !== null) userThick = rv.params.wallPx;
      pendingReview = null;
      reviewBox.hidden = true;
      void show();
      return;
    }
    pushUndo();
    const before = mask.slice();
    let maskChanged = false;
    if (rv.falseWalls.some((_, i) => has('false', i))) {
      // 칸째 지우되 주 벽 네트워크(가장 큰 덩어리)는 남긴다. 가구·글자는 대개 따로 떨어진 덩어리다.
      // 진짜 벽이 같은 칸에 있어도 지워지지 않고, 벽에 붙은 가구는 안 지워지는 쪽으로 틀린다 (사용자가 지우면 된다)
      const { labels, areas } = labelComponents(before, W(), H());
      let mainId = 0;
      for (let id = 1; id < areas.length; id++) if ((areas[id] ?? 0) > (areas[mainId] ?? 0)) mainId = id;
      rv.falseWalls.forEach((f, i) => {
        if (!has('false', i) || !mask) return;
        const r = rectOfCell(f.cell);
        if (!r) return;
        for (let y = Math.max(0, Math.floor(r.y0)); y < Math.min(H(), Math.ceil(r.y1)); y++) {
          for (let x = Math.max(0, Math.floor(r.x0)); x < Math.min(W(), Math.ceil(r.x1)); x++) {
            const i2 = y * W() + x;
            if (mask[i2] && labels[i2] !== mainId) { mask[i2] = 0; maskChanged = true; }
          }
        }
      });
    }
    rv.missingWalls.forEach((m, i) => {
      if (!has('missing', i) || !mask) return;
      const seg = snapMissing(m, before);
      if (!seg) return;
      paintWall(mask, W(), H(), seg[0], seg[1], wallPx);
      maskChanged = true;
    });
    const sameRect = (r: Rect, q: Rect): boolean => r.x0 === q.x0 && r.y0 === q.y0 && r.x1 === q.x1 && r.y1 === q.y1;
    const byId = new Map(pendingOpenings.map((o) => [o.id, o]));
    rv.openings.forEach((o, i) => {
      if (!has('opening', i)) return;
      const op = byId.get(o.id);
      if (!op) return;
      setJudgment(op, o.kind);
      windowRects = windowRects.filter((r) => !sameRect(r, op.rect));
      doorRects = doorRects.filter((r) => !sameRect(r, op.rect));
      if (o.kind === 'window') windowRects.push(op.rect);
      if (o.kind === 'door') doorRects.push(op.rect);
    });
    viewer.setWindows(windowRects);
    viewer.setDoors(doorRects);
    rv.rooms.forEach((r, i) => { if (has('name', i)) roomNames[r.id] = r.name; });
    if (rv.scale.pxPerMeter !== null && has('scale', 0)) {
      pxPerMeter = rv.scale.pxPerMeter;
      scaleFixed = true;
      scaleSource = 'AI 어림';
      scaleStatus = 'estimated';
      applyScale();
    } else if (maskChanged) {
      rebuild();
    } else {
      measureRooms();
    }
    pendingReview = null;
    reviewBox.hidden = true;
    say('AI 제안을 적용했습니다. 되돌리기로 한 번에 취소할 수 있습니다.');
  }

  let defaultTried = false;
  /**
   * 기본 도면을 올린다. autoReview 는 사용자가 "기본 도면" 을 누른 경우에만 켠다.
   * 탭을 열 때의 자동 적재까지 검토하면 페이지를 열 때마다 유료 호출과 하루 한도가 소모된다.
   */
  async function loadDefault(autoReview = false): Promise<void> {
    defaultTried = true;
    say('기본 도면을 불러오는 중…');
    try {
      const res = await fetch(DEFAULT_PLAN_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await load(new File([blob], 'default.png', { type: blob.type || 'image/png' }), autoReview);
    } catch (err) {
      say(`기본 도면을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void load(file, true);
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
    if (file) void load(file, true);
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
    if (mode === 'view') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setMode('view');
      say('편집을 끝냈습니다.');
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      popUndo();
    }
  };
  document.addEventListener('keydown', onKey);

  const onPick = (): void => input.click();
  document.addEventListener(PLAN_PICK_EVENT, onPick);

  return {
    el,
    pick: onPick,
    activate() {
      if (!defaultTried && !pixels) void loadDefault();
    },
    update(state) {
      const conv = state.conversations.find((c) => c.id === state.activeConversationId);
      const view = conv?.caseId ? state.cases[conv.caseId] : undefined;
      const ready = Boolean(view?.data);
      const saving = view?.state === 'saving';
      const done = caseSaving && !saving;
      if (ready !== caseReady || saving !== caseSaving) {
        caseReady = ready;
        caseSaving = saving;
        if (done && importSent) {
          // 저장이 끝났다. 보낸 값이 실제로 들어갔을 때만 성공으로 말한다
          const field = view?.data?.fields[importSent.key];
          const applied = field?.state === 'user_confirmed' && field.value === importSent.value;
          const label = IMPORT_TARGETS.find((t) => t.key === importSent?.key)?.label ?? '조건';
          if (applied) {
            importOpen = false;
            importAck = false;
            say(`${label}에 ${importSent.value}㎡ 를 넣었습니다. ‘내 영업장’ 탭에서 확인하세요.`);
          } else {
            say(view?.message ?? '조건에 넣지 못했습니다. 다시 시도해 주세요.', 'error');
          }
          importSent = null;
        }
        if (report) renderAreas();
      }
      signedIn = state.user !== null && !state.user.anonymous;
      const next = state.user?.id ?? null;
      if (next === userId) return;
      userId = next;
      currentPlan = null;
      void refreshSaved();
    },
    dispose() {
      document.removeEventListener(PLAN_PICK_EVENT, onPick);
      document.removeEventListener('keydown', onKey);
      if (roomsTimer) clearTimeout(roomsTimer);
      viewer?.dispose();
      viewer = null;
    },
  };
}
