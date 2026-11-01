import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentPanel from '../../src/components/chat/AgentPanel';
import type { PromptHistoryItem } from '../../src/services/api';

/**
 * ☆ で指示を固定する (2026-11-01 利用者判断、docs/02 prompt_pins)
 *
 * ★ 履歴は新しい 30 件だけなので、毎回違う文を送る部屋では古い大事な指示が押し出されていた。
 * ここで固定する:
 *   1. 固定した指示は「固定した指示」の段に出る (★)。最近の指示の行には ☆
 *   2. ☆ / ★ を押すと onTogglePin (行を選んで入力欄に入れはしない)
 *   3. 打った文字の絞り込みは固定した指示にも効く
 *   4. ↑↓ で最近の指示から固定した指示へ移れ、Enter で選べる
 */
const TARGETS = [{ user_id: 'u-assistant', display_name: 'アシスタント', avatar_url: null }];
const HISTORY: PromptHistoryItem[] = [
  { message_id: 'm2', target: 'アシスタント', body: '新しい指示', content: '@アシスタント 新しい指示', holes: [], created_at: '2026-10-27T00:00:00Z' },
  { message_id: 'm1', target: 'アシスタント', body: '古い指示', content: '@アシスタント 古い指示', holes: [], created_at: '2026-10-20T00:00:00Z' },
];
const PINNED: PromptHistoryItem[] = [
  { message_id: 'pin:p1', target: 'アシスタント', body: '大事な指示', content: '@アシスタント 大事な指示', holes: [], created_at: '2026-01-01T00:00:00Z', pinned: true },
];
const baseProps = {
  targets: TARGETS,
  history: HISTORY,
  pinned: PINNED,
  targetCounts: {},
  mode: 'compose' as const,
  query: '',
  selected: [] as string[],
  onChangeTargets: () => {},
  onSelectHistory: () => {},
  onTogglePin: () => {},
  onClose: () => {},
};

describe('AgentPanel — ☆ で固定', () => {
  it('★ 固定した指示は「固定した指示」の段に ★ 付きで出る', () => {
    render(<AgentPanel {...baseProps} />);
    expect(screen.getByText('固定した指示')).toBeTruthy();
    const pinnedRows = screen.getAllByTestId('agent-panel-pinned-item');
    expect(pinnedRows).toHaveLength(1);
    expect(pinnedRows[0].textContent).toContain('大事な指示');
    expect(screen.getAllByTestId('agent-panel-pin')[0].textContent).toBe('★');
  });

  it('★ 最近の指示の ☆ を押すと固定 (行は入力欄に入れない)', () => {
    const onTogglePin = vi.fn();
    const onSelectHistory = vi.fn();
    render(<AgentPanel {...baseProps} onTogglePin={onTogglePin} onSelectHistory={onSelectHistory} />);
    const stars = screen.getAllByTestId('agent-panel-pin');
    // 段の順: 固定 (★) → 最近 (古い → 新しい)
    expect(stars.map(s => s.textContent)).toEqual(['★', '☆', '☆']);
    fireEvent.mouseDown(stars[1]);
    expect(onTogglePin).toHaveBeenCalledWith(HISTORY[1], true);
    expect(onSelectHistory).not.toHaveBeenCalled();
  });

  it('★ ★ を押すと外す', () => {
    const onTogglePin = vi.fn();
    render(<AgentPanel {...baseProps} onTogglePin={onTogglePin} />);
    fireEvent.mouseDown(screen.getAllByTestId('agent-panel-pin')[0]);
    expect(onTogglePin).toHaveBeenCalledWith(PINNED[0], false);
  });

  it('打った文字の絞り込みは固定した指示にも効く', () => {
    render(<AgentPanel {...baseProps} query="新しい" />);
    expect(screen.queryAllByTestId('agent-panel-pinned-item')).toHaveLength(0);
    expect(screen.queryByText('固定した指示')).toBeNull();
  });

  it('★ ↑ で最近の指示から固定した指示へ移り、Enter で選べる', () => {
    const onSelectHistory = vi.fn();
    render(<AgentPanel {...baseProps} onSelectHistory={onSelectHistory} />);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onSelectHistory).toHaveBeenCalledWith('@アシスタント 大事な指示', []);
  });

  it('固定が無ければ段を出さない', () => {
    render(<AgentPanel {...baseProps} pinned={[]} />);
    expect(screen.queryByText('固定した指示')).toBeNull();
  });
});
