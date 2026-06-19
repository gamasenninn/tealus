/**
 * buildContextMenuItems の「部分コピー」項目 test (#部分コピー)
 */
import { describe, it, expect, vi } from 'vitest';
import { buildContextMenuItems } from '../src/hooks/useContextMenuItems';

describe('buildContextMenuItems 部分コピー', () => {
  it('テキストメッセージに「部分コピー」が出て onSelectText(content) を呼ぶ', () => {
    const onSelectText = vi.fn();
    const { items } = buildContextMenuItems({
      message: { id: 'm1', content: 'hello world', type: 'text' },
      isOwn: true, roomId: 'r1', currentRoom: {},
      onSelectText,
    });
    const partial = items.find((i) => i.label === '部分コピー');
    expect(partial).toBeTruthy();
    partial.onClick();
    expect(onSelectText).toHaveBeenCalledWith('hello world');
  });

  it('onSelectText 未指定なら「部分コピー」は出ない (後方互換)', () => {
    const { items } = buildContextMenuItems({
      message: { id: 'm1', content: 'hello', type: 'text' },
      isOwn: true, roomId: 'r1', currentRoom: {},
    });
    expect(items.find((i) => i.label === '部分コピー')).toBeFalsy();
    // 全文コピーは従来どおり出る
    expect(items.find((i) => i.label === 'コピー')).toBeTruthy();
  });

  it('voice 文字起こしには「文字起こしを部分コピー」が出る', () => {
    const onSelectText = vi.fn();
    const { items } = buildContextMenuItems({
      message: { id: 'm2', type: 'voice', transcription: { status: 'done', formatted_text: '音声テキスト' } },
      isOwn: true, roomId: 'r1', currentRoom: {},
      onSelectText,
    });
    const partial = items.find((i) => i.label === '文字起こしを部分コピー');
    expect(partial).toBeTruthy();
    partial.onClick();
    expect(onSelectText).toHaveBeenCalledWith('音声テキスト');
  });
});
