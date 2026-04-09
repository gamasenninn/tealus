import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { Tag } from 'lucide-react';
import './TagModal.css';

function TagModal({ messageId, onClose, onTagsChanged }) {
  const { roomId } = useParams();
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [recentTags, setRecentTags] = useState([]);
  const [messageTags, setMessageTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);

  useEffect(() => {
    loadData();
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const loadData = async () => {
    try {
      const [tagsRes, msgTagsRes] = await Promise.all([
        api.getRoomTags(roomId),
        api.getMessageTags(messageId),
      ]);
      setRecentTags(tagsRes.tags.slice(0, 10));
      setMessageTags(msgTagsRes.tags);
    } catch (err) {
      console.error('Tag load error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!input.trim()) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.suggestTags(roomId, input.trim());
        setSuggestions(res.tags);
      } catch (err) {
        console.error('Suggest error:', err);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [input, roomId]);

  const addTag = async (tagName, tagId = null) => {
    const trimmed = tagName.trim();
    if (!trimmed && !tagId) return;

    // Already tagged?
    if (messageTags.some(t => t.id === tagId || t.name === trimmed)) return;

    try {
      const res = await api.addMessageTag(messageId, tagId ? { tag_id: tagId } : { name: trimmed });
      setMessageTags(prev => [...prev, res.tag]);
      setInput('');
      setSuggestions([]);
      onTagsChanged?.();
      // Refresh recent tags
      const tagsRes = await api.getRoomTags(roomId);
      setRecentTags(tagsRes.tags.slice(0, 10));
    } catch (err) {
      console.error('Tag add error:', err);
    }
  };

  const removeTag = async (tagId) => {
    try {
      await api.removeMessageTag(messageId, tagId);
      setMessageTags(prev => prev.filter(t => t.id !== tagId));
      onTagsChanged?.();
    } catch (err) {
      console.error('Tag remove error:', err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      addTag(input);
    }
  };

  const isTagged = (tag) => messageTags.some(t => t.id === tag.id);

  return (
    <div className="modal-overlay z-high" onClick={onClose}>
      <div className="modal-box tag-modal" onClick={e => e.stopPropagation()}>
        <h3><Tag size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} /> タグを追加</h3>

        <div className="tag-input-row">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="タグを入力..."
            className="tag-input"
          />
          <button
            className="tag-add-btn"
            onClick={() => addTag(input)}
            disabled={!input.trim()}
          >+</button>
        </div>

        {suggestions.length > 0 && (
          <div className="tag-suggestions">
            {suggestions.map(tag => (
              <div
                key={tag.id}
                className={`tag-suggestion-item ${isTagged(tag) ? 'tagged' : ''}`}
                onClick={() => !isTagged(tag) && addTag(tag.name, tag.id)}
              >
                <span>{tag.name}</span>
                <span className="tag-count">({tag.usage_count})</span>
              </div>
            ))}
          </div>
        )}

        {!input && recentTags.length > 0 && (
          <div className="tag-section">
            <div className="tag-section-label">最近使ったタグ:</div>
            <div className="tag-chips">
              {recentTags.map(tag => (
                <button
                  key={tag.id}
                  className={`tag-chip ${isTagged(tag) ? 'tagged' : ''}`}
                  onClick={() => !isTagged(tag) && addTag(tag.name, tag.id)}
                  disabled={isTagged(tag)}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {messageTags.length > 0 && (
          <div className="tag-section">
            <div className="tag-section-label">このメッセージのタグ:</div>
            <div className="tag-chips">
              {messageTags.map(tag => (
                <span key={tag.id} className="tag-chip active">
                  {tag.name}
                  <button className="tag-remove" onClick={() => removeTag(tag.id)}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: '16px', textAlign: 'center' }}>
          <button className="btn-cancel" onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  );
}

export default TagModal;
