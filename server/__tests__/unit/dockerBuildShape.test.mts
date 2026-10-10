/**
 * #558 docker-compose.full.yml で丸ごと立てて分かったことを固定する (2026-10-10、本番と別に立てて画面と AI の返事まで確認)。
 * ★ どれも CI では見えない (CI は docker build をしない)。直す前は次のどれかで止まっていた:
 *   - client / dashboard の package.json の postinstall (vite build) が、ソースをコピーする前の npm ci で走って失敗
 *   - client / dashboard の tsconfig.json が ../tsconfig.base.json を extends しているのに、イメージに無い
 *   - agent-server のイメージに git が無く、AI の道具 (npx github:…/tealus-mcp) を取れない
 *   - agent-server の DB_HOST を compose が上書きせず、.env の localhost (コンテナ自身) につないで会話のたびに落ちる
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO, p), 'utf8');

describe('server/Dockerfile', () => {
  const df = read('server/Dockerfile');
  test.each(['client', 'dashboard'])('%s の npm ci は postinstall を走らせない', (pkg) => {
    expect(df).toMatch(new RegExp(`RUN cd ${pkg} && npm ci --ignore-scripts`));
  });
  test('画面を作る段に tsconfig.base.json をコピーする (client と dashboard の 2 段)', () => {
    expect(df.match(/^COPY tsconfig\.base\.json \.\/$/gm)?.length).toBe(2);
  });
});

test('agent-server/Dockerfile は git を入れる (npx github:… のため)', () => {
  expect(read('agent-server/Dockerfile')).toMatch(/apk add --no-cache git/);
});

describe('docker-compose.full.yml', () => {
  const y = read('docker-compose.full.yml');
  /** services: の下の 1 サービス分 (次の 2 字下げの見出しまで) */
  const section = (name: string) => {
    const lf = y.replace(/\r\n/g, '\n');
    const start = lf.indexOf(`\n  ${name}:\n`);
    if (start < 0) return '';
    const next = lf.slice(start + 1).search(/\n  [a-z][a-z-]*:\n|\nvolumes:/);
    return next < 0 ? lf.slice(start) : lf.slice(start, start + 1 + next);
  };
  test('切り出しが 1 サービス分になっている (空振りの見張り)', () => {
    expect(section('server')).toMatch(/dockerfile: server\/Dockerfile/);
    expect(section('server')).not.toMatch(/TEALUS_API_URL/);          // agent-server だけの値
    expect(section('agent-server')).toMatch(/dockerfile: agent-server\/Dockerfile/);
    expect(section('agent-server')).not.toMatch(/MEDIA_ROOT/);        // server だけの値
  });
  test('agent-server に DB_HOST: postgres を渡す', () => {
    expect(section('agent-server')).toMatch(/DB_HOST: postgres/);
  });
  test('server に AGENT_URL (別コンテナの agent-server) を渡す (#556)', () => {
    expect(section('server')).toMatch(/AGENT_URL: http:\/\/agent-server:4000/);
  });
});
