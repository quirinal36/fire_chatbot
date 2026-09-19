/**
 * 도면 탭. 2D 도면 이미지를 받아 브라우저 안에서 벽을 골라내고 3D 로 세운다. 벽을 긋고 지우고,
 * 축척을 맞춰 방 면적을 잰다. 서버로 보내지 않는다.
 *
 * 화면은 "단계 칩 → 그 단계의 도구 카드 → 캔버스 → 바닥 면적 띠" 네 층이다. 단계 안내와 도구를
 * 따로 두면 처음 쓰는 사람이 안내를 읽고도 어디를 눌러야 할지 모른다. 그래서 칩이 곧 도구 카드의
 * 탭이고, 카드 밖에서 도구를 켜면 덱이 그 도구가 사는 카드로 따라온다.
 * 캔버스가 유지되어야 하므로 panel 은 이 요소를 innerHTML 로 다시 그리지 않고 붙였다 뗀다.
 */
import { esc, must, onAction } from '../lib/dom';
import { icons } from '../lib/icons';
import { createPlan, deletePlan, getPlan, listPlans, readPlanScale, updatePlan, type PlanSummary, type ScaleStatus } from '../api/plans';
import { fillRect, MAX_GAP_M, paintWall, placeOpening, polygonsFromMask, snapToAxis, wallMask, wallOutline, wallSegmentAt, type PlacedOpening, type Pt, type Rect } from '../plan/walls';
import { barrierOfRect, findRooms, roomLabel, type Barrier, type RoomReport } from '../plan/rooms';
import { findOpenings, type Opening } from '../plan/openings';
import { decideImport, IMPORT_TARGETS, type AreaChoice } from '../plan/areaImport';
import { describeFailure, failureInput, noScaleFound, type Failure, type RecoveryAction } from '../plan/failure';
import type { EditHandlers, Viewer, ViewMode } from '../plan/viewer';
import type { AppActions } from '../actions';
import type { AppState } from '../types';

/** 분석용 이미지 최대 변 길이(px). 더 크면 줄여서 분석한다 */
const MAX_SIDE = 1600;
/** 축척을 모를 때 벽 두께로 가정하는 값(m) */
const ASSUMED_WALL_M = 0.2;
/** 문 기본 폭(m). 외여닫이문 유효폭 */
const DEFAULT_DOOR_M = 0.9;
/** 창 기본 폭(m). 주거 침실 창 정도 */
const DEFAULT_WINDOW_M = 1.5;
/** 사용자가 놓는 개구부. 문은 방을 나누되 드나드는 곳이고, 창은 나누기만 한다 */
type OpeningKind = 'door' | 'window';
const UNDO_LIMIT = 20;
const PYEONG = 3.3058;
/** 축척 읽기용 그림 최대 폭. 치수 글자가 작아 검토용보다 크게 보낸다 */
const SCALE_MAX_W = 1600;
/**
 * 이 폭(m) 이하의 개구부 후보를 문으로 보고 방을 나눈다. 그보다 넓은 자리(양여닫이, 트인 거실·주방)는
 * 막지 않는다 — 트인 곳을 잘못 막는 것보다 한 구역으로 두는 편이 낫다. 나누고 싶으면 벽을 그으면 된다.
 */
const DEFAULT_SEAL_M = 1.3;
/** 성공 문구가 흐려지기까지(ms). 오류와 복구 버튼은 흐려지지 않는다 */
const STALE_MS = 6000;
/** 캔버스 위 도구 띠가 도면을 가리는 높이(px). 카메라를 맞출 때 이만큼을 뺀다 */
const HUD_TOP_PX = 44;
const HUD_BOTTOM_PX = 36;
/** 되돌리기 한 단계. 벽만 되돌리면 판정·축척과 어긋나므로 함께 담는다 */
interface Snapshot {
  readonly mask: Uint8Array;
  readonly doorRects: Rect[];
  readonly windowRects: Rect[];
  readonly roomNames: Record<number, string>;
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
const MODES = ['view', 'add', 'erase', 'door', 'window', 'scale'] as const;
type Mode = (typeof MODES)[number];
/** 준비 → 실제 길이 → 벽·문 확인 → 소방시설 검토 */
type StepNo = 1 | 2 | 3 | 4;
/** 캔버스 위에 여는 서랍. 길이가 변하는 목록·폼은 여기에 둔다 — 캔버스 크기를 건드리지 않기 위해서다 */
type Drawer = 'rooms' | 'import' | 'advanced';

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

const STEP_TODO: Record<StepNo, string> = {
  1: '도면을 올리거나 예시로 체험하세요',
  2: '면적을 맞추려면 실제 길이가 필요합니다',
  3: '벽과 문이 실제 도면과 같은가요?',
  4: '영업장 조건을 입력하면 설비별 결과가 나옵니다',
};
const STEP_NAME: Record<StepNo, string> = { 1: '① 도면 준비', 2: '② 실제 길이', 3: '③ 벽·문 확인', 4: '④ 소방시설 검토' };
const MODE_TITLE: Record<Mode, string> = {
  view: '',
  add: '벽 추가 중',
  erase: '벽 지우기 중',
  door: '문 추가 중',
  window: '창문 추가 중',
  scale: '실제 길이 맞추기 중',
};

export function createPlanView(actions: AppActions): PlanView {
  const el = document.createElement('div');
  el.className = 'plan3d';
  el.dataset['mode'] = 'view';
  el.dataset['deck'] = '1';
  el.dataset['drawer'] = '';
  el.dataset['loaded'] = 'false';
  const chip = (n: StepNo, title: string, short: string, sub: string, hint: string): string => `
    <li><button type="button" class="plan3d__step" data-action="step" data-step="${n}" data-state="todo" aria-pressed="${n === 1}" title="${esc(hint)}"${n === 1 ? '' : ' disabled'}>
      <span class="plan3d__step-n">${n}</span>
      <span class="plan3d__step-title" data-short="${esc(short)}">${esc(title)}</span>
      <span class="plan3d__step-state"></span>
      <span class="plan3d__step-sub${n === 1 ? ' plan3d__origin' : ''}">${esc(sub)}</span>
    </button></li>`;
  el.innerHTML = `
    <div class="plan3d__side">
      <ol class="plan3d__steps" aria-label="도면 검토 단계">
        ${chip(1, '도면 준비', '도면', '올리기 · 예시 체험', '내 도면 올리기 · 예시 도면 · 저장한 도면 불러오기')}
        ${chip(2, '실제 길이', '길이', '맞추기 · 자동 읽기', '실제 길이 맞추기 · 도면의 치수 자동 읽기')}
        ${chip(3, '벽·문 확인', '벽·문', '추가 · 지우기 · 문 · 창', '벽 추가 · 벽 지우기 · 문 추가 · 창문 추가 · 인식 기준 조정')}
        ${chip(4, '소방시설 검토', '검토', '조건 입력 · 면적 넣기', '영업장 조건 입력 · 도면 면적 넣기')}
      </ol>
      <div class="plan3d__deck" role="region" aria-label="지금 단계의 도구">
        <p class="plan3d__todo"><span class="plan3d__todo-label">지금 할 일 · ${STEP_TODO[1]}</span><button type="button" class="link plan3d__todo-back" data-action="step" data-step="0" hidden>지금 할 일로 돌아가기</button></p>

        <section class="plan3d__card" data-step="1">
          <div class="plan3d__card-row">
            <label class="btn btn--accent btn--compact plan3d__upload">
              내 도면 올리기
              <input type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" aria-label="도면 이미지 선택">
            </label>
            <button type="button" class="btn btn--compact" data-action="default">예시 도면으로 체험하기</button>
            <div class="plan3d__saved" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>내 도면</span><select data-ctl="saved" aria-label="저장한 도면"></select></label>
              <button type="button" class="btn btn--compact" data-action="load-saved">불러오기</button>
              <button type="button" class="btn btn--quiet btn--compact" data-action="delete-saved">삭제</button>
            </div>
          </div>
          <div class="plan3d__card-ctx">
            <p class="plan3d__help" data-for="1">PNG·JPG 도면을 올리면 벽을 자동으로 찾습니다. 도면은 서버로 보내지 않습니다.
              저장은 도면 오른쪽 위 <strong>저장</strong>, 넓게 보려면 패널 위쪽 <strong>크게 보기</strong>.</p>
            <form class="plan3d__save" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>도면 이름</span><input type="text" data-ctl="name" maxlength="80" required placeholder="예: 3층 학원"></label>
              <button type="submit" class="btn btn--accent btn--compact" data-save="update" hidden>덮어쓰기</button>
              <button type="submit" class="btn btn--accent btn--compact" data-save="create">새로 저장</button>
              <button type="button" class="btn btn--quiet btn--compact" data-action="save-close">닫기</button>
            </form>
          </div>
        </section>

        <section class="plan3d__card" data-step="2" hidden>
          <div class="plan3d__card-row">
            <button type="button" class="btn btn--accent btn--compact plan3d__mode" data-action="mode" data-mode="scale" aria-pressed="false">실제 길이 맞추기</button>
            <button type="button" class="btn btn--accent btn--compact" data-action="scale-confirm" hidden>읽은 치수 확인</button>
            <button type="button" class="btn btn--quiet btn--compact" data-action="scale-read" disabled title="AI 가 도면에 적힌 치수를 읽습니다 · 수십 초 · 하루 이용 한도를 씁니다">도면의 치수 자동 읽기</button>
            <button type="button" class="link" data-action="scale-later">길이를 몰라요 · 나중에 확인</button>
            <span class="plan3d__micro plan3d__scale-brief" hidden></span>
          </div>
          <div class="plan3d__card-ctx">
            <p class="plan3d__help" data-for="2">길이를 아는 벽이나 치수선을 따라 도면 위에 선을 그으세요.
              치수가 적힌 도면이면 <strong>자동 읽기</strong>(AI · 수십 초 · 하루 한도)가 빠릅니다.</p>
            <form class="plan3d__scale" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>그은 선의 실제 길이 m</span><input type="number" data-ctl="scaleM" min="0.1" step="0.01" required placeholder="예: 4.2"></label>
              <button type="submit" class="btn btn--accent btn--compact">적용</button>
              <button type="button" class="btn btn--quiet btn--compact" data-action="scale-redraw">다시 긋기</button>
            </form>
          </div>
        </section>

        <section class="plan3d__card" data-step="3" hidden>
          <div class="plan3d__card-row">
            <button type="button" class="btn btn--accent btn--compact" data-action="recognition-confirm">맞아요</button>
            <button type="button" class="link" data-action="recognition-reopen" hidden>확인됨 · 다시 확인하기</button>
            <span class="plan3d__sep" aria-hidden="true"></span>
            <span role="group" aria-label="편집 도구" class="plan3d__mode-group">
              <button type="button" class="btn btn--compact plan3d__mode" data-action="mode" data-mode="view" aria-pressed="true">둘러보기</button>
              <button type="button" class="btn btn--compact plan3d__mode" data-action="mode" data-mode="add" aria-pressed="false">벽 추가</button>
              <button type="button" class="btn btn--compact plan3d__mode" data-action="mode" data-mode="erase" aria-pressed="false">벽 지우기</button>
              <button type="button" class="btn btn--compact plan3d__mode" data-action="mode" data-mode="door" aria-pressed="false">문 추가</button>
              <button type="button" class="btn btn--compact plan3d__mode" data-action="mode" data-mode="window" aria-pressed="false">창문 추가</button>
            </span>
          </div>
          <div class="plan3d__card-ctx">
            <p class="plan3d__help" data-for="3">벽이 실제 도면과 다르면 도구로 고치고, 같으면 <strong>맞아요</strong>.
              벽이 너무 많이·적게 잡혔으면 <button type="button" class="link" data-action="drawer" data-drawer="advanced" aria-expanded="false">인식 기준 조정</button></p>
            <div class="plan3d__edit" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>길이 m</span><input type="number" data-ctl="length" min="0.1" step="0.1" placeholder="끈 만큼"></label>
              <label class="plan3d__field plan3d__field--inline"><span>두께 m</span><input type="number" data-ctl="thickM" min="0.05" step="0.05" value="${ASSUMED_WALL_M}"></label>
              <span class="plan3d__micro">도면 위를 끌어 벽을 긋습니다 · 수평·수직에 가까우면 축에 붙습니다</span>
            </div>
            <p class="plan3d__help" data-for="erase" hidden>벽을 클릭하면 교차점 사이 한 구간이, 문·창을 클릭하면 그것이 지워집니다.
              끌어서 사각형을 그리면 그 안의 벽과 문·창이 모두 지워집니다.</p>
            <div class="plan3d__door" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>문 폭 m</span><input type="number" data-ctl="doorM" min="0.3" max="6" step="0.1" value="${DEFAULT_DOOR_M}"></label>
              <span class="plan3d__micro">벽을 클릭하면 뚫림 · 벽 사이 빈 자리를 클릭하면 그 틈이 문 · 끌면 끈 만큼 · 양 끝이 벽에 닿아야 방이 나뉨</span>
            </div>
            <div class="plan3d__window" hidden>
              <label class="plan3d__field plan3d__field--inline"><span>창 폭 m</span><input type="number" data-ctl="windowM" min="0.3" max="6" step="0.1" value="${DEFAULT_WINDOW_M}"></label>
              <span class="plan3d__micro">벽을 클릭하면 창으로 · 벽 사이 빈 자리를 클릭하면 그 틈이 창 · 끌면 끈 만큼</span>
            </div>
          </div>
        </section>

        <section class="plan3d__card" data-step="4" hidden>
          <div class="plan3d__card-row">
            <button type="button" class="btn btn--accent btn--compact" data-action="open-case">영업장 조건 입력하기</button>
            <button type="button" class="btn btn--compact" data-action="area-import-open" aria-expanded="false">도면 면적을 조건에 넣기</button>
            <button type="button" class="link" data-action="recognition-edit">벽·문을 더 고치기</button>
          </div>
          <div class="plan3d__card-ctx">
            <p class="plan3d__help" data-for="4"></p>
          </div>
        </section>
      </div>
    </div>

    <div class="plan3d__view">
      <div class="plan3d__stage" data-empty="true">
        <p class="plan3d__hint">이미지를 여기에 끌어다 놓아도 됩니다.<br>도면은 서버로 보내지 않고 이 브라우저 안에서만 처리합니다.</p>
      </div>
      <div class="plan3d__hud plan3d__hud--mode" hidden>
        <button type="button" class="plan3d__hud-badge" data-action="step" data-step="3" hidden title="이 도구의 카드로 가기"></button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="undo" disabled>되돌리기</button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="finish-edit" hidden>편집 끝내기 <kbd>Esc</kbd></button>
      </div>
      <div class="plan3d__hud plan3d__hud--view" role="group" aria-label="보는 방식" hidden>
        <button type="button" class="btn btn--compact" data-action="view" data-view="plan" aria-pressed="true" aria-label="평면 보기" title="평면 보기">${icons.plan()}<span>평면</span></button>
        <button type="button" class="btn btn--compact" data-action="view" data-view="3d" aria-pressed="false" aria-label="3D 보기" title="3D 보기">${icons.cube()}<span>3D</span></button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="fit" aria-label="도면 전체 맞추기" title="도면 전체 맞추기">${icons.fit()}<span>전체</span></button>
        <button type="button" class="btn btn--quiet btn--compact" data-action="floor" aria-pressed="true" aria-label="원본 도면 표시" title="원본 도면 표시">${icons.image()}<span>원본</span></button>
        <span class="plan3d__sep" aria-hidden="true"></span>
        <button type="button" class="btn btn--quiet btn--compact" data-action="save-open" disabled aria-label="도면 저장" title="계정에 도면 저장">${icons.save()}<span>저장</span></button>
      </div>
      <div class="plan3d__hud plan3d__hud--status">
        <p class="plan3d__status" aria-live="polite">벽·출입구·창문만 있는 2D 도면(PNG·JPG)을 올리면 벽을 찾아 면적을 잽니다.</p>
        <div class="plan3d__recovery" role="group" aria-label="다음에 할 수 있는 일" hidden></div>
      </div>
      <div class="plan3d__drawer" role="region" aria-label="구역과 면적" hidden>
        <div class="plan3d__drawer-head">
          <strong class="plan3d__drawer-title"></strong>
          <button type="button" class="btn btn--quiet btn--icon btn--compact" data-action="drawer-close" aria-label="닫기">${icons.close()}</button>
        </div>
        <div class="plan3d__advanced" hidden>
          <div class="plan3d__ctl">
            <label class="plan3d__field">
              <span>벽 높이 <output data-out="height">2.7</output> m</span>
              <input type="range" data-ctl="height" min="0.3" max="4" step="0.1" value="2.7">
            </label>
            <label class="plan3d__field">
              <span>벽 인식 기준 <output data-out="thick">-</output> px</span>
              <input type="range" data-ctl="thick" min="2" max="40" step="1" value="8">
            </label>
          </div>
          <p class="plan3d__note">이 굵기(px) 이상인 검은 선만 벽으로 봅니다. 가구·글자가 벽으로 잡히면 올리고, 얇은 벽이 빠지면 내리세요.
            벽이 끊긴 자리가 출입구·창문입니다. 벽 높이는 3D 로 세울 때만 씁니다.</p>
        </div>
        <div class="plan3d__drawer-body"></div>
      </div>
    </div>

    <div class="plan3d__foot">
      <p class="plan3d__foot-empty">도면을 올리면 바닥 면적을 계산합니다.</p>
      <div class="plan3d__areas" hidden></div>
    </div>
  `;

  const input = must<HTMLInputElement>('input[type="file"]', el);
  const status = must<HTMLParagraphElement>('.plan3d__status', el);
  const recovery = must<HTMLDivElement>('.plan3d__recovery', el);
  const stepBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('.plan3d__step'));
  const cards = Array.from(el.querySelectorAll<HTMLElement>('.plan3d__card'));
  const todoLabel = must<HTMLSpanElement>('.plan3d__todo-label', el);
  const todoBack = must<HTMLButtonElement>('.plan3d__todo-back', el);
  const originEl = must<HTMLSpanElement>('.plan3d__origin', el);
  const helpOf = (key: string): HTMLParagraphElement => must<HTMLParagraphElement>(`.plan3d__help[data-for="${key}"]`, el);
  const help1 = helpOf('1');
  const help2 = helpOf('2');
  const help3 = helpOf('3');
  const helpErase = helpOf('erase');
  const help4 = helpOf('4');
  const editBox = must<HTMLDivElement>('.plan3d__edit', el);
  const doorBox = must<HTMLDivElement>('.plan3d__door', el);
  const windowBox = must<HTMLDivElement>('.plan3d__window', el);
  const scaleForm = must<HTMLFormElement>('.plan3d__scale', el);
  const scaleBrief = must<HTMLSpanElement>('.plan3d__scale-brief', el);
  const scaleLaterBtn = must<HTMLButtonElement>('[data-action="scale-later"]', el);
  const scaleConfirmBtn = must<HTMLButtonElement>('[data-action="scale-confirm"]', el);
  const confirmBtn = must<HTMLButtonElement>('[data-action="recognition-confirm"]', el);
  const reopenBtn = must<HTMLButtonElement>('[data-action="recognition-reopen"]', el);
  const importOpenBtn = must<HTMLButtonElement>('[data-action="area-import-open"]', el);
  const stage = must<HTMLDivElement>('.plan3d__stage', el);
  const hudMode = must<HTMLDivElement>('.plan3d__hud--mode', el);
  const hudBadge = must<HTMLButtonElement>('.plan3d__hud-badge', el);
  const hudView = must<HTMLDivElement>('.plan3d__hud--view', el);
  const drawerEl = must<HTMLDivElement>('.plan3d__drawer', el);
  const drawerTitle = must<HTMLElement>('.plan3d__drawer-title', el);
  const drawerBody = must<HTMLDivElement>('.plan3d__drawer-body', el);
  const advanced = must<HTMLDivElement>('.plan3d__advanced', el);
  const footEmpty = must<HTMLParagraphElement>('.plan3d__foot-empty', el);
  const areas = must<HTMLDivElement>('.plan3d__areas', el);
  const heightIn = must<HTMLInputElement>('[data-ctl="height"]', el);
  const thickIn = must<HTMLInputElement>('[data-ctl="thick"]', el);
  const floorBtn = must<HTMLButtonElement>('[data-action="floor"]', el);
  const viewBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-action="view"]'));
  const lengthIn = must<HTMLInputElement>('[data-ctl="length"]', el);
  const thickMIn = must<HTMLInputElement>('[data-ctl="thickM"]', el);
  const doorMIn = must<HTMLInputElement>('[data-ctl="doorM"]', el);
  const windowMIn = must<HTMLInputElement>('[data-ctl="windowM"]', el);
  const scaleMIn = must<HTMLInputElement>('[data-ctl="scaleM"]', el);
  const heightOut = must<HTMLOutputElement>('[data-out="height"]', el);
  const thickOut = must<HTMLOutputElement>('[data-out="thick"]', el);
  const undoBtn = must<HTMLButtonElement>('[data-action="undo"]', el);
  const finishEditBtn = must<HTMLButtonElement>('[data-action="finish-edit"]', el);
  const saveBtn = must<HTMLButtonElement>('[data-action="save-open"]', el);
  const scaleBtn = must<HTMLButtonElement>('[data-action="scale-read"]', el);
  const saveForm = must<HTMLFormElement>('.plan3d__save', el);
  const nameIn = must<HTMLInputElement>('[data-ctl="name"]', el);
  const updateBtn = must<HTMLButtonElement>('[data-save="update"]', el);
  const createBtn = must<HTMLButtonElement>('[data-save="create"]', el);
  const savedBox = must<HTMLDivElement>('.plan3d__saved', el);
  const savedSel = must<HTMLSelectElement>('[data-ctl="saved"]', el);
  const modeBtns = Array.from(el.querySelectorAll<HTMLButtonElement>('[data-action="mode"]'));
  const modeBtnOf = (m: Mode): HTMLButtonElement | undefined => modeBtns.find((b) => b.dataset['mode'] === m);
  const stepBtnOf = (n: StepNo): HTMLButtonElement | undefined => stepBtns.find((b) => b.dataset['step'] === String(n));

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
  /** 진행 중인 작업 이름. 있으면 다른 긴 작업은 기다리라고 말한다 — 조용히 무시하면 버튼이 고장난 줄 안다 */
  let busyWhy: '치수 읽기' | '저장' | '불러오기' | '삭제' | null = null;
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
  /** 벽·축척이 바뀔 때마다 올라간다. 늦게 도착한 치수 읽기 결과를 버리는 데 쓴다 */
  let rev = 0;
  /** 인식 결과를 확인해 준 시점의 rev. 벽·축척이 바뀌면 rev 가 올라가 확인이 풀린다 */
  let confirmedRev: number | null = null;
  /** 실제 길이 확인을 나중으로 미뤘는가. 추정 상태는 그대로 두고 다음 단계로 넘어가게만 한다 */
  let scaleDeferred = false;
  /** 보는 방식. 도면은 평면으로 연다 — 입체 벽은 원본·치수·구역을 가린다 */
  let viewMode: ViewMode = 'plan';
  /** 원본 도면을 바닥에 깔아 둘 것인가 */
  let floorVisible = true;
  /** 사용자가 칩을 눌러 고정해 둔 카드. null 이면 지금 단계를 따라간다 */
  let deckStep: StepNo | null = null;
  /** 마지막으로 그린 단계. 단계가 실제로 바뀌면 고정을 푼다 */
  let lastStep = 0;
  /** 열린 서랍 */
  let drawer: Drawer | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
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

  /**
   * 상태 문구. 성공 문구는 잠시 뒤 흐려져 캔버스를 덜 가린다. 글자는 남아 낭독기·시험이 읽을 수 있다.
   * 오류와 진행 중(… 으로 끝나는) 문구는 흐려지지 않는다 — 흐려지면 멈춘 것처럼 보인다.
   */
  function say(text: string, tone: 'info' | 'error' = 'info'): void {
    status.textContent = text;
    status.classList.toggle('tone-flag', tone === 'error');
    status.classList.remove('is-stale');
    recovery.replaceChildren();
    recovery.hidden = true;
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = tone === 'info' && !text.endsWith('…') ? setTimeout(() => status.classList.add('is-stale'), STALE_MS) : null;
  }

  /** 긴 작업이 돌고 있으면 무엇인지 말하고 true. 부르는 쪽은 그냥 돌아간다 */
  function waitIfBusy(): boolean {
    if (!busyWhy) return false;
    say(`${busyWhy} 중입니다. 끝난 뒤 다시 시도하세요.`);
    return true;
  }

  const RECOVERY_LABEL: Record<RecoveryAction, string> = {
    'scale-mode': '직접 길이 입력',
    'scale-retry': '다시 읽기',
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

  /** 인식 결과 확인이 지금 도면에 대한 것인가. 벽이나 축척을 바꾸면 풀린다 */
  function recognitionConfirmed(): boolean {
    return confirmedRev === rev;
  }

  /** 준비 → 실제 길이 → 벽·문 확인 → 소방시설 검토. 길이를 미뤘으면 인식 확인으로 넘어간다 */
  function currentStep(): StepNo {
    if (!pixels || sourceKind === null) return 1;
    if (scaleStatus !== 'confirmed' && !scaleDeferred) return 2;
    return recognitionConfirmed() ? 4 : 3;
  }
  const shownStep = (): StepNo => deckStep ?? currentStep();

  /** CSS 와 시험이 상태를 읽는 창구 */
  function syncRoot(): void {
    el.dataset['mode'] = mode;
    el.dataset['deck'] = String(shownStep());
    el.dataset['drawer'] = drawer ?? '';
    el.dataset['loaded'] = String(pixels !== null);
  }

  /** 카드 밖에서 도구를 켜 덱이 옮겨왔을 때 도착한 것을 두 번 맥동시킨다. "화면이 혼자 움직였다" 가 아니라 "여기로 왔다" 로 읽히게 */
  const guideTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  function guide(...targets: (Element | undefined)[]): void {
    for (const t of targets) {
      if (!t) continue;
      t.classList.remove('is-guided');
      void (t as HTMLElement).offsetWidth;
      t.classList.add('is-guided');
      // 동작 줄이기 설정에서는 animationend 가 오지 않으므로 시간으로 푼다 (600ms × 2 보다 조금 길게)
      const prev = guideTimers.get(t);
      if (prev) clearTimeout(prev);
      guideTimers.set(t, setTimeout(() => t.classList.remove('is-guided'), 1300));
    }
  }

  /** 단계 칩: 어느 단계가 끝났고 지금 어디인지. 문구는 시험이 읽으므로 '확인 필요'·'다시 확인'·'확인됨' 을 지킨다 */
  function renderSteps(): void {
    const step = currentStep();
    const loaded = pixels !== null && sourceKind !== null;
    const scaleDone = scaleStatus === 'confirmed';
    const known = recognitionConfirmed();
    const origin = sourceKind === 'sample' ? '예시 도면' : sourceKind === 'saved' ? '저장한 도면' : '내 도면';
    originEl.innerHTML = loaded ? `<strong>${esc(origin)}</strong> · ${esc(sourceName)}` : '올리기 · 예시 체험';
    const states: Record<StepNo, { s: 'done' | 'current' | 'todo'; text: string }> = {
      1: { s: loaded ? 'done' : 'current', text: loaded ? '완료' : '' },
      2: {
        s: scaleDone ? 'done' : step === 2 ? 'current' : 'todo',
        text: scaleDone ? '확인됨' : scaleDeferred ? '나중에 확인 · 추정' : scaleStatus === 'auto' ? '읽음 · 확인 필요' : '확인 필요',
      },
      // 한 번 확인했더라도 그 뒤에 도면을 고쳤으면 그 확인은 지금 도면의 것이 아니다
      3: { s: known ? 'done' : step === 3 ? 'current' : 'todo', text: known ? '확인됨' : confirmedRev !== null ? '다시 확인' : '확인 필요' },
      4: { s: step === 4 ? 'current' : 'todo', text: step === 4 ? '지금' : '' },
    };
    for (const b of stepBtns) {
      const n = Number(b.dataset['step']) as StepNo;
      const st = states[n];
      b.dataset['state'] = st.s;
      const stateEl = b.querySelector('.plan3d__step-state');
      if (stateEl) stateEl.textContent = st.text;
      b.disabled = !loaded && n !== 1;
      if (n === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.setAttribute('aria-pressed', String(n === shownStep()));
    }
  }

  /** 덱: 보고 있는 카드 하나와 그 제목. 단계가 실제로 바뀌면 고정을 푼다 */
  function renderDeck(): void {
    const step = currentStep();
    if (step !== lastStep) {
      deckStep = null;
      lastStep = step;
    }
    const shown = shownStep();
    // 포커스가 곧 숨을 카드 안에 있으면 칩으로 옮긴다. 그냥 두면 body 로 떨어져 다음 Tab 이 문서 처음부터 시작한다
    const active = document.activeElement;
    const losing = cards.some((c) => Number(c.dataset['step']) !== shown && c.contains(active));
    for (const c of cards) c.hidden = Number(c.dataset['step']) !== shown;
    if (losing) stepBtnOf(shown)?.focus({ preventScroll: true });
    const pinned = deckStep !== null && deckStep !== step;
    // 값이 바뀔 때만 글자를 바꾼다. 덱에는 aria-live 를 두지 않아 카드 전환이 낭독되지 않는다
    const text = pinned ? `${STEP_NAME[shown]} — 지금 할 일은 ${STEP_NAME[step]}` : `지금 할 일 · ${STEP_TODO[step]}`;
    if (todoLabel.textContent !== text) todoLabel.textContent = text;
    todoBack.hidden = !pinned;

    // ② 카드: 축척 상태에 따라 주 행동이 달라진다
    const scaleModeBtn = modeBtnOf('scale');
    if (scaleModeBtn) {
      scaleModeBtn.textContent = scaleStatus === 'confirmed' ? '기준 길이 수정' : '실제 길이 맞추기';
      scaleModeBtn.classList.toggle('btn--accent', scaleStatus === 'assumed' || scaleStatus === 'estimated');
    }
    scaleConfirmBtn.hidden = scaleStatus !== 'auto';
    scaleLaterBtn.hidden = scaleStatus === 'confirmed' || scaleStatus === 'auto' || scaleDeferred;
    scaleBrief.hidden = !(scaleStatus === 'confirmed' || scaleDeferred);
    scaleBrief.textContent =
      scaleStatus === 'confirmed' ? `확인됨 · 1m = ${pxPerMeter.toFixed(1)}px · ${scaleSource ?? '직접 입력'}` : scaleDeferred ? '추정으로 진행 중' : '';

    // ③ 카드: 확인했으면 '맞아요' 대신 다시 확인하기
    const known = recognitionConfirmed();
    confirmBtn.hidden = known;
    reopenBtn.hidden = !known;

    // ④ 카드 문맥: 면적을 넣을 수 있는 상태인가
    help4.innerHTML = !caseReady
      ? '<strong>영업장 조건 입력하기</strong>를 누르면 ‘내 영업장’ 탭으로 갑니다. 기본 정보를 저장한 뒤 도면 탭으로 돌아오면 면적을 넣을 수 있습니다.'
      : scaleStatus === 'confirmed' && report
        ? `바닥 면적 ${esc(fmtArea(report.floorArea))} 를 영업장 면적으로 넣을 수 있습니다. 실측·공식 면적이 아니라 계산값입니다.`
        : '면적은 실제 길이가 확인된 뒤에만 넣을 수 있습니다 · 지금은 추정 <button type="button" class="link" data-action="scale-mode">실제 길이 맞추기</button>';
    syncRoot();
  }

  function renderJourney(): void {
    renderSteps();
    renderDeck();
  }

  /** 카드 문맥 줄: 모드에 맞는 도움말 하나 또는 입력칸 */
  function renderCtx(): void {
    help1.hidden = !saveForm.hidden;
    help2.hidden = !scaleForm.hidden;
    help3.hidden = !(mode === 'view' || mode === 'scale');
    helpErase.hidden = mode !== 'erase';
    editBox.hidden = mode !== 'add';
    doorBox.hidden = mode !== 'door';
    windowBox.hidden = mode !== 'window';
  }

  /** 되돌리기는 캔버스 곁에 둔다. 편집 중엔 항상, 둘러보기에서도 되돌릴 것이 남았으면 그것만 */
  function syncUndoHud(): void {
    undoBtn.disabled = undo.length === 0;
    undoBtn.textContent = mode === 'view' ? '마지막 편집 되돌리기' : '되돌리기';
    hudMode.hidden = mode === 'view' && undo.length === 0;
  }

  const W = (): number => pixels?.width ?? 0;
  const H = (): number => pixels?.height ?? 0;
  const thickPx = (): number => Math.max(2, Math.round((Number(thickMIn.value) || ASSUMED_WALL_M) * pxPerMeter));
  const metersOf = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]) / pxPerMeter;
  const doorPx = (): number => Math.max(2, Math.round((Number(doorMIn.value) || DEFAULT_DOOR_M) * pxPerMeter));
  const windowPx = (): number => Math.max(2, Math.round((Number(windowMIn.value) || DEFAULT_WINDOW_M) * pxPerMeter));

  async function ensureViewer(): Promise<Viewer> {
    if (viewer) return viewer;
    const { createViewer } = await import('../plan/viewer');
    const host = document.createElement('div');
    host.className = 'plan3d__canvas';
    stage.replaceChildren(host);
    stage.dataset['empty'] = 'false';
    viewer = await createViewer(host);
    viewer.setHeight(Number(heightIn.value));
    viewer.setFloorVisible(floorVisible);
    viewer.setInsets({ top: HUD_TOP_PX, bottom: HUD_BOTTOM_PX });
    viewer.setViewMode(viewMode);
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

  /**
   * 방 계산에서 막을 선분: 문 폭 이하의 개구부 후보와, 사용자가 놓은 문·창 전부.
   * 사용자가 놓은 것은 폭과 무관하게 막는다 — 넓은 창을 두고 방을 합칠 뜻은 없다.
   */
  function barriersOf(openings: readonly Opening[]): Barrier[] {
    const auto = openings.filter((o) => o.widthM <= DEFAULT_SEAL_M).map((o) => ({ a: o.a, b: o.b }));
    return [...auto, ...doorRects.map(barrierOfRect), ...windowRects.map(barrierOfRect)];
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

  const SCALE_TEXT: Record<ScaleStatus, { label: string; detail: (src: string | null) => string; action: string }> = {
    assumed: { label: '임시 추정 · 실제 길이 미설정', detail: () => `벽 두께 ${ASSUMED_WALL_M}m 가정`, action: '실제 길이 맞추기' },
    estimated: { label: '추정 · 표준 치수 기준', detail: (src) => src ?? '표준 치수로 어림', action: '실제 길이 맞추기' },
    auto: { label: '자동 인식 · 확인 필요', detail: (src) => src ?? '도면의 치수를 읽음', action: '읽은 치수 확인' },
    confirmed: { label: '사용자 확인 · 입력 치수 기준', detail: (src) => src ?? '직접 입력', action: '기준 길이 수정' },
  };

  /** 바닥 띠(항상 보임)와 서랍(열려 있을 때) */
  function renderAreas(): void {
    footEmpty.hidden = report !== null;
    if (!report) {
      areas.hidden = true;
      drawerBody.replaceChildren();
      renderJourney();
      return;
    }
    areas.hidden = false;
    const approximate = scaleStatus !== 'confirmed';
    const scale = SCALE_TEXT[scaleStatus];
    const detail = scale.detail(scaleSource);
    // 자동 인식은 ② 카드의 '읽은 치수 확인' 으로 보낸다. 확인 버튼이 두 곳에 있으면 하나만 상태를 바꾸는 것처럼 보인다
    const footLink =
      scaleStatus === 'auto'
        ? '<button type="button" class="link" data-action="step" data-step="2">읽은 치수 확인 →</button>'
        : `<button type="button" class="link" data-action="scale-mode">${esc(scale.action)}</button>`;
    const roomsBtn = report.rooms.length
      ? `<button type="button" class="btn btn--quiet btn--compact" data-action="drawer" data-drawer="rooms" aria-expanded="${drawer === 'rooms'}">구역 ${report.rooms.length}개</button>`
      : '<span class="plan3d__micro">닫힌 구역 없음 · 벽을 그어 방을 닫으세요</span>';
    areas.innerHTML = `
      <div class="plan3d__foot-main">
        <p class="plan3d__total">바닥 면적 <strong>${esc(fmtArea(report.floorArea, approximate))}</strong>
          <span class="plan3d__sub">· 벽 포함 ${esc(fmtArea(report.footprintArea, approximate))}</span></p>
        <p class="plan3d__scale-state"><strong>${esc(scale.label)}</strong><span class="plan3d__detail"> · ${esc(detail)} · 1m = ${pxPerMeter.toFixed(1)}px</span> ${footLink}</p>
      </div>
      <div class="plan3d__foot-actions">
        ${roomsBtn}
        <button type="button" class="btn btn--quiet btn--compact" data-action="area-import-open" aria-expanded="${drawer === 'import'}">면적 넣기</button>
      </div>`;
    if (drawer === 'rooms') {
      const rows = report.rooms
        .map((r, i) => {
          const on = highlightedRoom === r.id;
          return `<li><button type="button" class="plan3d__room" data-action="room-select" data-room="${r.id}" aria-pressed="${on}"><span class="plan3d__swatch" style="--hue:${[18, 200, 140, 280, 40, 320, 100, 240, 0, 170, 60, 300][i % 12]}"></span>
          <span>${on ? '● ' : ''}${esc(roomLabel(r.id, roomNames))}</span><span class="plan3d__room-area">${esc(fmtArea(r.area, approximate))}</span></button></li>`;
        })
        .join('');
      drawerBody.innerHTML = report.rooms.length
        ? `<ol class="plan3d__rooms">${rows}</ol><p class="plan3d__micro">구역을 누르면 도면에서 강조됩니다.</p>`
        : '<p class="plan3d__sub">닫힌 구역을 찾지 못했습니다. 벽을 그어 방을 닫으면 면적이 나옵니다.</p>';
      drawerTitle.textContent = `구역 ${report.rooms.length}개`;
    } else if (drawer === 'import') {
      drawerBody.innerHTML = renderImport(`${scale.label} · ${detail}`);
    }
    renderJourney();
  }

  /** 조건으로 가져갈 수 있는 면적 목록. 전체 바닥 면적과 구역 하나하나 */
  function areaChoices(): AreaChoice[] {
    if (!report) return [];
    return [
      { id: 'floor', label: '전체 바닥 면적', areaM2: report.floorArea },
      ...report.rooms.map((r) => ({ id: `room:${r.id}`, label: roomLabel(r.id, roomNames), areaM2: r.area })),
    ];
  }

  /**
   * 면적을 영업장 조건으로 가져오는 상자. 값·출처·추정 여부·넣을 항목을 보여 주고 따로 확인을 받는다.
   * 저절로 들어가면 계산값이 확인된 조건으로 둔갑하므로 누르기 전에는 아무것도 바꾸지 않는다.
   */
  function renderImport(origin: string): string {
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
  drawerBody.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLSelectElement) && !(t instanceof HTMLInputElement)) return;
    const ctl = t.dataset['ctl'];
    if (ctl === 'import-choice' && t instanceof HTMLSelectElement) importChoiceId = t.value;
    else if (ctl === 'import-target' && t instanceof HTMLSelectElement) importTargetKey = t.value;
    else if (ctl === 'import-ack' && t instanceof HTMLInputElement) importAck = t.checked;
    else return;
    renderAreas();
  });

  drawerBody.addEventListener('submit', (e) => {
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

  // ---- 서랍
  function renderDrawer(): void {
    drawerEl.hidden = drawer === null;
    advanced.hidden = drawer !== 'advanced';
    if (drawer === 'advanced') {
      drawerTitle.textContent = '인식 결과 조정';
      drawerBody.replaceChildren();
    } else if (drawer === 'import') {
      drawerTitle.textContent = '영업장 조건에 면적 넣기';
    } else if (drawer === null) {
      drawerBody.replaceChildren();
    }
    for (const b of el.querySelectorAll<HTMLElement>('[data-action="drawer"]')) b.setAttribute('aria-expanded', String(b.dataset['drawer'] === drawer));
    importOpenBtn.setAttribute('aria-expanded', String(drawer === 'import'));
    if (drawer === 'rooms' || drawer === 'import') renderAreas();
    else renderJourney();
    // 서랍이 덮는 만큼 도면을 위로 맞춘다. 조정 서랍은 슬라이더를 움직이는 동안 도면이 튀지 않게 그대로 둔다
    if (viewer && drawer !== 'advanced') {
      viewer.setInsets({ bottom: drawer ? Math.round(stage.clientHeight * 0.5) : HUD_BOTTOM_PX });
      viewer.fitView();
    }
    syncRoot();
  }

  function drawerToggle(next: Drawer): void {
    drawer = drawer === next ? null : next;
    renderDrawer();
  }

  function drawerClose(): void {
    if (drawer === null) return;
    drawer = null;
    renderDrawer();
  }

  /** 서랍이 열린 채 캔버스를 누르면 닫는다. preventDefault 하지 않아 그 클릭이 끌기 시작으로도 간다 */
  stage.addEventListener('pointerdown', () => {
    if (drawer !== null && drawer !== 'advanced') drawerClose();
  });

  function snapshot(): Snapshot | null {
    if (!mask) return null;
    return { mask: mask.slice(), doorRects: [...doorRects], windowRects: [...windowRects], roomNames: { ...roomNames }, pxPerMeter, scaleFixed, scaleStatus, scaleSource };
  }

  /** 편집·축척을 바꾸기 전에 부른다. 벽뿐 아니라 문·창·이름·축척도 함께 되돌린다 */
  function pushUndo(): void {
    const s = snapshot();
    if (!s) return;
    undo.push(s);
    if (undo.length > UNDO_LIMIT) undo.shift();
    rev++;
    syncUndoHud();
  }

  function popUndo(): void {
    const prev = undo.pop();
    if (!prev) return;
    mask = prev.mask;
    // 되돌린 마스크에 벽이 다시 생긴 자리는 더 이상 문·창이 아니다
    doorRects = prev.doorRects.filter((r) => !wallFills(prev.mask, r));
    windowRects = prev.windowRects.filter((r) => !wallFills(prev.mask, r));
    roomNames = prev.roomNames;
    const scaleChanged = prev.pxPerMeter !== pxPerMeter;
    pxPerMeter = prev.pxPerMeter;
    scaleFixed = prev.scaleFixed;
    scaleStatus = prev.scaleStatus;
    scaleSource = prev.scaleSource;
    viewer?.setDoors(doorRects);
    viewer?.setWindows(windowRects);
    rev++;
    syncUndoHud();
    // 되돌린 뒤에도 "벽을 추가했습니다" 가 남아 있으면 방금 한 일이 살아 있는 줄 안다
    say(undo.length ? `한 단계 되돌렸습니다. ${undo.length}단계 더 되돌릴 수 있습니다.` : '한 단계 되돌렸습니다. 더 되돌릴 것이 없습니다.');
    if (scaleChanged) applyScale();
    else rebuild();
    renderJourney();
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

  const rectOf = (a: Pt, b: Pt): Rect => ({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
  const rectPoly = (r: Rect): Pt[] => [[r.x0, r.y0], [r.x1, r.y0], [r.x1, r.y1], [r.x0, r.y1]];
  const rectsOverlap = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const rectHas = (r: Rect, p: Pt): boolean => p[0] >= r.x0 && p[0] < r.x1 && p[1] >= r.y0 && p[1] < r.y1;

  /** 사각형과 겹치는 문·창을 종류 불문 뺀다. 뺀 개수를 돌려준다. 되돌리기는 부르는 쪽이 챙긴다 */
  function dropOpenings(r: Rect): number {
    const before = doorRects.length + windowRects.length;
    doorRects = doorRects.filter((d) => !rectsOverlap(d, r));
    windowRects = windowRects.filter((d) => !rectsOverlap(d, r));
    return before - doorRects.length - windowRects.length;
  }

  const KIND_LABEL: Record<OpeningKind, string> = { door: '문', window: '창' };

  /** 문·창 자리 계산. 벽 위면 벽을 뚫고, 벽 사이 빈 자리면 그 틈에 놓는다 */
  function openingAt(kind: OpeningKind, start: Pt, p: Pt | null): PlacedOpening | null {
    if (!mask) return null;
    const widthPx = kind === 'door' ? doorPx() : windowPx();
    return placeOpening(mask, W(), H(), start, p, wallPx, widthPx, Math.round(MAX_GAP_M * pxPerMeter));
  }

  /** 문·창을 확정한다. 같은 자리에 있던 문·창은 새 것으로 바뀐다 */
  function commitOpening(kind: OpeningKind, start: Pt, p: Pt | null): void {
    if (!mask || !viewer) return;
    const placed = openingAt(kind, start, p);
    const label = KIND_LABEL[kind];
    if (!placed) {
      say(`벽도 벽 사이 틈도 없는 자리입니다. 끌어서 ${label} 폭을 그리세요.`, 'error');
      return;
    }
    pushUndo();
    if (placed.onWall) fillRect(mask, W(), H(), placed.rect, 0);
    const replaced = dropOpenings(placed.rect);
    (kind === 'door' ? doorRects : windowRects).push(placed.rect);
    viewer.setDoors(doorRects);
    viewer.setWindows(windowRects);
    const widthM = (placed.widthPx / pxPerMeter).toFixed(2);
    const how = placed.onWall ? `벽을 뚫어 ${label} ${widthM} m 를 냈습니다.` : `${label} ${widthM} m 를 놓았습니다.`;
    say(replaced ? `${how} 겹친 문·창 ${replaced}개는 바꿨습니다.` : how);
    rebuild();
  }

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
      } else if (mode === 'door' || mode === 'window') {
        const placed = openingAt(mode, dragStart, p);
        viewer.setGuide(placed ? rectPoly(placed.rect) : null, mode);
        say(placed ? `${KIND_LABEL[mode]} 폭 ${(placed.widthPx / pxPerMeter).toFixed(2)} m` : '끌어서 폭을 정하세요.');
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
          if (seg) {
            pushUndo();
            fillRect(mask, W(), H(), seg, 0);
            say(`벽 한 구간(${((seg.x1 - seg.x0 > seg.y1 - seg.y0 ? seg.x1 - seg.x0 : seg.y1 - seg.y0) / pxPerMeter).toFixed(2)} m)을 지웠습니다.`);
          } else {
            // 벽이 아니면 빈 자리에 놓은 문·창일 수 있다. 그것은 마스크에 없어 이렇게만 지운다
            const hit = [...doorRects, ...windowRects].find((r) => rectHas(r, p));
            if (!hit) { say('그 자리에 벽도 문·창도 없습니다.'); return; }
            pushUndo();
            dropOpenings(hit);
            say('문·창 하나를 지웠습니다.');
          }
        } else {
          pushUndo();
          const r = rectOf(start, p);
          fillRect(mask, W(), H(), r, 0);
          const dropped = dropOpenings(r);
          say(dropped ? `사각형 안의 벽과 문·창 ${dropped}개를 지웠습니다.` : '사각형 안의 벽을 지웠습니다.');
        }
        viewer.setDoors(doorRects);
        viewer.setWindows(windowRects);
        rebuild();
      } else if (mode === 'door' || mode === 'window') {
        commitOpening(mode, start, moved >= 3 ? p : null);
      } else if (mode === 'scale') {
        if (moved < 5) {
          say('끌어서 선을 그으세요. 길이를 아는 벽의 한쪽 끝에서 다른 쪽 끝까지.');
          return;
        }
        scaleLinePx = moved;
        // 다른 칩을 보고 있어도 폼은 ② 카드에 뜬다. 안 보이는 카드 안에서 포커스가 실패하면 안 된다
        deckStep = 2;
        renderJourney();
        scaleForm.hidden = false;
        renderCtx();
        scaleMIn.focus();
        say(`선을 그었습니다 (${moved.toFixed(0)} px). 실제 길이를 넣고 적용하세요.`);
        viewer.setGuide(wallOutline(start, p, 2 / (pxPerMeter / 30)), 'scale');
      }
    },
  };

  /**
   * 편집 모드를 바꾼다. 도구가 사는 카드로 덱을 옮기고, 캔버스 왼쪽 위 배지에 무엇을 하는 중인지 적는다.
   * guided 는 카드 밖(바닥 띠 링크·복구 버튼·④ 카드)에서 켰을 때 — 도착한 칩·버튼을 맥동시켜 알린다.
   */
  function setMode(next: Mode, opts: { guided?: boolean } = {}): void {
    const wasView = mode === 'view';
    mode = next;
    dragStart = null;
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset['mode'] === next));
    // 도구가 사는 카드로. 둘러보기로 돌아갈 때는 그대로 둔다 — 단계가 바뀌면 renderDeck 이 푼다
    if (next === 'scale') deckStep = 2;
    else if (next !== 'view') deckStep = 3;
    if (next !== 'scale') {
      scaleForm.hidden = true;
      scaleLinePx = 0;
      viewer?.setGuide(null);
    }
    hudBadge.textContent = next === 'scale' ? `② ${MODE_TITLE.scale}` : `③ ${MODE_TITLE[next]}`;
    hudBadge.dataset['step'] = next === 'scale' ? '2' : '3';
    hudBadge.hidden = next === 'view';
    finishEditBtn.hidden = next === 'view';
    syncUndoHud();
    renderCtx();
    viewer?.setEditing(next === 'view' ? null : editHandlers);
    // 편집은 평면에서 한다. 입체로 보면서 그으면 벽이 어디에 놓이는지 알기 어렵다
    if (wasView && next !== 'view') setViewMode('plan');
    // 편집 중엔 서랍이 도면을 가리지 않게 한다
    if (next !== 'view') drawerClose();
    renderJourney();
    if (opts.guided && next !== 'view') guide(modeBtnOf(next), hudBadge, stepBtnOf(deckStep ?? currentStep()));
  }

  /** 보는 방식을 바꾸고 버튼 상태를 맞춘다. 벽·축척·구역은 건드리지 않는다 — 카메라와 벽 높이만 바뀐다 */
  function setViewMode(next: ViewMode): void {
    viewMode = next;
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b.dataset['view'] === next));
    viewer?.setViewMode(next);
  }

  function setFloorVisible(next: boolean): void {
    floorVisible = next;
    floorBtn.setAttribute('aria-pressed', String(next));
    floorBtn.setAttribute('aria-label', next ? '원본 도면 표시' : '원본 도면 감춤');
    floorBtn.title = next ? '원본 도면 표시 (누르면 감춤)' : '원본 도면 감춤 (누르면 표시)';
    viewer?.setFloorVisible(next);
  }

  onAction(el, {
    mode: (b) => {
      const m = b.dataset['mode'];
      const hit = MODES.find((x) => x === m);
      if (hit) setMode(hit);
    },
    step: (b) => {
      const n = Number(b.dataset['step']);
      // 0 은 '지금 할 일로 돌아가기'. 지금 단계를 누르면 고정을 푼 것과 같다
      deckStep = n === 0 || n === currentStep() ? null : (n as StepNo);
      renderJourney();
    },
    undo: () => popUndo(),
    'finish-edit': () => {
      setMode('view');
      say('편집을 끝냈습니다.');
    },
    // 체험은 돈을 쓰지 않는다. 치수 자동 읽기는 사용자가 따로 누를 때만 부른다
    default: () => void loadDefault(false),
    'save-open': () => {
      if (!mask || waitIfBusy()) return;
      if (!userId) { actions.openLogin(); return; }
      nameIn.value = currentPlan?.name ?? nameIn.value;
      updateBtn.hidden = currentPlan === null;
      deckStep = 1;
      saveForm.hidden = false;
      renderCtx();
      renderJourney();
      guide(stepBtnOf(1));
      nameIn.focus();
    },
    'save-close': () => {
      saveForm.hidden = true;
      renderCtx();
    },
    'load-saved': () => { if (savedSel.value) void openSaved(savedSel.value); },
    'scale-read': () => void runScaleRead(),
    'scale-mode': () => setMode('scale', { guided: true }),
    'scale-retry': () => void runScaleRead(),
    'scale-redraw': () => {
      scaleForm.hidden = true;
      scaleLinePx = 0;
      viewer?.setGuide(null);
      renderCtx();
      say('도면 위에 선을 다시 그으세요.');
    },
    login: () => actions.openLogin(),
    'save-retry': () => { if (retrySave) void save(retrySave); },
    'scale-confirm': () => {
      if (scaleStatus !== 'auto') return;
      scaleStatus = 'confirmed';
      deckStep = null;
      renderAreas();
      guide(stepBtnOf(3), confirmBtn);
      say('자동으로 읽은 치수를 확인했습니다. 기준 길이는 언제든 수정할 수 있습니다.');
    },
    'recognition-confirm': () => {
      confirmedRev = rev;
      renderJourney();
      guide(stepBtnOf(4));
      say('도면 인식 결과를 확인했습니다. 벽이나 실제 길이를 바꾸면 다시 확인해 주세요.');
    },
    // '맞아요' 를 잘못 눌렀을 때의 되돌리기
    'recognition-reopen': () => {
      confirmedRev = null;
      renderJourney();
      say('인식 결과를 다시 확인합니다.');
    },
    'scale-later': () => {
      scaleDeferred = true;
      renderJourney();
      guide(stepBtnOf(3));
      say('실제 길이 확인을 미뤘습니다. 면적은 추정값으로 남고, 영업장 조건에는 넣을 수 없습니다.');
    },
    pick: () => onPick(),
    'recognition-edit': () => {
      setMode('add', { guided: true });
      say('벽 추가 상태입니다. 지우기·문·창문은 같은 줄에서 고르세요.');
    },
    'room-select': (b) => {
      const id = Number(b.dataset['room']);
      highlightedRoom = highlightedRoom === id ? null : id;
      viewer?.setHighlightedRoom(highlightedRoom);
      renderAreas();
    },
    drawer: (b) => {
      const d = b.dataset['drawer'];
      if (d === 'rooms' || d === 'import' || d === 'advanced') drawerToggle(d);
    },
    'drawer-close': () => drawerClose(),
    'area-import-open': () => {
      // 면적 넣기는 4단계의 일이다. 어느 단계에서 눌러도 ④ 카드로 데려가되, 막힌 이유는 상자 안에서 설명한다
      if (drawer !== 'import' && currentStep() !== 4) deckStep = 4;
      drawerToggle('import');
    },
    'area-import-close': () => drawerClose(),
    'open-case': () => {
      say('‘내 영업장’ 탭으로 갑니다. 기본 정보를 저장한 뒤 도면 탭으로 돌아오면 면적을 넣을 수 있습니다.');
      actions.startCase();
    },
    'delete-saved': () => { if (savedSel.value) void removeSaved(savedSel.value); },
    view: (b) => {
      const next = b.dataset['view'];
      if (next === 'plan' || next === '3d') setViewMode(next);
    },
    fit: () => viewer?.fitView(),
    floor: () => setFloorVisible(!floorVisible),
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
    say(`축척을 맞췄습니다. 1m = ${pxPerMeter.toFixed(1)} px. 되돌리려면 캔버스 왼쪽 위 되돌리기.`);
    setMode('view');
    // 축척 일을 마쳤으니 ② 고정을 풀어 ③ 카드로 간다. 이미 3단계였어도(나중에 확인·기준 길이 수정) 마찬가지다
    deckStep = null;
    renderJourney();
    guide(stepBtnOf(3), confirmBtn);
    stepBtnOf(3)?.focus({ preventScroll: true });
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
    lastOpenings = [];
    rev++;
    if (!scaleFixed) pxPerMeter = autoWallPx / ASSUMED_WALL_M;
    if (!scaleFixed) scaleStatus = 'assumed';
    if (userThick === null) thickIn.value = String(Math.min(40, wallPx));
    thickOut.value = String(wallPx);
    const v = await ensureViewer();
    v.setWalls(polygonsFromMask(mask, W(), H()));
    v.setModel(W(), H(), source, pxPerMeter);
    setViewMode('plan');
    windowRects = [];
    doorRects = [];
    roomNames = {};
    confirmedRev = null;
    scaleDeferred = false;
    v.setWindows([]);
    v.setDoors([]);
    // 마스크가 바뀌었으니 지난 방 목록은 버린다
    report = null;
    highlightedRoom = null;
    hudView.hidden = false;
    saveBtn.disabled = false;
    scaleBtn.disabled = false;
    saveForm.hidden = true;
    deckStep = null;
    syncUndoHud();
    renderCtx();
    scheduleRooms();
    renderJourney();
    const twoScale = thinPx === null ? '' : ` 벽이 두 가지로 그려져 있어 얇은 쪽(${thinPx}px)까지 잡았습니다.`;
    say(`벽을 세웠습니다.${twoScale} 끌어서 옮기고 휠로 확대합니다. 잘못 잡힌 벽은 ③ 벽·문 확인에서 고칩니다.`);
  }

  /** autoScale 이면 벽을 세운 뒤 치수선을 한 번 자동으로 읽는다 */
  async function load(file: File, autoScale = false): Promise<void> {
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
      drawerClose();
      setMode('view');
      await show();
      // 도면을 먼저 화면에 띄우고 치수는 그다음에 읽는다. 기다리며 빈 화면을 보여 주지 않는다
      if (autoScale) void runScaleRead({ auto: true });
      void gen;
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
    const annotations = JSON.stringify({ v: 1, doorRects, windowRects, roomNames });
    return { name, width: W(), height: H(), wallPx, pxPerMeter, scaleFixed, scaleStatus, wallHeightM: Number(heightIn.value), annotations, image, mask: maskBlob };
  }

  /** 저장본의 문·창·이름. 형식이 어긋난 항목은 그 항목만 비운다 (구버전 저장본은 null) */
  function readAnnotations(raw: unknown): { doorRects: Rect[]; windowRects: Rect[]; roomNames: Record<number, string> } {
    const out = { doorRects: [] as Rect[], windowRects: [] as Rect[], roomNames: {} as Record<number, string> };
    if (!raw || typeof raw !== 'object') return out;
    const o = raw as Record<string, unknown>;
    const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const rect = (v: unknown): Rect | null => {
      if (!v || typeof v !== 'object') return null;
      const r = v as Record<string, unknown>;
      const x0 = r['x0'];
      const y0 = r['y0'];
      const x1 = r['x1'];
      const y1 = r['y1'];
      return num(x0) && num(y0) && num(x1) && num(y1) ? { x0, y0, x1, y1 } : null;
    };
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
    if (!name || waitIfBusy()) return;
    busyWhy = '저장';
    setSaving(true);
    say(`“${name}” 으로 저장하는 중…`);
    try {
      const body = await payload(name);
      const detail = mode === 'update' && currentPlan ? await updatePlan(currentPlan.id, body) : await createPlan(body);
      currentPlan = { id: detail.id, name: detail.name };
      saveForm.hidden = true;
      renderCtx();
      await refreshSaved();
      savedSel.value = detail.id;
      retrySave = null;
      say(`"${detail.name}" 으로 저장했습니다.`);
    } catch (err) {
      console.warn('[plan] 도면 저장 실패', err);
      retrySave = mode;
      offerRecovery(describeFailure('save', failureInput(err), signedIn));
    } finally {
      busyWhy = null;
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
    if (waitIfBusy()) return;
    planGen++;
    busyWhy = '불러오기';
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
      rev++;
      const ann = readAnnotations(d.annotations);
      currentPlan = { id: d.id, name: d.name };
      sourceName = d.name;
      sourceKind = 'saved';
      confirmedRev = null;
      scaleDeferred = false;
      highlightedRoom = null;
      defaultTried = true;
      drawerClose();
      setMode('view');
      const v = await ensureViewer();
      v.setHeight(d.wallHeightM);
      v.setWalls(polygonsFromMask(mask, W(), H()));
      v.setModel(W(), H(), source, pxPerMeter);
      setViewMode('plan');
      windowRects = ann.windowRects;
      doorRects = ann.doorRects;
      roomNames = ann.roomNames;
      v.setWindows(windowRects);
      v.setDoors(doorRects);
      hudView.hidden = false;
      saveBtn.disabled = false;
      scaleBtn.disabled = false;
      saveForm.hidden = true;
      deckStep = null;
      syncUndoHud();
      renderCtx();
      scheduleRooms();
      renderJourney();
      say(`"${d.name}" 을 불러왔습니다.`);
    } catch (err) {
      say(`불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      busyWhy = null;
    }
  }

  async function removeSaved(id: string): Promise<void> {
    const target = saved.find((p) => p.id === id);
    if (!target || waitIfBusy()) return;
    if (!window.confirm(`"${target.name}" 도면을 지울까요? 되돌릴 수 없습니다.`)) return;
    busyWhy = '삭제';
    try {
      await deletePlan(id);
      if (currentPlan?.id === id) currentPlan = null;
      await refreshSaved();
      say(`"${target.name}" 을 지웠습니다.`);
    } catch (err) {
      say(`지우지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      busyWhy = null;
    }
  }

  saveForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const submitter = (e as SubmitEvent).submitter;
    void save(submitter instanceof HTMLButtonElement && submitter.dataset['save'] === 'update' ? 'update' : 'create');
  });

  /**
   * 치수선을 읽어 축척을 정한다. 벽 두께 가정보다 훨씬 정확하고, 면적은 축척의 제곱으로 움직이므로
   * 이것이 맞아야 나머지 수치가 쓸모 있다. 읽지 못하면 가정을 그대로 두고 조용히 넘어간다.
   */
  async function runScaleRead(opts: { auto?: boolean } = {}): Promise<void> {
    if (!source || !pixels) return;
    if (opts.auto ? busyWhy !== null : waitIfBusy()) return;
    const gen = planGen;
    busyWhy = '치수 읽기';
    scaleBtn.disabled = true;
    scaleBtn.textContent = '읽는 중…';
    if (!opts.auto) say('치수선을 읽는 중… (수십 초) · 다른 작업을 계속해도 됩니다.');
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
      // 보낸 그림 기준 축척을 마스크 기준으로 되돌린다. 직접 맞춘 축척을 덮을 수 있으니 되돌리기에 담는다
      pushUndo();
      if (res.estimate) {
        pxPerMeter = res.estimate.pxPerMeter / scale;
        scaleSource = `치수선 ${res.estimate.used}개`;
        scaleStatus = 'auto';
        const labels = res.estimate.labels.slice(0, 4).join(', ');
        say(`치수선으로 축척을 맞췄습니다. 1m = ${pxPerMeter.toFixed(1)}px (치수 ${res.estimate.used}개가 서로 맞음: ${labels}). 맞으면 '읽은 치수 확인' 을 누르세요.`);
      } else {
        // 치수선이 없는 도면이다. 벽 두께 0.2m 가정보다는 표준 치수 어림이 훨씬 낫다
        const g = res.guess as NonNullable<typeof res.guess>;
        pxPerMeter = g.pxPerMeter / scale;
        scaleSource = `표준 치수 ${g.used}개 어림`;
        scaleStatus = 'estimated';
        say(`치수선이 없어 표준 치수로 어림했습니다. 1m = ${pxPerMeter.toFixed(1)}px (${g.basis}). 어림이라 오차가 있습니다. 정확히 맞추려면 실제 길이 맞추기를 쓰세요.`);
      }
      scaleFixed = true;
      applyScale();
    } catch (err) {
      console.warn('[plan] 치수 읽기 실패', err);
      if (gen !== planGen || opts.auto) return;
      offerRecovery(describeFailure('scale', failureInput(err), signedIn));
    } finally {
      busyWhy = null;
      scaleBtn.disabled = mask === null;
      scaleBtn.textContent = '도면의 치수 자동 읽기';
    }
  }

  let defaultTried = false;
  /**
   * 기본 도면을 올린다. autoScale 은 사용자가 "예시 도면" 을 누른 경우에만 켠다.
   * 탭을 열 때의 자동 적재까지 치수를 읽으면 페이지를 열 때마다 유료 호출과 하루 한도가 소모된다.
   */
  async function loadDefault(autoScale = false): Promise<void> {
    defaultTried = true;
    say('기본 도면을 불러오는 중…');
    try {
      const res = await fetch(DEFAULT_PLAN_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await load(new File([blob], 'default.png', { type: blob.type || 'image/png' }), autoScale);
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

  const onKey = (e: KeyboardEvent): void => {
    // 도면 탭이 화면에 보이지 않으면 이 키는 우리 것이 아니다 (패널을 닫으면 붙어 있어도 안 보인다)
    if (!el.isConnected || el.getClientRects().length === 0) return;
    const t = e.target;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;
    if (e.key === 'Escape') {
      if (drawer !== null) {
        e.preventDefault();
        drawerClose();
      } else if (mode !== 'view') {
        e.preventDefault();
        setMode('view');
        say('편집을 끝냈습니다.');
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      // 입력칸에서는 글자 되돌리기다. 벽 되돌리기로 가로채지 않는다
      if (typing || undo.length === 0) return;
      e.preventDefault();
      popUndo();
    }
  };
  document.addEventListener('keydown', onKey);

  const onPick = (): void => input.click();
  document.addEventListener(PLAN_PICK_EVENT, onPick);

  renderCtx();
  renderJourney();

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
            importAck = false;
            drawerClose();
            say(`${label}에 ${importSent.value}㎡ 를 넣었습니다. ‘내 영업장’ 탭에서 확인하세요.`);
          } else {
            say(view?.message ?? '조건에 넣지 못했습니다. 다시 시도해 주세요.', 'error');
          }
          importSent = null;
        }
        if (report) renderAreas();
        else renderJourney();
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
      if (staleTimer) clearTimeout(staleTimer);
      viewer?.dispose();
      viewer = null;
    },
  };
}
