/**
 * buildContextMenuItems の「部分コピー」項目 test (#部分コピー)
 */
import { describe, it, expect, vi } from 'vitest';
import { buildContextMenuItems } from '../src/hooks/useContextMenuItems';
import type { BuildContextMenuItemsParams } from '../src/hooks/useContextMenuItems';

describe('buildContextMenuItems 部分コピー', () => {
  it('テキストメッセージに「部分コピー」が出て onSelectText(content) を呼ぶ', () => {
    const onSelectText = vi.fn();
    const { items } = buildContextMenuItems({
      message: { id: 'm1', content: 'hello world', type: 'text' },
      isOwn: true, roomId: 'r1', currentRoom: {},
      onSelectText,
    } as unknown as BuildContextMenuItemsParams);
    const partial = items.find((i) => i.label === '部分コピー');
    expect(partial).toBeTruthy();
    partial!.onClick();
    expect(onSelectText).toHaveBeenCalledWith('hello world');
  });

  it('onSelectText 未指定なら「部分コピー」は出ない (後方互換)', () => {
    const { items } = buildContextMenuItems({
      message: { id: 'm1', content: 'hello', type: 'text' },
      isOwn: true, roomId: 'r1', currentRoom: {},
    } as unknown as BuildContextMenuItemsParams);
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
    } as unknown as BuildContextMenuItemsParams);
    const partial = items.find((i) => i.label === '文字起こしを部分コピー');
    expect(partial).toBeTruthy();
    partial!.onClick();
    expect(onSelectText).toHaveBeenCalledWith('音声テキスト');
  });
});

describe('buildContextMenuItems エージェントに送る (#338)', () => {
  const base = {
    isOwn: true, roomId: 'r1', currentRoom: {},
    onSendToAgent: undefined as unknown as () => void,
    assistantInRoom: true,
  };

  it('自分のテキスト投稿に「エージェントに送る」が出て onSendToAgent を呼ぶ', () => {
    const onSendToAgent = vi.fn();
    const { items } = buildContextMenuItems({
      ...base, onSendToAgent,
      message: { id: 'm1', content: '在庫は？', type: 'text' },
    } as unknown as BuildContextMenuItemsParams);
    const it0 = items.find((i) => i.label === 'エージェントに送る');
    expect(it0).toBeTruthy();
    it0!.onClick();
    expect(onSendToAgent).toHaveBeenCalled();
  });

  it('自分の音声(文字起こし済み)にも出る', () => {
    const { items } = buildContextMenuItems({
      ...base, onSendToAgent: vi.fn(),
      message: { id: 'm2', type: 'voice', transcription: { status: 'done', formatted_text: 'x' } },
    } as unknown as BuildContextMenuItemsParams);
    expect(items.find((i) => i.label === 'エージェントに送る')).toBeTruthy();
  });

  it('他人の投稿には出ない (Q4: 自分の投稿のみ)', () => {
    const { items } = buildContextMenuItems({
      ...base, isOwn: false, onSendToAgent: vi.fn(),
      message: { id: 'm3', content: 'x', type: 'text' },
    } as unknown as BuildContextMenuItemsParams);
    expect(items.find((i) => i.label === 'エージェントに送る')).toBeFalsy();
  });

  it('アシスタントがルームに居ない時は出ない', () => {
    const { items } = buildContextMenuItems({
      ...base, assistantInRoom: false, onSendToAgent: vi.fn(),
      message: { id: 'm4', content: 'x', type: 'text' },
    } as unknown as BuildContextMenuItemsParams);
    expect(items.find((i) => i.label === 'エージェントに送る')).toBeFalsy();
  });

  it('文字起こし未完了の音声には出ない', () => {
    const { items } = buildContextMenuItems({
      ...base, onSendToAgent: vi.fn(),
      message: { id: 'm5', type: 'voice', transcription: { status: 'pending' } },
    } as unknown as BuildContextMenuItemsParams);
    expect(items.find((i) => i.label === 'エージェントに送る')).toBeFalsy();
  });
});
