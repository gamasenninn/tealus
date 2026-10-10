/**
 * #557 compose は migrations を Postgres の初回起動 (docker-entrypoint-initdb.d) で流さない。migrate だけが道。
 * ★ initdb で流すと台帳 (schema_migrations、#406) が作られず、次の npm run migrate が止まった (10-10 に実際に立てて確認)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');

test.each(['docker-compose.yml', 'docker-compose.full.yml'])('%s は initdb に migrations をマウントしない', (name) => {
  const lines = fs.readFileSync(path.join(REPO, name), 'utf8').split(/\r?\n/).filter((l) => !l.trim().startsWith('#'));
  expect(lines.filter((l) => l.includes('docker-entrypoint-initdb.d'))).toEqual([]);
});
