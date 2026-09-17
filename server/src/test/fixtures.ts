import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(import.meta.dirname, '../../../tests/fixtures/law-api');

export const fixtureText = (name: string) => readFileSync(resolve(DIR, name), 'utf8');
export const fixture = (name: string): unknown => JSON.parse(fixtureText(name));
