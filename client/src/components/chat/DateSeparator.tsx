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
        ? <button type="button" onClick={onClick} aria-label={`${label} — 日付へ移動`}>{label}</button>
        : <span>{label}</span>}
    </div>
  );
}

export default DateSeparator;
