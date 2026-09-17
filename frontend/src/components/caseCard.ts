/**
 * 영업장 조건 카드와 설치 대상 판단 표 (ISS-020).
 * 판단은 서버 규칙 결과만 보여 준다. AI 설명과 섞지 않는다.
 */
import { esc } from '../lib/dom';
import type { CaseData, FieldDef, FieldPatch, FieldValue } from '../api/cases';
import type { CaseView } from '../types';

const GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  { title: '영업장', keys: ['business_kind', 'business_floor', 'is_evacuation_floor', 'business_area_m2', 'same_use_area_m2', 'capacity'] },
  {
    title: '건물 (건축물대장 기준)',
    keys: ['building_total_area_m2', 'building_floors_above', 'building_floors_below', 'basement_windowless_max_area_m2', 'upper_floor_max_area_m2', 'nlf_area_total_m2'],
  },
  { title: '같은 건물의 다른 시설', keys: ['has_dormitory', 'academies_capacity_total', 'other_multiuse_in_building', 'fire_compartment_separated'] },
  { title: '적용 시점', keys: ['event_type', 'existing_has_sprinkler', 'event_date'] },
];

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
    control = `<select id="${id}" name="${name}" data-kind="${def.kind}" data-initial="${esc(confirmed === null ? '' : String(confirmed))}">
      <option value="">모름</option>
      ${options.map((o) => `<option value="${esc(o.value)}" ${String(confirmed) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}
    </select>`;
  } else {
    const type = def.kind === 'date' ? 'date' : 'number';
    const step = def.kind === 'integer' ? '1' : 'any';
    control = `<span class="case__input"><input id="${id}" name="${name}" type="${type}" step="${step}" data-kind="${def.kind}"
      ${def.min !== undefined ? `min="${def.min}"` : ''} ${def.max !== undefined ? `max="${def.max}"` : ''}
      value="${esc(confirmed === null ? '' : String(confirmed))}" data-initial="${esc(confirmed === null ? '' : String(confirmed))}"
      placeholder="모름" />${def.unit ? `<span>${esc(def.unit)}</span>` : ''}</span>`;
  }

  const state = v?.state ?? 'unknown';
  const extracted =
    state === 'extracted'
      ? `<span class="case__hint">질문에서 “${esc(display(def, v))}”으로 읽었습니다${v?.note ? ` · ${esc(v.note)}` : ''}
          <button type="button" class="link" data-action="confirm-field" data-key="${esc(def.key)}">맞아요</button></span>`
      : '';

  return `<div class="case__row${needed ? ' case__row--needed' : ''}">
    <label for="${id}">${esc(def.label)}${needed ? ' <span class="tag tag--flag">필요</span>' : ''}</label>
    ${control}
    <span class="tag ${state === 'user_confirmed' ? '' : 'tag--quiet'}">${STATE_LABEL[state]}</span>
    ${extracted}
    <span class="case__help">${esc(def.question)}</span>
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

  const ruleNote = !a.ruleSet
    ? '<p class="panel__note tone-flag">담당자 승인을 마친 판단 규칙이 아직 없어 설치 대상 여부를 표시하지 않습니다. 법령 근거 안내만 제공합니다.</p>'
    : a.ruleSet.preview
      ? `<p class="panel__note tone-flag">검토 전 규칙(${esc(a.ruleSet.version)})으로 계산한 개발용 결과입니다. 담당자 승인 전이므로 실제 판단에 쓰지 마세요.</p>`
      : `<p class="panel__note">판단 규칙 ${esc(a.ruleSet.version)} · 조건 revision ${data.revision}</p>`;

  const results = a.results
    .filter((r) => r.ruleKey !== 'use_class')
    .map((r) => {
      const st = STATUS[r.status];
      return `<li class="check">
        <span class="check__dot" style="background: var(--${st.tone === 'pass' ? 'success' : 'accent'})"></span>
        <span class="check__label">${esc(r.facility)}
          <span class="check__why">${esc(r.explanation)}</span>
          ${r.sourceUnitIds.length ? `<span class="check__why">근거: ${r.sourceUnitIds.map((id, i) => `<button type="button" class="link" data-action="open-source" data-source="${esc(id)}">조문 ${i + 1}</button>`).join(' ')}</span>` : ''}
        </span>
        <span class="check__status tone-${st.tone}">${st.label}</span>
      </li>`;
    })
    .join('');

  const useClass = a.results.find((r) => r.ruleKey === 'use_class');
  const classNote = useClass ? `<p class="panel__note">분류: ${esc(useClass.explanation)}</p>` : '';

  const form = defs.length
    ? GROUPS.map(
        (g) => `<fieldset class="case__group"><legend>${esc(g.title)}</legend>
          ${g.keys
            .map((k) => byKey.get(k))
            .filter((d): d is FieldDef => d !== undefined)
            .map((d) => input(d, data.fields[d.key], needed.has(d.key)))
            .join('')}
        </fieldset>`,
      ).join('')
    : '<p class="panel__note">입력 항목을 불러오는 중…</p>';

  return `<div class="case">
    ${ruleNote}
    ${classNote}
    ${results ? `<ul class="check-list">${results}</ul>` : ''}
    <form class="case__form" data-revision="${data.revision}">
      <p class="case__title">영업장 조건</p>
      ${form}
      ${view.message ? `<p class="panel__note" role="status">${esc(view.message)}</p>` : ''}
      <div class="case__actions">
        <button type="submit" class="btn btn--primary btn--compact" ${view.state === 'saving' ? 'disabled' : ''}>${view.state === 'saving' ? '저장 중…' : '저장하고 다시 판단'}</button>
      </div>
      <p class="panel__note">최종 판단은 관할 소방서 확인이 필요합니다. 입력한 값은 이 대화에만 저장됩니다.</p>
    </form>
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
      patch[key] = { value: null, state: 'unknown' };
      continue;
    }
    const kind = el.dataset['kind'];
    const value = kind === 'number' || kind === 'integer' ? Number(raw) : kind === 'boolean' ? raw === 'true' : raw;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    patch[key] = { value, state: 'user_confirmed' };
  }
  return patch;
}
