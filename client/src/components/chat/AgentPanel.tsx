import { useEffect, useMemo, useRef, useState } from 'react';
import { formatRelativeDay } from '../../utils/format';
import type { MentionCandidate } from './MentionPicker';
import type { PromptHistoryItem } from '../../services/api';
import './AgentPanel.css';

/**
 * #354 エージェントに聞くパネル (🤖 に統合した 1 枚)
 *
 * 上端: 宛先チップ (横 1 行・使用頻度順)。cc ブリッジが増えても高さが変わらないよう
 *       縦リストではなく横スクロールにしている。
 * 下段: 最近の指示。「古い → 新しい」で並べ、下端 (入力欄に一番近い = 指に近い) が最新。
 *       PC では `/` → `↑` がシェルのコマンド履歴と同じ操作になる。
 *
 * 表示された文字列がそのまま入力欄に入る (宛先込みの全文)。挿入するだけで送信はしない。
 */

export type AgentPanelMode =
  /** 白紙から書く / 過去の指示を再利用する (通常の 🤖 と `/`) */
  | 'compose'
  /** 本文は既にあり宛先だけ選ばせる (コンテキストメニュー「エージェントに送る」) */
  | 'target-only';

interface AgentPanelProps {
  targets: MentionCandidate[];
  /** API から来た順 = 新しい順。表示時に反転する */
  history: PromptHistoryItem[];
  targetCounts: Record<string, number>;
  mode: AgentPanelMode;
  query: string;
  onSelectTarget: (name: string) => void;
  onSelectHistory: (content: string) => void;
  onClose: () => void;
}

function AgentPanel({
  targets, history, targetCounts, mode, query, onSelectTarget, onSelectHistory, onClose,
}: AgentPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const q = (query || '').toLowerCase();

  const ccNames = useMemo(
    () => new Set(targets.filter(t => t.is_cc).map(t => t.display_name)),
    [targets]
  );

  // 使用頻度の高い宛先を左に。未使用 (0 回) の宛先も落とさず末尾に残す
  // — 初めて聞く相手に辿り着けなくなるため。
  const sortedTargets = useMemo(() => {
    const matched = targets.filter(t => t.display_name.toLowerCase().includes(q));
    return [...matched].sort((a, b) => (targetCounts[b.display_name] || 0) - (targetCounts[a.display_name] || 0));
  }, [targets, targetCounts, q]);

  // 表示順は古い → 新しい (下端が最新)
  const shown = useMemo(() => {
    if (mode !== 'compose') return [];
    const matched = history.filter(h => h.content.toLowerCase().includes(q));
    return [...matched].reverse();
  }, [history, mode, q]);

  const listKey = shown.map(h => h.message_id).join(',');
  const [index, setIndex] = useState(shown.length - 1);

  // 絞り込みで候補が変わったら選択を末尾 (最新) に戻す
  useEffect(() => { setIndex(shown.length - 1); }, [listKey, shown.length]);

  // 開いた時点で下端が見えている状態にする (チャット画面と同じ「最新が下」)
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [listKey]);

  // 選択行を常に可視領域に入れる
  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  // textarea にフォーカスが残ったままキーを拾いたいので document で待ち受ける。
  // 素の Enter は送信ではなく改行なので (送信は Ctrl+Enter)、パネルが開いている間だけ
  // Enter を選択に使っても送信とはぶつからない。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (shown.length === 0) return; // 履歴が無いときは改行/Tab を奪わない
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(i => Math.min(shown.length - 1, i + 1));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const picked = shown[Math.min(Math.max(index, 0), shown.length - 1)];
        if (!picked) return;
        e.preventDefault();
        onSelectHistory(picked.content);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shown, index, onSelectHistory, onClose]);

  return (
    <div className="agent-panel">
      <div className="agent-panel-header">
        <span className="agent-panel-title">🤖 エージェントに聞く</span>
        <button className="agent-panel-close" onClick={onClose} aria-label="閉じる">✕</button>
      </div>

      <div className="agent-panel-chips">
        {sortedTargets.map(t => (
          <button
            key={t.user_id}
            data-testid="agent-panel-chip"
            className={`agent-panel-chip${t.is_cc ? ' cc' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault(); // textarea のフォーカスを維持
              onSelectTarget(t.display_name);
            }}
          >
            @{t.display_name}
          </button>
        ))}
      </div>

      {shown.length > 0 && (
        <>
          <div className="agent-panel-section">最近の指示</div>
          <div className="agent-panel-list" ref={listRef}>
            {shown.map((h, i) => (
              <button
                key={h.message_id}
                data-testid="agent-panel-item"
                data-message-id={h.message_id}
                aria-selected={i === index}
                className={`agent-panel-item${i === index ? ' selected' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectHistory(h.content);
                }}
              >
                <span className="agent-panel-item-text">
                  <span className={`agent-panel-item-target${ccNames.has(h.target) ? ' cc' : ''}`}>@{h.target}</span>
                  <span className="agent-panel-item-body">{h.body}</span>
                </span>
                <span className="agent-panel-item-time">{formatRelativeDay(h.created_at)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default AgentPanel;
