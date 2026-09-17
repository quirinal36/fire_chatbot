import type { Conversation } from '../types';

/** 화면 확인용 초기 대화. 실제 서비스에서는 API 응답으로 대체합니다. */
export const initialConversations: readonly Conversation[] = [
  {
    id: 'c-sprinkler',
    title: '업무시설 신축 스프링클러 설치 검토',
    meta: '오늘 · 도면 1개',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        text: '지상 12층, 연면적 8,000㎡ 업무시설을 신축합니다. 스프링클러 설치 의무 대상인지, 첨부한 3층 평면도 기준으로 헤드 배치가 적정한지 검토해 주세요.',
        attachments: [{ name: '3층_평면도_v2.dwg', size: '2.4 MB', kind: 'drawing' }],
      },
      {
        id: 'm-2',
        role: 'assistant',
        paragraphs: [
          '네, **스프링클러설비 설치 의무 대상**입니다. 층수가 6층 이상인 특정소방대상물은 모든 층에 스프링클러설비를 설치해야 하므로, 12층 업무시설은 연면적과 무관하게 전층 설치 대상입니다.',
          '첨부하신 3층 평면도를 분석했습니다. 결과는 오른쪽 도면 패널에서 위치별로 확인할 수 있습니다.',
        ],
        lawRefs: [
          { id: 'l-1', label: '소방시설법 시행령 별표 4' },
          { id: 'l-2', label: '스프링클러설비 화재안전기준(NFPC 103)' },
          { id: 'l-3', label: '건축법 시행령 제34조' },
        ],
        bullets: [
          '사무실 A(서측)의 헤드 간격이 **3.4m**로, 내화구조 기준 수평거리 2.3m를 초과하는 구간이 있습니다.',
          '회의실 2곳은 헤드 배치가 적정합니다.',
          '동측 피난계단 전실에 헤드가 확인되지 않습니다. 설치 제외 대상 여부를 확인해 주세요.',
        ],
        actions: [
          { id: 'open-panel', label: '도면에서 보기' },
          { id: 'draft-opinion', label: '검토 의견서 초안 작성' },
        ],
        disclaimer: 'AI 검토 결과는 참고용이며, 최종 판단은 담당 공무원의 검토를 거쳐야 합니다.',
      },
    ],
  },
  {
    id: 'c-smoke',
    title: '지하주차장 제연설비 설치 기준',
    meta: '어제',
    messages: [],
  },
  {
    id: 'c-usechange',
    title: '용도변경(근생→의료) 소방시설 보완',
    meta: '9월 15일 · 도면 2개',
    messages: [],
  },
  {
    id: 'c-door',
    title: '피난계단 방화문 폐쇄장치 문의',
    meta: '9월 12일',
    messages: [],
  },
  {
    id: 'c-consent',
    title: '소방동의 대상 연면적 판단',
    meta: '9월 10일',
    messages: [],
  },
];
