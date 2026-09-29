import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '../../services/api';
import './DateJumpCalendar.css';

/**
 * #476 日付へ飛ぶカレンダー。
 * ★ 投稿のある日だけ押せる (空振りさせない)。月は前後に動かせるが、今月より先へは進めない
 */
interface Props {
  roomId: string;
  /** 押した札の日 (YYYY-MM-DD)。その月を開く */
  initialDate: string;
  /** 今日 (YYYY-MM-DD)。テストで固定できるように外から渡せる */
  today?: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function DateJumpCalendar({ roomId, initialDate, today = todayKey(), onPick, onClose }: Props) {
  const [year, setYear] = useState(Number(initialDate.slice(0, 4)));
  const [month, setMonth] = useState(Number(initialDate.slice(5, 7)));   // 1〜12
  const [days, setDays] = useState<Set<string>>(new Set());
  const monthKey = `${year}-${pad(month)}`;

  useEffect(() => {
    let alive = true;
    setDays(new Set());
    api.getMessageDays(roomId, monthKey)
      .then((r) => { if (alive) setDays(new Set(r.days)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [roomId, monthKey]);

  const move = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };
  const isThisMonthOrLater = monthKey >= today.slice(0, 7);

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  return (
    <div className="date-jump-backdrop" onClick={onClose}>
      <div className="date-jump-panel" role="dialog" aria-label="日付へ移動" onClick={(e) => e.stopPropagation()}>
        <div className="date-jump-header">
          <button type="button" aria-label="前の月" onClick={() => move(-1)}><ChevronLeft size={20} /></button>
          <span>{year}年{month}月</span>
          <button type="button" aria-label="次の月" onClick={() => move(1)} disabled={isThisMonthOrLater}><ChevronRight size={20} /></button>
          <button type="button" aria-label="閉じる" className="date-jump-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="date-jump-grid">
          {WEEKDAYS.map((w) => <span key={w} className="date-jump-weekday">{w}</span>)}
          {Array.from({ length: firstWeekday }, (_, i) => <span key={`b${i}`} className="date-jump-blank" />)}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const key = `${monthKey}-${pad(d)}`;
            const has = days.has(key);
            const cls = ['date-jump-day', has ? 'has-posts' : '', key === initialDate ? 'current' : '', key === today ? 'today' : '']
              .filter(Boolean).join(' ');
            return (
              <button key={key} type="button" className={cls} aria-label={`${d}日`} disabled={!has} onClick={() => onPick(key)}>
                {d}
              </button>
            );
          })}
        </div>
        <p className="date-jump-hint">● のある日の、最初の投稿へ移動します</p>
      </div>
    </div>
  );
}

export default DateJumpCalendar;
