/**
 * 구조화 로그. 모든 출력은 redactSecrets 를 거친다.
 * 법령 API URL(OC)과 Authorization 헤더가 로그에 남지 않게 하는 것이 목적이다.
 */
import { secretValues } from './env';
import { redactSecrets } from './redact';

type Level = 'debug' | 'info' | 'warn' | 'error';

function serialize(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  return value;
}

export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  const entries = Object.entries(fields).map(([k, v]) => [k, serialize(v)]);
  const line = JSON.stringify({ level, message, ...Object.fromEntries(entries), at: new Date().toISOString() });
  const safe = redactSecrets(line, secretValues());
  if (level === 'error') console.error(safe);
  else if (level === 'warn') console.warn(safe);
  else console.log(safe);
}
