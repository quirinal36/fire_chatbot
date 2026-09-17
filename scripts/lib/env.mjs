/**
 * 스크립트 공용 .env 읽기. process.env 가 우선한다.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

export function readEnv() {
  const env = {};
  const p = path.join(ROOT, '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && v !== '') env[k] = v;
  return env;
}
