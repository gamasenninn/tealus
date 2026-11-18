/**
 * AI が「自分の部屋へもう送ったか」の判定 (2 通返さないため) を 1 つに (改善ループ 70、#649 B-4)
 *
 * ★ Light (lightV2.mts) と Deep (deepCodex.mts) に同じ判定が別々に書いてあり、テストが 0 だった。
 *   判定は tealus-mcp の send_message の返り値の形 ({"message":{"room_id":…}}) に頼っていて、
 *   形が変わると黙って偽になり、2 通返すに戻る
 */
import fs from 'node:fs';
import path from 'node:path';
import { sentToOwnRoom } from '../../src/lib/ownRoomSend.mts';

const ROOM = 'a368e06d-dcb4-4a49-ba7c-a0866895011c';
// ★ 本番の記録 (2026-11-16 11:25:03 [LightV2] mcp_tool_call OK: server=tealus tool=send_message) と同じ形
const result = (roomId: string) => ({ content: [{ type: 'text', text: JSON.stringify({ message: { id: 'm1', room_id: roomId, content: 'hi' } }, null, 2) }] });

describe('sentToOwnRoom', () => {
  it('★ 自分の部屋への send_message が終わっていれば真', () => {
    expect(sentToOwnRoom({ tool: 'send_message', status: 'completed', result: result(ROOM) }, ROOM)).toBe(true);
  });
  it('状態が書かれていない (古い形) ときも、結果が合えば真', () => {
    expect(sentToOwnRoom({ tool: 'send_message', result: result(ROOM) }, ROOM)).toBe(true);
  });
  it('別の部屋・別の道具・失敗・結果が読めないときは偽', () => {
    expect(sentToOwnRoom({ tool: 'send_message', status: 'completed', result: result('other') }, ROOM)).toBe(false);
    expect(sentToOwnRoom({ tool: 'get_messages', status: 'completed', result: result(ROOM) }, ROOM)).toBe(false);
    expect(sentToOwnRoom({ tool: 'send_message', status: 'failed', result: result(ROOM) }, ROOM)).toBe(false);
    expect(sentToOwnRoom({ tool: 'send_message', status: 'completed', result: { content: [{ type: 'text', text: 'エラー: …' }] } }, ROOM)).toBe(false);
    expect(sentToOwnRoom({ tool: 'send_message', status: 'completed' }, ROOM)).toBe(false);
    expect(sentToOwnRoom(null, ROOM)).toBe(false);
  });

  it('★ Light と Deep はこの関数で決める (判定を手で写さない)', () => {
    for (const rel of ['agents/lightV2.mts', 'agents/deepCodex.mts']) {
      const text = fs.readFileSync(path.join(import.meta.dirname, '../../src', rel), 'utf8');
      expect([rel, /sentToOwnRoom\(/.test(text)]).toEqual([rel, true]);
      expect([rel, /parsed\?\.message\?\.room_id/.test(text)]).toEqual([rel, false]);
    }
  });
});
