import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { CheckSquare, Square, Plus } from 'lucide-react';
import './TodoMenu.css';

function TodoMenu({ messageId, roomId, onClose, onTagsChanged }) {
  const [todoTags, setTodoTags] = useState([]);
  const [messageTags, setMessageTags] = useState([]);
  const [newTagName, setNewTagName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    // ルームの TODO タグ一覧と、このメッセージのタグを取得
    Promise.all([
      api.getTodoTags(roomId),
      api.getMessageTags(messageId),
    ]).then(([todoData, msgData]) => {
      setTodoTags(todoData.tags || []);
      setMessageTags(msgData.tags || []);
    }).catch(console.error);
  }, [messageId, roomId]);

  const isTagged = (tagId) => messageTags.some(t => t.id === tagId);

  const toggleTag = async (tag) => {
    try {
      if (isTagged(tag.id)) {
        await api.removeMessageTag(messageId, tag.id);
      } else {
        await api.addMessageTag(messageId, { tag_id: tag.id });
      }
      // 再取得
      const res = await api.getMessageTags(messageId);
      setMessageTags(res.tags || []);
      if (onTagsChanged) onTagsChanged();
      // タグ付け後に閉じる
      onClose();
    } catch (err) {
      console.error('TODO tag toggle error:', err);
    }
  };

  const createTodoTag = async () => {
    if (!newTagName.trim() || creating) return;
    setCreating(true);
    try {
      await api.createTag(roomId, newTagName.trim(), true);
      const todoRes = await api.getTodoTags(roomId);
      setTodoTags(todoRes.tags || []);
      setNewTagName('');
    } catch (err) {
      console.error('Create TODO tag error:', err);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="todo-menu-overlay" onClick={onClose}>
      <div className="todo-menu" onClick={e => e.stopPropagation()}>
        <div className="todo-menu-title">TODO タグ</div>
        <div className="todo-menu-list">
          {todoTags.map(tag => (
            <button
              key={tag.id}
              className={`todo-menu-item ${isTagged(tag.id) ? 'active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {isTagged(tag.id) ? <CheckSquare size={18} /> : <Square size={18} />}
              <span>{tag.name}</span>
            </button>
          ))}
        </div>
        <div className="todo-menu-create">
          <input
            type="text"
            placeholder="新しい TODO タグ..."
            value={newTagName}
            onChange={e => setNewTagName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createTodoTag()}
          />
          <button onClick={createTodoTag} disabled={!newTagName.trim() || creating}>
            <Plus size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default TodoMenu;
