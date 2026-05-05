import { Terminal } from 'lucide-react';
import './MentionPicker.css';

function MentionPicker({ members, query, onSelect, onClose }) {
  const filtered = members.filter(m => {
    const name = m.display_name || '';
    return name.toLowerCase().includes((query || '').toLowerCase());
  });

  if (filtered.length === 0) return null;

  // #242: 旧 slice(0, 8) で 8 人で打ち止めして「尻切れ」体感が発生していた。
  // CSS の max-height (min(400px, 50vh)) + overflow-y: auto と組み合わせて
  // 50 人まで render、それ以上は仮想スクロールが必要だが現実的には room 内
  // member が 50 人超は稀なので simple な上限で済ませる。
  // #253: is_cc フラグの virtual user (cc-proj) は別 avatar style で人間と視覚区別
  return (
    <div className="mention-picker">
      {filtered.slice(0, 50).map(member => (
        <button
          key={member.user_id}
          className="mention-picker-item"
          onMouseDown={(e) => {
            e.preventDefault(); // textarea のフォーカスを維持
            onSelect(member.display_name);
          }}
        >
          {member.is_cc ? (
            <div className="mention-picker-avatar-placeholder cc">
              <Terminal size={14} />
            </div>
          ) : member.avatar_url ? (
            <img src={`/media/${member.avatar_url}`} alt="" className="mention-picker-avatar" />
          ) : (
            <div className="mention-picker-avatar-placeholder">
              {(member.display_name || '?').charAt(0)}
            </div>
          )}
          <span className="mention-picker-name">{member.display_name}</span>
        </button>
      ))}
    </div>
  );
}

export default MentionPicker;
