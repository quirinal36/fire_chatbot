/**
 * DB·원문 백업과 복원 (ISS-030)
 *
 *   node scripts/backup.mjs backup                          # backups/<일시>/ 에 테이블·원문 저장
 *   node scripts/backup.mjs verify backups/<일시>           # 임시 스키마에 복원해 건수·체크섬 대조 후 삭제
 *   node scripts/backup.mjs restore backups/<일시> --confirm # 빈 운영 DB(마이그레이션 적용 직후)에 복원
 *
 * pg_dump 가 없는 환경에서도 쓸 수 있도록 Supabase Management API 로 내보낸다.
 * 검색 조각·임베딩(search_chunks, embedding_cache)은 원문에서 다시 만들 수 있어 제외한다.
 * 복원 뒤 `cd server && npm run index-corpus` 로 다시 만든다 (전체 약 $0.03).
 *
 * 백업 파일에는 대화·신고 등 사용자 데이터가 들어 있다. 저장소에 올리지 않는다 (.gitignore).
 * Supabase Pro 로 옮기면 일일 자동 백업을 함께 쓴다. 이 스크립트는 그와 별개인 이동 가능한 사본이다.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readEnv } from './lib/env.mjs';
import { runSql } from './db-migrate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = readEnv();
const BUCKET = 'raw-sources';

/** 외래키 순서대로. 부모가 먼저 온다 */
const TABLES = [
  ['legal_documents', 'id'],
  ['legal_versions', 'id'],
  ['legal_units', 'version_id, ordinal, id'],
  ['legal_relations', 'id'],
  ['source_files', 'id'],
  ['rule_sets', 'id'],
  ['rules', 'id'],
  ['rule_sources', 'rule_id, legal_unit_id, role'],
  ['admin_users', 'user_id'],
  ['building_cases', 'id'],
  ['chat_sessions', 'id'],
  ['answer_runs', 'id'],
  ['chat_messages', 'created_at, id'],
  ['ingestion_jobs', 'id'],
  ['review_events', 'id'],
  ['feedback', 'id'],
  ['usage_counters', 'scope, day'],
];
const PAGE = 1000;

const sha = (s) => createHash('sha256').update(s).digest('hex');

async function exportTable(table, order) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const [r] = await runSql(
      `select coalesce(json_agg(t), '[]'::json) as rows from (select * from public.${table} order by ${order} limit ${PAGE} offset ${offset}) t`,
    );
    rows.push(...r.rows);
    if (r.rows.length < PAGE) return rows;
  }
}

/** 행 집합의 순서 무관 체크섬 */
function checksum(rows) {
  return sha(rows.map((r) => sha(JSON.stringify(r, Object.keys(r).sort()))).sort().join('\n'));
}

async function storage(pathname, init = {}) {
  return fetch(`${env.SUPABASE_URL}/storage/v1/${pathname}`, {
    ...init,
    headers: { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, ...init.headers },
  });
}

async function listObjects(prefix = '') {
  const out = [];
  const res = await storage(`object/list/${BUCKET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  for (const item of await res.json()) {
    const full = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) out.push(...(await listObjects(full)));
    else out.push(full);
  }
  return out;
}

async function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, 'backups', stamp);
  fs.mkdirSync(path.join(dir, 'tables'), { recursive: true });
  const [{ version: migration }] = await runSql('select max(version) as version from private.schema_migrations');
  const manifest = { createdAt: new Date().toISOString(), project: new URL(env.SUPABASE_URL).hostname, migration, tables: {}, objects: [] };

  for (const [table, order] of TABLES) {
    const rows = await exportTable(table, order);
    fs.writeFileSync(path.join(dir, 'tables', `${table}.json.gz`), zlib.gzipSync(JSON.stringify(rows)));
    manifest.tables[table] = { rows: rows.length, checksum: checksum(rows) };
    console.log(`${table.padEnd(18)} ${rows.length}`);
  }

  const objects = await listObjects();
  for (const name of objects) {
    const res = await storage(`object/${BUCKET}/${name.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`원문 내려받기 실패: ${name} (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(dir, 'storage', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf);
    manifest.objects.push({ name, bytes: buf.length, sha256: sha(buf), contentType: res.headers.get('content-type') });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`원문 ${objects.length}개 · ${path.relative(ROOT, dir)}`);
}

const load = (dir, table) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'tables', `${table}.json.gz`))).toString());
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

/** 행을 schema.table 에 넣는다. json 을 조각으로 나눠 보낸다 */
async function insertRows(schema, table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = JSON.stringify(rows.slice(i, i + 500));
    await runSql(`insert into ${schema}.${table} select * from json_populate_recordset(null::${schema}.${table}, ${lit(chunk)}::json)`);
  }
}

async function verify(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const schema = `restore_check_${Date.now()}`;
  await runSql(`create schema ${schema}; revoke all on schema ${schema} from anon, authenticated;`);
  let failed = 0;
  try {
    for (const [table, order] of TABLES) {
      const rows = load(dir, table);
      if (checksum(rows) !== manifest.tables[table].checksum) {
        failed += 1;
        console.log(`FAIL ${table}: 파일 체크섬 불일치`);
        continue;
      }
      // 제약 없이 같은 구조의 표를 만들어 넣고 다시 읽어 대조한다
      await runSql(`create table ${schema}.${table} (like public.${table} including defaults)`);
      await insertRows(schema, table, rows);
      const [back] = await runSql(`select coalesce(json_agg(t), '[]'::json) as rows from (select * from ${schema}.${table} order by ${order}) t`);
      const ok = back.rows.length === manifest.tables[table].rows && checksum(back.rows) === manifest.tables[table].checksum;
      if (!ok) failed += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${table.padEnd(18)} ${back.rows.length}/${manifest.tables[table].rows}`);
    }
    for (const o of manifest.objects) {
      const buf = fs.readFileSync(path.join(dir, 'storage', o.name));
      if (sha(buf) !== o.sha256) {
        failed += 1;
        console.log(`FAIL 원문 ${o.name}`);
      }
    }
    console.log(`원문 ${manifest.objects.length}개 해시 대조`);
  } finally {
    await runSql(`drop schema ${schema} cascade`);
  }
  console.log(failed ? `실패 ${failed}건` : '백업 복원 검증 통과');
  process.exit(failed ? 1 : 0);
}

async function restore(dir) {
  if (!process.argv.includes('--confirm')) {
    console.error('운영 DB 에 쓰는 작업이다. 마이그레이션만 적용된 빈 DB 에서 --confirm 을 붙여 실행한다.');
    process.exit(2);
  }
  const [{ n }] = await runSql('select count(*)::int as n from public.legal_documents');
  if (n > 0) {
    console.error('대상 DB 가 비어 있지 않다. 덮어쓰기를 막기 위해 중단한다.');
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  // 사용자 계정(auth.users)은 Supabase 백업으로 옮긴다. 없는 사용자의 행은 외래키 때문에 들어가지 않는다.
  for (const [table] of TABLES) {
    await insertRows('public', table, load(dir, table));
    console.log(`복원 ${table} ${manifest.tables[table].rows}`);
  }
  for (const o of manifest.objects) {
    const buf = fs.readFileSync(path.join(dir, 'storage', o.name));
    const res = await storage(`object/${BUCKET}/${o.name.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { 'Content-Type': o.contentType ?? 'application/octet-stream', 'x-upsert': 'true' },
      body: buf,
    });
    if (!res.ok) throw new Error(`원문 올리기 실패: ${o.name}`);
  }
  console.log(`원문 ${manifest.objects.length}개 복원. 이어서 cd server && npm run index-corpus`);
}

const [cmd, dir] = process.argv.slice(2);
if (cmd === 'backup') await backup();
else if (cmd === 'verify' && dir) await verify(path.resolve(dir));
else if (cmd === 'restore' && dir) await restore(path.resolve(dir));
else {
  console.error('사용법: node scripts/backup.mjs backup | verify <dir> | restore <dir> --confirm');
  process.exit(2);
}
