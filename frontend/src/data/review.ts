import type { Review } from '../types';

/**
 * 도면 패널이 보여주는 검토 결과.
 * 법령 문구는 예시입니다. 국가법령정보센터 연동 후 실제 조문으로 교체하세요.
 */
export const sampleReview: Review = {
  planTitle: '3층 평면도 · 스프링클러 헤드 검토',
  planScale: '1:200',

  stats: [
    { label: '전체 헤드', value: '24' },
    { label: '간격 초과', value: '4', tone: 'flag' },
    { label: '미설치 구역', value: '1', tone: 'flag' },
  ],

  laws: [
    {
      source: '소방시설 설치 및 관리에 관한 법률 시행령 별표 4',
      text: '스프링클러설비를 설치해야 하는 특정소방대상물: 층수가 6층 이상인 특정소방대상물의 경우에는 모든 층 …',
    },
    {
      source: '스프링클러설비의 화재안전성능기준(NFPC 103)',
      text: '스프링클러헤드를 설치하는 천장·반자 등 각 부분으로부터 하나의 헤드까지의 수평거리: 내화구조 2.3m 이하 …',
    },
  ],

  checks: [
    { label: '스프링클러 설치 의무 대상 여부', status: '대상', tone: 'pass' },
    { label: '헤드 수평거리 (내화구조 2.3m 이하)', status: '초과 4개', tone: 'flag' },
    { label: '피난계단 전실 헤드 설치', status: '확인 필요', tone: 'flag' },
    { label: '소화기 배치 (보행거리 20m 이내)', status: '적정', tone: 'pass' },
  ],
};
