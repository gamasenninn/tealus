import './DateSeparator.css';

function DateSeparator({ date }) {
  const formatDate = (dateStr) => {
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

  return (
    <div className="date-separator">
      <span>{formatDate(date)}</span>
    </div>
  );
}

export default DateSeparator;
