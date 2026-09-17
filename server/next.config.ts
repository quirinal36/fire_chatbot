import { resolve } from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// 로컬 비밀값은 저장소 루트의 .env 하나에 둔다. Next 가 server/ 를 먼저 읽고 결과를 캐시하므로
// forceReload 로 다시 읽는다. Vercel 에서는 프로젝트 환경변수가 쓰이고 상위 폴더에 .env 가 없다.
if (!process.env.VERCEL) {
  loadEnvConfig(resolve(process.cwd(), '..'), process.env.NODE_ENV !== 'production', console, true);
}

const config: NextConfig = {
  poweredByHeader: false,
  // 화면은 별도 Vercel 프로젝트(frontend/)가 맡는다. 이 서버는 /api/* 만 제공한다.
  outputFileTracingRoot: resolve(process.cwd()),
};

export default config;
