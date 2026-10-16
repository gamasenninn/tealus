import './DateSeparator.css';

interface DateSeparatorProps {
  date: string;
  hidden?: boolean;
  /** #476 押すとカレンダーを開く。無ければ今までどおりの札 */
  onClick?: () => void;
  /** #476 日ごとのまとまりの先頭に置き、スクロール中も画面の上に貼り付ける */
  sticky?: boolean;
}

function DateSeparator({ date, hidden, onClick, sticky }: DateSeparatorProps) {
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (target.getTime() === today.getTime()) return '今日';
    if (target.getTime() === yesterday.getTime()) return '昨日';

    return d.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const label = formatDate(date);
  return (
    <div className={`date-separator ${hidden ? 'hidden' : ''} ${sticky ? 'sticky' : ''}`}>
      {onClick
        ? (
          // ★ 暦の印 (10-16)。印が無く、見た目で押せると分からなかった (14 日で 61 回、ほぼ 1 人)
          <button type="button" onClick={onClick} aria-label={`${label} — 日付へ移動`} title="押すと日付を選んで移動できます">
            <svg className="date-separator-icon" aria-hidden="true" viewBox="0 0 16 16" width="11" height="11">
              <rect x="1.5" y="2.5" width="13" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M1.5 6.5h13M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {label}
          </button>
        )
        : <span>{label}</span>}
    </div>
  );
}

export default DateSeparator;
