/**
 * #432 会話モード: 道具の返り値が大きすぎると、画面がデータチャネルで送れずに固まった
 *
 * ★ 2026-10-09 00:09 KAIROS で再現。画面が道具の結果を Realtime に送る send が例外を出し、
 *   道具の数が減らないまま「調べています…」が消えなくなった。上限の実測は 262,144 バイトで、
 *   「全部読んで」で AI が件数を増やすと原寸 335,456 バイトになった (直した後の記録)。
 * ★ 画面は返り値を JSON.stringify で包んで送るので、上限は「包んだあとの大きさ」で見る。
 */
import { describe, expect, test } from '@jest/globals';
import { capToolOutput, TOOL_OUTPUT_WIRE_LIMIT } from '../../src/lib/voiceChatToolOutput.mts';

/** 画面 (useRealtimeVoice.ts) がデータチャネルに送る文と同じ形 */
const wireBytes = (output: string) => Buffer.byteLength(JSON.stringify({
  type: 'conversation.item.create', item: { type: 'function_call_output', call_id: 'call_0123456789abcdef', output },
}), 'utf8');

describe('capToolOutput', () => {
  test('小さい返り値はそのまま返す', () => {
    const out = JSON.stringify({ content: [{ type: 'text', text: 'ガマさん、取れますか' }] });
    expect(capToolOutput(out)).toEqual({ output: out, truncated: false, originalBytes: Buffer.byteLength(out, 'utf8') });
  });

  test('★ 大きい返り値は、送る文が上限 (48KB) を超えないところで切る', () => {
    // 実際に固まった形: 改行・引用符を含む日本語の長文が JSON に 2 重に包まれている
    const text = JSON.stringify({ messages: Array.from({ length: 40 }, (_, i) => ({ id: i, content: `**見出し${i}**\n「引用」と本文。`.repeat(60) })) }, null, 2);
    const out = JSON.stringify({ content: [{ type: 'text', text }] });
    expect(wireBytes(out)).toBeGreaterThan(65536);

    const r = capToolOutput(out);
    expect(r.truncated).toBe(true);
    expect(r.originalBytes).toBe(Buffer.byteLength(out, 'utf8'));
    expect(wireBytes(r.output)).toBeLessThanOrEqual(TOOL_OUTPUT_WIRE_LIMIT);
    expect(TOOL_OUTPUT_WIRE_LIMIT).toBeLessThan(65536);
  });

  test('★ 切ったことと、引き直し方をモデルに伝える', () => {
    const out = 'あ'.repeat(40000);
    const r = capToolOutput(out);
    expect(r.truncated).toBe(true);
    expect(r.output).toContain('長すぎるため');
    expect(r.output).toContain('limit');
    expect(r.output.startsWith('あ')).toBe(true);   // 頭から残す (新しい投稿が先に来る)
  });

  test('サロゲートペア (絵文字) の途中で切らない', () => {
    const out = '🌱'.repeat(30000);
    const r = capToolOutput(out);
    expect(r.truncated).toBe(true);
    expect(r.output).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
