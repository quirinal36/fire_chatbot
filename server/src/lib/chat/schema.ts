/**
 * 답변 계약 (기획서 §6.3 · ISS-014).
 *
 * 모델은 ChatAnswer 만 만든다. 판정(assessment)·출처 URL·버전 정보는 서버가 붙인다.
 */
import { z } from 'zod';

export const MAX_STATEMENTS = 8;

export const chatAnswerSchema = z.object({
  mode: z.enum(['legal_search', 'case_guidance']),
  summary: z.string().min(1).max(1000),
  statements: z
    .array(
      z.object({
        text: z.string().min(1).max(800),
        sourceIds: z.array(z.string()).max(6),
      }),
    )
    .max(MAX_STATEMENTS),
  followUpQuestions: z
    .array(z.object({ field: z.string().max(60), question: z.string().min(1).max(300) }))
    .max(4),
  limitations: z.array(z.string().max(400)).max(4),
});

export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

/** OpenRouter 구조화 출력용 JSON Schema. strict 모드는 모든 필드를 required 로 요구한다 */
export const CHAT_ANSWER_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'summary', 'statements', 'followUpQuestions', 'limitations'],
  properties: {
    mode: { type: 'string', enum: ['legal_search', 'case_guidance'] },
    summary: { type: 'string', maxLength: 1000, description: '질문에 대한 2~3문장 요약. 근거가 부족하면 그렇다고 말한다' },
    statements: {
      type: 'array',
      maxItems: MAX_STATEMENTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sourceIds'],
        properties: {
          text: { type: 'string' },
          sourceIds: { type: 'array', items: { type: 'string' }, description: '제공된 근거의 id (S1, S2 …)만' },
        },
      },
    },
    followUpQuestions: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'question'],
        properties: { field: { type: 'string' }, question: { type: 'string' } },
      },
    },
    limitations: { type: 'array', maxItems: 4, items: { type: 'string' } },
  },
} as const;

export type AssessmentStatus = 'applicable' | 'not_applicable' | 'needs_review';

export interface Assessment {
  readonly facility: string;
  readonly status: AssessmentStatus;
  readonly ruleId: string;
  readonly ruleSetVersion: string;
  /** 규칙 템플릿으로 만든 설명. 모델이 쓰지 않는다 */
  readonly explanation: string;
  readonly missingInputs: readonly string[];
  readonly sourceIds: readonly string[];
}

export interface EnvelopeSource {
  /** legal_units.id — GET /api/sources/:id 로 다시 조회한다 */
  readonly id: string;
  /** 답변 본문에서 쓰는 짧은 참조 (S1 …) */
  readonly ref: string;
  readonly title: string;
  readonly code: string | null;
  readonly locator: string;
  readonly heading: string | null;
  readonly excerpt: string;
  readonly effectiveDate: string | null;
  readonly versionStatus: string;
  readonly needsReview: boolean;
  /** 서버가 DB 값으로 만든 공식 화면 주소. 없으면 null */
  readonly url: string | null;
}

export type AnswerStatus = 'answered' | 'insufficient_evidence' | 'date_unclear' | 'fallback';

export interface AnswerEnvelope {
  readonly status: AnswerStatus;
  readonly answer: ChatAnswer;
  readonly assessment: readonly Assessment[];
  readonly sources: readonly EnvelopeSource[];
  readonly asOf: string;
  readonly pendingChanges: readonly { documentTitle: string; effectiveDate: string }[];
  readonly caseRevision: number | null;
  readonly corpusVersion: string;
  readonly disclaimer: string;
}

export const DISCLAIMER = 'AI 안내는 참고용입니다. 최종 판단은 관할 소방서의 확인을 거쳐야 합니다.';
