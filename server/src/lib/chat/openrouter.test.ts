import { describe, expect, it, vi } from 'vitest';
import { callChatModel, classifyStatus, ModelError } from './openrouter';

vi.mock('../env', () => ({ requireKey: () => 'test-key' }));

const ok = (content: string) =>
  new Response(JSON.stringify({ model: 'm', choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
const status = (code: number, headers: Record<string, string> = {}) => new Response('{}', { status: code, headers });
const noSleep = vi.fn(async () => {});
const run = (fetchImpl: typeof fetch, retries = 2) => callChatModel([{ role: 'user', content: 'q' }], { model: 'm', fetchImpl, retries, sleep: noSleep });

describe('OpenRouter 장애 처리 (ISS-026)', () => {
  it('429 는 retry-after 를 지켜 재시도한다', async () => {
    const f = vi.fn().mockResolvedValueOnce(status(429, { 'retry-after': '3' })).mockResolvedValueOnce(ok('{}'));
    const r = await run(f as never);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.001 });
    expect(noSleep).toHaveBeenLastCalledWith(3000);
  });

  it('5xx·네트워크 오류는 제한된 횟수만 재시도한다', async () => {
    const f = vi.fn().mockResolvedValue(status(503));
    await expect(run(f as never, 2)).rejects.toMatchObject({ kind: 'server', retryable: true });
    expect(f).toHaveBeenCalledTimes(3);
    const n = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(run(n as never, 1)).rejects.toMatchObject({ kind: 'network' });
    expect(n).toHaveBeenCalledTimes(2);
  });

  it('인증 실패·잔액 부족은 반복 호출하지 않는다', async () => {
    for (const [code, kind] of [[401, 'auth'], [403, 'auth'], [402, 'credit']] as const) {
      const f = vi.fn().mockResolvedValue(status(code));
      await expect(run(f as never)).rejects.toMatchObject({ kind, retryable: false });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it('200 안의 오류 본문도 오류로 본다', async () => {
    const body = new Response(JSON.stringify({ error: { code: 402, message: 'Insufficient credits' } }), { status: 200 });
    const f = vi.fn().mockResolvedValue(body);
    await expect(run(f as never)).rejects.toMatchObject({ kind: 'credit' });
  });

  it('본문 없는 응답은 잘못된 출력이다', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null } }] }), { status: 200 }));
    await expect(run(f as never)).rejects.toBeInstanceOf(ModelError);
  });

  it('상태 분류', () => {
    expect(classifyStatus(400)).toEqual({ kind: 'bad_request', retryable: false });
    expect(classifyStatus(500).retryable).toBe(true);
  });
});
