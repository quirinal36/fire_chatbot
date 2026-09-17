import type { Conversation } from '../types';

/** 화면 확인용 초기 대화. 실제 서비스에서는 API 응답으로 대체합니다. */
export const initialConversations: readonly Conversation[] = [
  {
    id: 'c-sprinkler',
    title: '업무시설 신축 스프링클러 설치 검토',
    meta: '오늘',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        text: '지상 12층, 연면적 8,000㎡ 업무시설을 신축합니다. 스프링클러설비 설치 의무 대상인지, 그렇다면 어느 층까지 설치해야 하는지 알려 주세요.',
      },
      {
        id: 'm-2',
        role: 'assistant',
        paragraphs: [
          '네, **스프링클러설비 설치 의무 대상**입니다. 층수가 6층 이상인 특정소방대상물은 모든 층에 스프링클러설비를 설치해야 하므로, 12층 업무시설은 연면적과 무관하게 전층 설치 대상입니다.',
          '근거 조문과 확인이 필요한 항목은 오른쪽 검토 패널에 정리했습니다.',
        ],
        lawRefs: [
          { id: 'l-1', label: '소방시설법 시행령 별표 4' },
          { id: 'l-2', label: '스프링클러설비 화재안전기준(NFPC 103)' },
          { id: 'l-3', label: '건축법 시행령 제34조' },
        ],
        bullets: [
          '층수가 **6층 이상**이면 연면적과 무관하게 **전층**이 설치 대상입니다.',
          '헤드의 수평거리 기준은 내화구조 **2.3m 이하**입니다. 구조 형식에 따라 달라집니다.',
          '피난계단 전실 등 설치 제외 대상에 해당하는지는 별도로 확인해야 합니다.',
        ],
        actions: [{ id: 'draft-opinion', label: '검토 의견서 초안 작성' }],
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
    meta: '9월 15일',
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
