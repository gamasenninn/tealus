import './MentionPicker.css';

function MentionPicker({ members, query, onSelect, onClose }) {
  const filtered = members.filter(m => {
    const name = m.display_name || '';
    return name.toLowerCase().includes((query || '').toLowerCase());
  });

  if (filtered.length === 0) return null;

  return (
    <div className="mention-picker">
      {filtered.slice(0, 8).map(member => (
        <button
          key={member.user_id}
          className="mention-picker-item"
          onMouseDown={(e) => {
            e.preventDefault(); // textarea のフォーカスを維持
            onSelect(member.display_name);
          }}
        >
          {member.avatar_url ? (
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
