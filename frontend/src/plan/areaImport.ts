/**
 * 도면에서 잰 면적을 영업장 조건으로 가져올 때 쓰는 판단 (UX-002 · UX-005).
 *
 * 도면 면적은 인식한 벽과 구역으로 계산한 값이다. 실측도 공식 면적도 아니므로
 * 저절로 조건에 들어가서는 안 된다. 여기서는 가져올 수 있는지, 어떤 항목에 넣을 수 있는지,
 * 어떤 근거로 넣는지만 정한다. 화면 그리기와 저장은 부르는 쪽이 한다.
 */
import type { ScaleStatus } from '../api/plans';

/**
 * 도면에서 값을 가져올 수 있는 조건 항목.
 * 건물 연면적·지하층 면적처럼 건축물대장에서 확인해야 하는 항목은 뜻이 달라 넣지 않는다.
 */
export const IMPORT_TARGETS = [
  {
    key: 'business_area_m2',
    label: '영업장 바닥면적',
    hint: '이 도면이 학원이 쓰는 부분만 담고 있을 때 고르세요.',
  },
  {
    key: 'same_use_area_m2',
    label: '같은 건물의 학원 용도 바닥면적 합계',
    hint: '같은 건물의 다른 학원까지 더한 값일 때 고르세요.',
  },
] as const;

export type ImportTargetKey = (typeof IMPORT_TARGETS)[number]['key'];

export function isImportTarget(key: string): key is ImportTargetKey {
  return IMPORT_TARGETS.some((t) => t.key === key);
}

/** 가져올 수 있는 면적 한 건. 전체 바닥 면적이거나 구역 하나다 */
export interface AreaChoice {
  /** 전체는 'floor', 구역은 'room:<번호>' */
  readonly id: string;
  readonly label: string;
  readonly areaM2: number;
}

export interface ImportRequest {
  /** 고른 면적. 목록에 없으면 null */
  readonly choice: AreaChoice | null;
  /** 고른 조건 항목 */
  readonly targetKey: string;
  readonly scaleStatus: ScaleStatus;
  /** 조건 카드가 열려 있고 저장할 수 있는 상태인가 */
  readonly caseReady: boolean;
  /** 계산값임을 확인했다는 사용자의 표시 */
  readonly acknowledged: boolean;
}

export type ImportBlock = 'no-case' | 'scale-unconfirmed' | 'no-area' | 'no-target' | 'not-acknowledged';

export type ImportDecision =
  | { readonly ok: true; readonly key: ImportTargetKey; readonly value: number; readonly note: string }
  | { readonly ok: false; readonly block: ImportBlock; readonly message: string };

/** 조건에 넣는 면적은 0.1㎡ 단위로 맞춘다. 소수점이 길면 실측처럼 보인다 */
export function roundArea(m2: number): number {
  return Math.round(m2 * 10) / 10;
}

/** 조건 카드에 남길 출처 한 줄. 나중에 이 값이 어디서 왔는지 이 문구만 보고 알 수 있어야 한다 */
export function importNote(choice: AreaChoice, scaleSource: string | null): string {
  return `도면에서 가져옴 · ${choice.label} · 기준 길이 ${scaleSource ?? '사용자 확인'} · 인식한 벽과 구역으로 계산`;
}

/**
 * 가져올 수 있는지 판단한다. 막히는 이유는 하나씩만 알려 준다 — 화면에서 다음에 할 일이 분명해야 한다.
 * 축척을 사용자가 확인하기 전에는 가져오지 않는다. 추정값이 확인된 조건으로 둔갑하지 않게 하는 마지막 문이다.
 */
export function decideImport(req: ImportRequest, scaleSource: string | null): ImportDecision {
  if (!req.caseReady) {
    return { ok: false, block: 'no-case', message: '‘내 영업장’ 탭에서 조건 입력을 먼저 시작해 주세요.' };
  }
  if (req.scaleStatus !== 'confirmed') {
    return {
      ok: false,
      block: 'scale-unconfirmed',
      message: '실제 길이를 확인하기 전의 추정 면적은 조건으로 가져올 수 없습니다. 기준 길이를 확인해 주세요.',
    };
  }
  if (!req.choice || !(req.choice.areaM2 > 0)) {
    return { ok: false, block: 'no-area', message: '가져올 면적을 골라 주세요.' };
  }
  if (!isImportTarget(req.targetKey)) {
    return { ok: false, block: 'no-target', message: '이 면적을 넣을 조건 항목을 골라 주세요.' };
  }
  if (!req.acknowledged) {
    return { ok: false, block: 'not-acknowledged', message: '계산으로 얻은 값임을 확인해 주세요.' };
  }
  return { ok: true, key: req.targetKey, value: roundArea(req.choice.areaM2), note: importNote(req.choice, scaleSource) };
}
