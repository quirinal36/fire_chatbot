/**
 * supabase/migrations/*.sql 을 순서대로 적용한다 (ISS-005).
 *
 * 실행: node scripts/db-migrate.mjs [--dry-run] [--sql "select 1"] [--file query.sql]
 * 필요: Supabase CLI 로그인(~/.supabase/access-token) 또는 SUPABASE_ACCESS_TOKEN
 *
 * DB 비밀번호 없이 Supabase Management API 의 SQL 실행 경로를 쓴다.
 * 파일 하나를 트랜잭션 하나로 적용하고 private.schema_migrations 에 기록한다.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnv } from './lib/env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'supabase', 'migrations');

const env = readEnv();
const ref = env.SUPABASE_PROJECT_REF ?? new URL(env.SUPABASE_URL).hostname.split('.')[0];
const token =
  process.env.SUPABASE_ACCESS_TOKEN ??
  fs.readFileSync(path.join(os.homedir(), '.supabase', 'access-token'), 'utf8').trim();

export async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SQL 실패 (${res.status}): ${body.slice(0, 2000)}`);
  return JSON.parse(body);
}

const quote = (s) => `'${s.replaceAll("'", "''")}'`;

async function main() {
  const args = process.argv.slice(2);
  const sqlAt = args.indexOf('--sql');
  const fileAt = args.indexOf('--file');
  if (sqlAt >= 0 || fileAt >= 0) {
    const query = sqlAt >= 0 ? args[sqlAt + 1] : fs.readFileSync(args[fileAt + 1], 'utf8');
    console.log(JSON.stringify(await runSql(query), null, 2));
    return;
  }
  const dryRun = args.includes('--dry-run');

  await runSql(`
    create schema if not exists private;
    revoke all on schema private from anon, authenticated;
    create table if not exists private.schema_migrations (
      version text primary key,
      name text not null,
      applied_at timestamptz not null default now()
    );`);

  const applied = new Set((await runSql('select version from private.schema_migrations')).map((r) => r.version));
  const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

  for (const file of files) {
    const version = file.split('_')[0];
    if (applied.has(version)) continue;
    console.log(`${dryRun ? '[dry-run] ' : ''}적용: ${file}`);
    if (dryRun) continue;
    const sql = fs.readFileSync(path.join(DIR, file), 'utf8');
    await runSql(
      `begin;\n${sql}\n;insert into private.schema_migrations (version, name) values (${quote(version)}, ${quote(file)});\ncommit;`,
    );
  }
  console.log('마이그레이션 완료');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
