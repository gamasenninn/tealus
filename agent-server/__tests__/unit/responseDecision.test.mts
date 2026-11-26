/**
 * 振り分け (dispatcher._dispatch) の冒頭「応答するか」の判定。改善ループ 126 で純関数に出した (中身は同じ)
 * ★ 順番が意味を持つ: 止めた部屋 → ゲスト → 名指しが要るか。お知らせ・ログ・間引きは dispatcher に残っている
 * ★ 結線 (お知らせを出すか・route に行くか) は dispatcher.test の「dispatch」「AI を止めた部屋での 1 行」が見ている
 */
import { decideResponse, isAddressed, type RoomSettings } from '../../src/webhook/responseDecision.mts';

const AI = 'アシスタント';
const on = (mode: string): RoomSettings => ({ response_mode: mode, enabled: true });

describe('isAddressed (AI に宛てた便か)', () => {
  it('1 対 1 (2 人以下) は名指しが無くても宛てた便', () => {
    expect(isAddressed('こんにちは', AI, 2)).toBe(true);
    expect(isAddressed('こんにちは', AI, 1)).toBe(true);
  });
  it('3 人以上は先頭の名指しだけ', () => {
    expect(isAddressed('こんにちは', AI, 3)).toBe(false);
    expect(isAddressed(`@${AI} こんにちは`, AI, 3)).toBe(true);
    expect(isAddressed(`文中の @${AI}`, AI, 3)).toBe(false);
  });
  it('名前が無ければグループでは宛てた便にならない', () => {
    expect(isAddressed(`@${AI} x`, null, 3)).toBe(false);
  });
});

describe('decideResponse', () => {
  // [説明, 部屋の設定, 人数, 名指し, 送った人の権限, 期待]
  const table: Array<[string, RoomSettings, number, boolean, string | undefined, ReturnType<typeof decideResponse>]> = [
    ['enabled=false は止めた部屋 (1 対 1 は宛てた便)', { response_mode: 'auto', enabled: false }, 2, false, 'user', { kind: 'disabled', addressed: true }],
    ['off は止めた部屋 (グループで名指しなし = 宛てていない)', on('off'), 3, false, 'user', { kind: 'disabled', addressed: false }],
    ['off でもグループで名指しなら宛てた便', on('off'), 3, true, 'user', { kind: 'disabled', addressed: true }],
    ['止めた部屋はゲストより先', on('off'), 2, false, 'guest', { kind: 'disabled', addressed: true }],
    ['ゲストは応答しない (1 対 1 ならお知らせ)', on('auto'), 2, false, 'guest', { kind: 'guest', addressed: true }],
    ['ゲスト: グループで名指しなしはお知らせも出さない', on('all'), 3, false, 'guest', { kind: 'guest', addressed: false }],
    ['auto の 1 対 1: 名指し不要', on('auto'), 2, false, 'user', { kind: 'respond', stripMention: false }],
    ['auto のグループ: 名指しが無ければ黙る', on('auto'), 3, false, 'user', { kind: 'no_mention' }],
    ['auto のグループ: 名指しがあれば名指しを落として応答', on('auto'), 3, true, 'user', { kind: 'respond', stripMention: true }],
    ['mention: 1 対 1 でも名指しが要る', on('mention'), 2, false, 'user', { kind: 'no_mention' }],
    ['mention: 名指しあり', on('mention'), 2, true, 'user', { kind: 'respond', stripMention: true }],
    ['all: グループでも名指し不要 (名指しは落とさない)', on('all'), 5, true, 'user', { kind: 'respond', stripMention: false }],
    ['権限が載っていない便 (古い本体) は今までどおり', on('auto'), 2, false, undefined, { kind: 'respond', stripMention: false }],
  ];

  it.each(table)('%s', (_label, roomSettings, memberCount, mentioned, senderRole, expected) => {
    const prompt = mentioned ? `@${AI} 見積りを出して` : '見積りを出して';
    expect(decideResponse({ prompt, agentName: AI, memberCount, roomSettings, senderRole })).toEqual(expected);
  });

  it('知らない response_mode は auto と同じ (人数で決める)', () => {
    expect(decideResponse({ prompt: 'x', agentName: AI, memberCount: 3, roomSettings: on('???'), senderRole: 'user' })).toEqual({ kind: 'no_mention' });
    expect(decideResponse({ prompt: 'x', agentName: AI, memberCount: 2, roomSettings: on('???'), senderRole: 'user' })).toEqual({ kind: 'respond', stripMention: false });
  });
});
