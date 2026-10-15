/**
 * ★ #577 起動のたびにダウンロードする MCP の道具は、版を固定する。
 *   server-filesystem を版なしで npx していて、2026-10-11 に上流が新しい major (1.0.0) を出した。
 *   手元はキャッシュの 2026.1.14 で動き、新しいマシン・Docker では 1.0.0 を引く (マシンごとに違う版)。
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
import { buildLightV2McpConfig } from '../../src/agents/lightV2.mts';
import { FILESYSTEM_MCP_PACKAGE } from '../../src/lib/mcpPackages.mts';

test('★ 固定した版の指定は 名前@版', () => {
  expect(FILESYSTEM_MCP_PACKAGE).toMatch(/^@modelcontextprotocol\/server-filesystem@\d[\w.-]*$/);
});

test('★ Light v2 の workspace-fs は固定した版を使う', () => {
  const cfg = buildLightV2McpConfig('C:\ws\room1') as Record<string, { args: string[] }>;
  expect(cfg['workspace-fs'].args).toContain(FILESYSTEM_MCP_PACKAGE);
});

/**
 * 2026-10-15: tealus-mcp を v0.14.7 に固定したまま、Light / Deep から send_form (v0.14.8) と edit_message (v0.15.0) が
 * 一度も見えていなかった (docs 班の確認)。版の文字列が 3 か所に直書きで、上げ忘れが起きやすかった。
 * ★ 版はここ 1 か所 (TEALUS_MCP_PACKAGE) に置き、3 か所はそれを使う
 */
import fs from 'node:fs';
import path from 'node:path';
import { TEALUS_MCP_PACKAGE } from '../../src/lib/mcpPackages.mts';

test('★ tealus-mcp はタグで固定し、edit_message のある v0.15.0 以上', () => {
  const m = /^github:gamasenninn\/tealus-mcp#v(\d+)\.(\d+)\.(\d+)$/.exec(TEALUS_MCP_PACKAGE);
  expect(m).not.toBeNull();
  const [maj, min] = [Number(m![1]), Number(m![2])];
  expect(maj > 0 || min >= 15).toBe(true);
});

test('★★ 3 か所 (Light v2・Deep・ルームごと) とも TEALUS_MCP_PACKAGE を使う', () => {
  // ★ 設定を組み立てて見ない: Light v2 は bot のログイン情報が無いと tealus を入れないので、
  //   CI (.env 無し) では tealus が無く落ちた (2026-10-15)。ソースで確かめる (機械に依存しない)
  const root = path.join(__dirname, '../../src');
  for (const f of ['agents/lightV2.mts', 'agents/deep.mts', 'mcp/roomMcpManager.mts']) {
    expect(fs.readFileSync(path.join(root, f), 'utf8')).toMatch(/args: \['-y', TEALUS_MCP_PACKAGE\]/);
  }
});

test('★★ src の中に tealus-mcp の版を直書きしない (mcpPackages.mts の 1 か所だけ)', () => {
  const root = path.join(__dirname, '../../src');
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith('.mts') && !p.endsWith('mcpPackages.mts') && /tealus-mcp#v\d/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  };
  walk(root);
  expect(hits).toEqual([]);
});
