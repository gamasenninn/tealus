/**
 * #558 Docker のイメージに、鍵・会社の設定・手元の node_modules を入れない (.dockerignore)。
 * ★ 以前は .dockerignore が無く、Dockerfile の COPY server/ などで server/.env もイメージに入っていた
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '../../..');
const file = path.join(REPO, '.dockerignore');
const lines = fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];

test.each([
  '**/node_modules',
  '**/.env',
  '**/.env.*',
  'server/config/dictionary.local.ttl',
  'server/config/line-groups.json',
  'server/config/line-group-mappings.json',
  'server/config/line-members.json',
  'server/config/room-triggers.json',
  'server/config/transcription_guideline*.json',
  'agent-server/mcp_config.json',
  'agent-server/config/system_prompt.md',
  'agent-server/agent-workspaces',
  'media',
  'report',
])('.dockerignore に %s がある', (pattern) => {
  expect(lines).toContain(pattern);
});

test('見本の .env.example はイメージに残す (外しすぎない)', () => {
  expect(lines).toContain('!**/.env.example');
});
