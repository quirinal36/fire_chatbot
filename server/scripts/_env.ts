/** CLI 공용: 저장소 루트 .env 를 읽는다. 반드시 다른 모듈보다 먼저 import 한다. */
import { resolve } from 'node:path';
import nextEnv from '@next/env';

nextEnv.loadEnvConfig(resolve(import.meta.dirname, '..', '..'), true, { info: () => {}, error: console.error });
