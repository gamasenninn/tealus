import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AgentPanel from '../../src/components/chat/AgentPanel';
import type { PromptHistoryItem } from '../../src/services/api';

/**
 * #354 エージェント指示の履歴ピッカー
 *
 * 🤖 に統合した 1 枚のパネル。上端に宛先チップ (横 1 行・頻度順)、その下が履歴。
 * 履歴は「古い → 新しい」で並べ、下端 (入力欄に一番近い) が最新。
 */

const TARGETS = [
  { user_id: 'u-assistant', display_name: 'アシスタント', avatar_url: null },
  { user_id: 'cc:tealus', display_name: 'cc-tealus', avatar_url: null, is_cc: true },
  { user_id: 'cc:organon', display_name: 'cc-organon', avatar_url: null, is_cc: true },
];

/** API はつねに新しい順で返す (messages API と同じ約束) */
const HISTORY: PromptHistoryItem[] = [
  { message_id: 'm3', target: 'アシスタント', body: '新しい指示', content: '@アシスタント 新しい指示', created_at: '2026-07-27T00:00:00Z' },
  { message_id: 'm2', target: 'cc-tealus', body: 'tsc を通して', content: '@cc-tealus tsc を通して', created_at: '2026-07-25T00:00:00Z' },
  { message_id: 'm1', target: 'アシスタント', body: '古い指示', content: '@アシスタント 古い指示', created_at: '2026-07-20T00:00:00Z' },
];

const baseProps = {
  targets: TARGETS,
  history: HISTORY,
  targetCounts: { 'アシスタント': 5, 'cc-tealus': 2 },
  mode: 'compose' as const,
  query: '',
  onSelectTarget: () => {},
  onSelectHistory: () => {},
  onClose: () => {},
};

const chips = () => screen.getAllByTestId('agent-panel-chip');
const items = () => screen.queryAllByTestId('agent-panel-item');

describe('AgentPanel — 宛先チップ', () => {
  it('宛先を使用回数の多い順に並べる', () => {
    render(<AgentPanel {...baseProps} />);
    expect(chips().map(c => c.textContent)).toEqual(['@アシスタント', '@cc-tealus', '@cc-organon']);
  });

  it('一度も使っていない宛先も末尾に出す (初めて聞く宛先に辿り着けなくならない)', () => {
    render(<AgentPanel {...baseProps} targetCounts={{}} />);
    expect(chips()).toHaveLength(3);
  });

  it('チップを押すと宛先だけを挿入する', () => {
    const onSelectTarget = vi.fn();
    render(<AgentPanel {...baseProps} onSelectTarget={onSelectTarget} />);
    fireEvent.mouseDown(chips()[1]);
    expect(onSelectTarget).toHaveBeenCalledWith('cc-tealus');
  });
});

describe('AgentPanel — 履歴', () => {
  it('古い → 新しい の順で並べ、下端が最新になる', () => {
    render(<AgentPanel {...baseProps} />);
    expect(items().map(i => i.getAttribute('data-message-id'))).toEqual(['m1', 'm2', 'm3']);
  });

  it('宛先込みの全文を表示する (表示 = 入力欄に入る文字列)', () => {
    render(<AgentPanel {...baseProps} />);
    const row = items()[2];
    expect(within(row).getByText('@アシスタント')).toBeInTheDocument();
    expect(within(row).getByText('新しい指示')).toBeInTheDocument();
  });

  it('行を押すと宛先込みの全文を挿入する', () => {
    const onSelectHistory = vi.fn();
    render(<AgentPanel {...baseProps} onSelectHistory={onSelectHistory} />);
    fireEvent.mouseDown(items()[1]);
    expect(onSelectHistory).toHaveBeenCalledWith('@cc-tealus tsc を通して');
  });

  it('履歴が空なら「最近の指示」の見出しを出さない', () => {
    render(<AgentPanel {...baseProps} history={[]} />);
    expect(screen.queryByText('最近の指示')).not.toBeInTheDocument();
    expect(items()).toHaveLength(0);
  });

  it('入口B (宛先を選ばせる場面) では履歴を出さない', () => {
    render(<AgentPanel {...baseProps} mode="target-only" />);
    expect(items()).toHaveLength(0);
    expect(chips()).toHaveLength(3);
  });

  // 見出しでモードが目視できること自体が、入口Bの切り分けに要る
  it('見出しでモードを出し分ける', () => {
    const { rerender } = render(<AgentPanel {...baseProps} />);
    expect(screen.getByTestId('agent-panel-title')).toHaveTextContent('エージェントに聞く');
    rerender(<AgentPanel {...baseProps} mode="target-only" />);
    expect(screen.getByTestId('agent-panel-title')).toHaveTextContent('宛先を選ぶ');
  });
});

describe('AgentPanel — 絞り込み', () => {
  it('query で履歴の本文を絞り込む', () => {
    render(<AgentPanel {...baseProps} query="tsc" />);
    expect(items()).toHaveLength(1);
    expect(items()[0].getAttribute('data-message-id')).toBe('m2');
  });

  it('query で宛先チップも絞り込む', () => {
    render(<AgentPanel {...baseProps} query="organon" />);
    expect(chips().map(c => c.textContent)).toEqual(['@cc-organon']);
  });

  it('大文字小文字を区別しない', () => {
    render(<AgentPanel {...baseProps} query="TSC" />);
    expect(items()).toHaveLength(1);
  });
});

describe('AgentPanel — キーボード操作 (PC)', () => {
  it('初期選択は最新 = 下端の行', () => {
    render(<AgentPanel {...baseProps} />);
    expect(items()[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('↑ で 1 つ前 (古い方) の指示に遡る — シェルの履歴と同じ', () => {
    render(<AgentPanel {...baseProps} />);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(items()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('↓ で新しい方に戻る', () => {
    render(<AgentPanel {...baseProps} />);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(items()[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('端で止まる (先頭より上・末尾より下には行かない)', () => {
    render(<AgentPanel {...baseProps} />);
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(items()[0]).toHaveAttribute('aria-selected', 'true');
    for (let i = 0; i < 5; i++) fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(items()[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter で選択中の指示を挿入する', () => {
    const onSelectHistory = vi.fn();
    render(<AgentPanel {...baseProps} onSelectHistory={onSelectHistory} />);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectHistory).toHaveBeenCalledWith('@cc-tealus tsc を通して');
  });

  it('Tab でも挿入する', () => {
    const onSelectHistory = vi.fn();
    render(<AgentPanel {...baseProps} onSelectHistory={onSelectHistory} />);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(onSelectHistory).toHaveBeenCalledWith('@アシスタント 新しい指示');
  });

  it('Esc で閉じる', () => {
    const onClose = vi.fn();
    render(<AgentPanel {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('履歴が無いときの Enter は何もしない (改行を奪わない)', () => {
    const onSelectHistory = vi.fn();
    const onClose = vi.fn();
    render(<AgentPanel {...baseProps} history={[]} onSelectHistory={onSelectHistory} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectHistory).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('絞り込みで候補が変わったら選択は末尾に戻る', () => {
    const onSelectHistory = vi.fn();
    const { rerender } = render(<AgentPanel {...baseProps} onSelectHistory={onSelectHistory} />);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    rerender(<AgentPanel {...baseProps} query="tsc" onSelectHistory={onSelectHistory} />);
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectHistory).toHaveBeenCalledWith('@cc-tealus tsc を通して');
  });

  it('閉じた後はキーを拾わない (listener が残らない)', () => {
    const onClose = vi.fn();
    const { unmount } = render(<AgentPanel {...baseProps} onClose={onClose} />);
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
