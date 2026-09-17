/**
 * 관리자 계정 관리 (ISS-021)
 *
 *   npm run admin -- add --email reviewer@example.kr --role reviewer [--name 홍길동]
 *   npm run admin -- list
 *   npm run admin -- remove --email reviewer@example.kr
 *
 * add 는 이메일 로그인 계정을 만들고 임시 비밀번호를 한 번만 출력한다. 비밀번호는 저장하지 않는다.
 */
import './_env';
import { randomBytes } from 'node:crypto';

const { adminClient } = await import('@/lib/supabase');

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const db = adminClient();

async function findUser(email: string) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit || data.users.length < 200) return hit ?? null;
  }
  return null;
}

switch (cmd) {
  case 'add': {
    const email = opt('--email');
    const role = opt('--role') ?? 'reviewer';
    if (!email || !['admin', 'reviewer'].includes(role)) {
      console.error('--email 과 --role admin|reviewer 가 필요하다');
      process.exit(2);
    }
    let user = await findUser(email);
    let password: string | null = null;
    if (!user) {
      password = randomBytes(12).toString('base64url');
      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: opt('--name') ? { full_name: opt('--name') } : {},
      });
      if (error) throw new Error(error.message);
      user = data.user;
    }
    const { error } = await db.from('admin_users').upsert({ user_id: user.id, role });
    if (error) throw new Error(error.message);
    console.log(`관리자 등록: ${email} (${role})`);
    if (password) console.log(`임시 비밀번호 (지금 한 번만 표시): ${password}`);
    break;
  }
  case 'list': {
    const { data } = await db.from('admin_users').select('user_id, role, created_at');
    for (const a of data ?? []) {
      const { data: u } = await db.auth.admin.getUserById(a.user_id);
      console.log(`${a.role.padEnd(9)} ${u.user?.email ?? a.user_id} ${a.created_at}`);
    }
    break;
  }
  case 'remove': {
    const user = await findUser(opt('--email') ?? '');
    if (!user) {
      console.error('사용자를 찾지 못했다');
      process.exit(1);
    }
    await db.from('admin_users').delete().eq('user_id', user.id);
    console.log('관리자 권한 삭제');
    break;
  }
  default:
    console.error('사용법: npm run admin -- add | list | remove');
    process.exit(2);
}
