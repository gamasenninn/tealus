import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { Tag } from 'lucide-react';
import { useConfirm } from '../../stores/confirmStore';
import type { Tag as TagType } from '../../types';
import './TagModal.css';

// メッセージ付与タグの応答行 (server は id で返す。types.ts の MessageTag は tag_id で実態と差分あり)
interface MessageTagRow {
  id: string;
  name: string;
}

interface TagModalProps {
  messageId: string;
  onClose: () => void;
  onTagsChanged?: () => void;
}

function TagModal({ messageId, onClose, onTagsChanged }: TagModalProps) {
  const { roomId } = useParams() as { roomId: string };
  const confirm = useConfirm();
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<TagType[]>([]);
  const [recentTags, setRecentTags] = useState<TagType[]>([]);
  const [messageTags, setMessageTags] = useState<MessageTagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [manageMode, setManageMode] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      setMessageTags(msgTagsRes.tags as unknown as MessageTagRow[]);
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

  const addTag = async (tagName: string, tagId: string | null = null) => {
    const trimmed = tagName.trim();
    if (!trimmed && !tagId) return;

    // Already tagged?
    if (messageTags.some(t => t.id === tagId || t.name === trimmed)) return;

    try {
      const res = await api.addMessageTag(messageId, tagId ? { tag_id: tagId } : { name: trimmed }) as unknown as { tag: MessageTagRow };
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

  const removeTag = async (tagId: string) => {
    try {
      await api.removeMessageTag(messageId, tagId);
      setMessageTags(prev => prev.filter(t => t.id !== tagId));
      onTagsChanged?.();
    } catch (err) {
      console.error('Tag remove error:', err);
    }
  };

  // ルームからタグ定義そのものを削除（使用中でもカスケードで外れる）
  const deleteRoomTag = async (tag: TagType) => {
    const used = tag.usage_count ?? 0;
    const ok = await confirm({
      body: used > 0
        ? `タグ「${tag.name}」を削除しますか？\n${used}件のメッセージからも外れます。`
        : `タグ「${tag.name}」を削除しますか？`,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;

    try {
      await api.deleteRoomTag(roomId, tag.id);
      setRecentTags(prev => prev.filter(t => t.id !== tag.id));
      // このメッセージに付いていたら表示からも外す
      if (messageTags.some(t => t.id === tag.id)) {
        setMessageTags(prev => prev.filter(t => t.id !== tag.id));
        onTagsChanged?.();
      }
    } catch (err) {
      console.error('Room tag delete error:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      addTag(input);
    }
  };

  const isTagged = (tag: TagType) => messageTags.some(t => t.id === tag.id);

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
            <div className="tag-section-header">
              <span className="tag-section-label">最近使ったタグ:</span>
              <button
                className="tag-manage-toggle"
                onClick={() => setManageMode(m => !m)}
              >{manageMode ? '完了' : '管理'}</button>
            </div>
            <div className="tag-chips">
              {recentTags.map(tag => (
                manageMode ? (
                  <span key={tag.id} className="tag-chip manage">
                    {tag.name}
                    <button
                      className="tag-remove"
                      title="このタグをルームから削除"
                      onClick={() => deleteRoomTag(tag)}
                    >×</button>
                  </span>
                ) : (
                  <button
                    key={tag.id}
                    className={`tag-chip ${isTagged(tag) ? 'tagged' : ''}`}
                    onClick={() => !isTagged(tag) && addTag(tag.name, tag.id)}
                    disabled={isTagged(tag)}
                  >
                    {tag.name}
                  </button>
                )
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
