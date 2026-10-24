/**
 * 会話モードの道具は、共通 (本体班が組み立てた tealus など) を部屋の設定より先に取る (改善ループ 15 回目、2026-10-24)
 *
 * ★ 道具の取り込みは同じ名前なら先勝ち。並びが [部屋の分, 共通] だったので、部屋の mcp_config.json に
 *   別名 (例 tealus2) で send_message を持つ道具を置くと、共通の tealus の send_message を横取りできた
 *   (キー名 tealus だけを捨てる 10-23 の守りをすり抜ける)。部屋の分 (room-<id>-…) を後ろに回す
 */
jest.mock('../../src/lib/logger.mts', () => ({ logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
const { orderServersForToolPick } = require('../../src/routes/voiceChat.mts') as {
  orderServersForToolPick: <T extends { name?: string }>(s: T[]) => T[];
};

test('部屋の設定の道具 (room-…) は共通より後ろ。それぞれの中の並びは変えない', () => {
  const s = [{ name: 'room-r1-tealus2' }, { name: 'tealus-workspace-fs' }, { name: 'room-r1-db' }, { name: 'tealus' }, { name: 'global-tavily' }];
  expect(orderServersForToolPick(s).map((x) => x.name))
    .toEqual(['tealus-workspace-fs', 'tealus', 'global-tavily', 'room-r1-tealus2', 'room-r1-db']);
});
