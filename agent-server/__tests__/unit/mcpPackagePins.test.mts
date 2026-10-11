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
