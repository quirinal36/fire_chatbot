/**
 * 영업장 조건 카드와 설치 대상 판단 표 (ISS-020).
 * 판단은 서버 규칙 결과만 보여 준다. AI 설명과 섞지 않는다.
 */
import { esc } from '../lib/dom';
import type { CaseData, FieldDef, FieldPatch, FieldValue } from '../api/cases';
import type { CaseView } from '../types';

/**
 * 처음 들어온 사람이 먼저 답할 기본 정보. 여기부터 묻고, 판단 규칙이 더 요구하는 항목을 이어서 묻는다.
 * 한 번에 스무 개를 늘어놓으면 어디서부터 손댈지 모른다.
 */
const BASIC_KEYS: readonly string[] = ['business_kind', 'business_floor', 'business_area_m2', 'capacity', 'is_evacuation_floor'];

const GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: '영업장', keys: ['business_kind', 'business_floor', 'is_evacuation_floor', 'business_area_m2', 'same_use_area_m2', 'capacity'] },
  {
    title: '건물 (건축물대장 기준)',
    keys: ['building_total_area_m2', 'building_floors_above', 'building_floors_below', 'basement_windowless_max_area_m2', 'upper_floor_max_area_m2', 'nlf_area_total_m2'],
  },
  { title: '같은 건물의 다른 시설', keys: ['has_dormitory', 'academies_capacity_total', 'other_multiuse_in_building', 'fire_compartment_separated'] },
  { title: '적용 시점', keys: ['event_type', 'existing_has_sprinkler', 'event_date'] },
];

/** 조건 카드에서 받는 항목 키. 되묻기에서 이 항목은 조건 입력 칸으로 보낸다 (ISS-036) */
export const CASE_FIELD_KEYS: readonly string[] = GROUPS.flatMap((g) => g.keys);

const STATUS = {
  applicable: { label: '해당', tone: 'flag' },
  not_applicable: { label: '비해당', tone: 'pass' },
  needs_review: { label: '추가 확인', tone: 'flag' },
} as const;

const STATE_LABEL = { user_confirmed: '확인됨', extracted: '질문에서 읽음 · 확인 필요', unknown: '모름' } as const;

function display(def: FieldDef, v: FieldValue | undefined): string {
  if (!v || v.value === null || v.value === undefined) return '';
  if (def.kind === 'boolean') return v.value ? '예' : '아니오';
  if (def.kind === 'enum') return def.options?.find((o) => o.value === v.value)?.label ?? String(v.value);
  return `${v.value}${def.unit ?? ''}`;
}

function input(def: FieldDef, v: FieldValue | undefined, needed: boolean): string {
  const confirmed = v?.state === 'user_confirmed' && v.value !== null && v.value !== undefined ? v.value : null;
  const name = `f:${def.key}`;
  const id = `case-${def.key}`;
  let control: string;
  if (def.kind === 'boolean' || def.kind === 'enum') {
    const options =
      def.kind === 'boolean'
        ? [
            { value: 'true', label: '예' },
            { value: 'false', label: '아니오' },
          ]
        : (def.options ?? []);
    control = `<select id="${id}" name="${name}" data-kind="${def.kind}" data-initial="${esc(confirmed === null ? '' : String(confirmed))}"${def.key === 'business_kind' ? ' autofocus' : ''}>
      <option value="">모름</option>
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(confirmed) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else {
    const type = def.kind === 'date' ? 'date' : 'number';
    const step = def.kind === 'integer' ? '1' : 'any';
    control = `<span class="case__input"><input id="${id}" name="${name}" type="${type}" step="${step}" data-kind="${def.kind}"
      ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''}${def.key === 'business_kind' ? ' autofocus' : ''}
      value="${esc(confirmed === null ? '' : String(confirmed))}" data-initial="${esc(confirmed === null ? '' : String(confirmed))}"
      placeholder="모름" />${def.unit ? `<span>${esc(def.unit)}</span>` : ''}</span>`;
  }

  const state = v?.state ?? 'unknown';
  const extracted =
    state === 'extracted'
      ? `<span class="case__hint">질문에서 “${esc(display(def, v))}”으로 읽었습니다${v?.note ? ` · ${esc(v.note)}` : ''}
          <button type="button" class="link" data-action="confirm-field" data-key="${esc(def.key)}">맞아요</button></span>`
      : // 확인한 값에도 출처가 있으면 남긴다. 도면에서 가져온 값은 계산값임을 계속 알 수 있어야 한다
        state === 'user_confirmed' && v?.note
        ? `<span class="case__hint">${esc(v.note)}</span>`
        : '';

  // 묻는 말을 앞에 둔다. 전문 명칭(피난층·연면적)은 그 아래에 보조로만 남긴다
  return `<div class="case__row${needed ? ' case__row--needed' : ''}" data-field="${esc(def.key)}">
    <label for="${id}">${esc(def.question)}${needed ? ' <span class="tag tag--flag">필요</span>' : ''}</label>
    ${control}
    <span class="tag ${state === 'user_confirmed' ? '' : 'tag--quiet'}">${STATE_LABEL[state]}</span>
    ${extracted}
    <span class="case__help">${esc(def.label)}${def.unit ? ` (${esc(def.unit)})` : ''}</span>
  </div>`;
}

export function renderCaseCard(view: CaseView | undefined, defs: readonly FieldDef[], hasConversation: boolean): string {
  if (!view) {
    return `<div class="case case--empty">
      <p>건물·영업장 조건을 입력하면 검토된 규칙으로 <strong>어떤 소방시설이 필요한지</strong> 확인할 수 있습니다.</p>
      <p class="panel__note">현재는 교육서비스 학원만 지원합니다. 입력하지 않아도 법령 질문은 할 수 있습니다.</p>
      <button type="button" class="btn btn--primary" data-action="start-case" ${hasConversation ? '' : 'disabled'}>내 학원 조건 입력하기</button>
    </div>`;
  }
  if (!view.data) {
    return view.state === 'error'
      ? `<p class="panel__note tone-flag">${esc(view.message ?? '영업장 정보를 불러오지 못했습니다.')} <button type="button" class="link" data-action="reload-case">다시 불러오기</button></p>`
      : '<p class="panel__note">영업장 정보를 불러오는 중…</p>';
  }

  const data: CaseData = view.data;
  const a = data.assessment;
  const needed = new Set(a.questions.map((q) => q.field));
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const field = (k: string): string => {
    const def = byKey.get(k);
    return def ? input(def, data.fields[k], needed.has(k)) : '';
  };

  const ruleNote = !a.ruleSet
    ? '<p class="panel__note tone-flag">담당자 승인을 마친 판단 규칙이 아직 없어 설치 대상 여부를 표시하지 않습니다. 법령 근거 안내만 제공합니다.</p>'
    : a.ruleSet.preview
      ? `<p class="panel__note tone-flag">검토 전 규칙(${esc(a.ruleSet.version)})으로 계산한 개발용 결과입니다. 담당자 승인 전이므로 실제 판단에 쓰지 마세요.</p>`
      : `<p class="panel__note">판단 규칙 ${esc(a.ruleSet.version)} · 조건 revision ${data.revision}</p>`;

  // 1) 기본 정보 → 2) 규칙이 더 요구하는 항목 → 3) 나머지는 접어 둔다.
  // 한 번도 저장하지 않았으면 규칙은 거의 모든 항목을 요구한다. 그것을 그대로 펼치면 처음 화면이 스무 칸이 된다.
  // 기본 정보를 한 번 저장한 뒤에 "그래서 더 필요한 것" 을 묻는다 (사례를 만들 때 업종이 들어가므로 revision 1 이 시작점이다)
  const started = data.revision > 1;
  const basics = BASIC_KEYS.filter((k) => byKey.has(k));
  const extras = started ? CASE_FIELD_KEYS.filter((k) => byKey.has(k) && !basics.includes(k) && needed.has(k)) : [];
  const restGroups = GROUPS.map((g) => ({
    title: g.title,
    keys: g.keys.filter((k) => byKey.has(k) && !basics.includes(k) && !extras.includes(k)),
  })).filter((g) => g.keys.length > 0);

  const form = defs.length
    ? `<fieldset class="case__group"><legend>기본 정보</legend>${basics.map(field).join('')}</fieldset>
       ${extras.length ? `<fieldset class="case__group case__group--needed"><legend>판단에 더 필요한 항목 ${extras.length}개</legend>${extras.map(field).join('')}</fieldset>` : ''}
       ${
         restGroups.length
           ? `<details class="case__more"><summary>그 밖의 항목 (${restGroups.reduce((n, g) => n + g.keys.length, 0)}개)</summary>
              ${restGroups.map((g) => `<fieldset class="case__group"><legend>${esc(g.title)}</legend>${g.keys.map(field).join('')}</fieldset>`).join('')}
            </details>`
           : ''
       }`
    : '<p class="panel__note">입력 항목을 불러오는 중…</p>';

  const missing = !a.questions.length
    ? '<p class="case__missing">입력한 조건으로 판단할 수 있습니다. 값을 바꾸면 결과도 다시 계산합니다.</p>'
    : started
      ? `<p class="case__missing">아래 <strong>${a.questions.length}개 항목</strong>이 더 필요합니다. 모르면 ‘모름’으로 남겨도 됩니다 — 모름은 ‘아니오’나 ‘0’으로 보지 않습니다.</p>`
      : '<p class="case__missing">먼저 <strong>기본 정보</strong>부터 채우고 저장하세요. 그 값으로 무엇이 더 필요한지 골라서 알려 드립니다. 모르면 ‘모름’으로 남겨도 됩니다.</p>';

  // ---- 결과: 확인한 조건 → 시설별 결과 → 더 필요한 정보 → 근거 법령
  const confirmed = CASE_FIELD_KEYS.map((k) => ({ def: byKey.get(k), v: data.fields[k] }))
    .filter((x): x is { def: FieldDef; v: FieldValue } => x.def !== undefined && x.v?.state === 'user_confirmed' && x.v.value !== null && x.v.value !== undefined)
    .map((x) => `<li><span>${esc(x.def.label)}</span> <strong>${esc(display(x.def, x.v))}</strong>${x.v.note ? `<span class="check__why">${esc(x.v.note)}</span>` : ''}</li>`)
    .join('');

  const useClass = a.results.find((r) => r.ruleKey === 'use_class');
  const results = a.results
    .filter((r) => r.ruleKey !== 'use_class')
    .map((r) => {
      const st = STATUS[r.status];
      return `<li class="check">
        <span class="check__dot" style="background: var(--${st.tone === 'pass' ? 'success' : 'accent'})"></span>
        <span class="check__label">${esc(r.facility)}
          <span class="check__why">${esc(r.explanation)}</span>
        </span>
        <span class="check__status tone-${st.tone}">${st.label}</span>
      </li>`;
    })
    .join('');

  // 설비마다 같은 경고를 반복하지 않고, 채워야 할 입력만 모아서 보여 준다. 길면 앞쪽만
  const ASK_LIMIT = 6;
  const asks = a.questions
    .slice(0, ASK_LIMIT)
    .map((q) => {
      const def = byKey.get(q.field);
      return `<li>${esc(def?.question ?? q.question)}
        <button type="button" class="link" data-action="focus-field" data-key="${esc(q.field)}">입력하러 가기</button></li>`;
    })
    .join('');
  const askRest = a.questions.length > ASK_LIMIT ? `<p class="panel__note">그 밖에 ${a.questions.length - ASK_LIMIT}개 항목이 더 필요합니다. 위 양식에서 이어서 채우세요.</p>` : '';

  // 근거 법령은 결과에서 모은다. 같은 조문이 여러 시설에 걸리면 한 번만 보여 준다
  const sourceIds = [...new Set(a.results.flatMap((r) => r.sourceUnitIds))];
  const sources = sourceIds
    .map((id, i) => `<button type="button" class="link" data-action="open-source" data-source="${esc(id)}">조문 ${i + 1}</button>`)
    .join(' ');

  return `<div class="case">
    ${ruleNote}
    <form class="case__form" data-revision="${data.revision}">
      <p class="case__title">영업장 조건</p>
      ${missing}
      ${form}
      ${view.message ? `<p class="panel__note" role="status">${esc(view.message)}</p>` : ''}
      <div class="case__actions">
        <button type="submit" class="btn btn--primary btn--compact" ${view.state === 'saving' ? 'disabled' : ''}>${view.state === 'saving' ? '저장 중…' : '저장하고 다시 판단'}</button>
      </div>
      <p class="panel__note">최종 판단은 관할 소방서 확인이 필요합니다. 입력한 값은 이 대화에만 저장됩니다.</p>
    </form>
    <section class="case__results" aria-label="판단 결과">
      <p class="case__title">확인한 조건</p>
      ${confirmed ? `<ul class="case__confirmed">${confirmed}</ul>` : '<p class="panel__note">아직 확인한 값이 없습니다. 위에서 입력하고 저장하세요.</p>'}
      ${useClass ? `<p class="panel__note">분류: ${esc(useClass.explanation)}</p>` : ''}

      <p class="case__title">시설별 결과</p>
      ${results ? `<ul class="check-list">${results}</ul>` : '<p class="panel__note">판단 결과가 아직 없습니다.</p>'}

      <p class="case__title">더 필요한 정보</p>
      ${asks ? `<ul class="case__asks">${asks}</ul>${askRest}` : '<p class="panel__note">지금 조건으로 판단할 수 있습니다.</p>'}

      <p class="case__title">근거 법령</p>
      ${sources ? `<p class="panel__note">${sources}</p>` : '<p class="panel__note">판단에 쓴 조문이 여기에 표시됩니다.</p>'}
    </section>
  </div>`;
}

/** 양식에서 바뀐 항목만 모은다 */
export function collectPatch(form: HTMLFormElement): FieldPatch {
  const patch: FieldPatch = {};
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[name^="f:"]'))) {
    const key = el.name.slice(2);
    const raw = el.value.trim();
    if (raw === (el.dataset['initial'] ?? '')) continue;
    if (raw === '') {
      patch[key] = { value: null, state: 'unknown', note: null };
      continue;
    }
    const kind = el.dataset['kind'];
    const value = kind === 'number' || kind === 'integer' ? Number(raw) : kind === 'boolean' ? raw === 'true' : raw;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    // 직접 고친 값이므로 도면·질문에서 온 옛 출처는 지운다
    patch[key] = { value, state: 'user_confirmed', note: null };
  }
  return patch;
}
