/**
 * #344 候補3: buildEditDiffPairs 純関数テスト。
 * 集約前 (MessageBubble のインライン IIFE) の「ASC 化→ペア構築→逆順表示」を固定。
 */
import { describe, it, expect } from 'vitest';
import { buildEditDiffPairs, type MessageEditEntry } from '../src/utils/editHistory';

const entry = (version: number, content: string, extra: Partial<MessageEditEntry> = {}): MessageEditEntry =>
  ({ version, content, created_at: `2026-07-2${version}T00:00:00Z`, ...extra });

describe('buildEditDiffPairs', () => {
  it('履歴が空なら空配列', () => {
    expect(buildEditDiffPairs([], 'now')).toEqual([]);
  });

  it('1 回編集: 最新→現在の 1 ペア (編集者は null)', () => {
    const hist = [entry(1, 'first')]; // DESC
    const pairs = buildEditDiffPairs(hist, 'current');
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      version: 1, label: 'v1 → 現在', editorName: null, editorDate: null,
      prevText: 'first', nextText: 'current',
    });
  });

  it('2 回編集: 新しい変更が先頭、各ペアの prev/next と編集者を対応付け', () => {
    // DESC で届く: v2(rina が v1→v2), v1
    const hist = [entry(2, 'second', { edited_by_name: 'rina' }), entry(1, 'first')];
    const pairs = buildEditDiffPairs(hist, 'current');
    expect(pairs).toHaveLength(2);
    // 先頭 = 最新の変更 (v2 → 現在)
    expect(pairs[0]).toMatchObject({ version: 2, label: 'v2 → 現在', editorName: null, prevText: 'second', nextText: 'current' });
    // 次 = v1 → v2 (この変更の編集者は v2 の edited_by_name = rina)
    expect(pairs[1]).toMatchObject({ version: 1, label: 'v1 → v2', editorName: 'rina', prevText: 'first', nextText: 'second' });
    expect(pairs[1].editorDate).toBe('2026-07-22T00:00:00Z');
  });
});
