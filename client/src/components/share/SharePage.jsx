import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import { ArrowLeft, Send } from 'lucide-react';
import './SharePage.css';

function SharePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { rooms, fetchRooms } = useRoomStore();
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [sharedFiles, setSharedFiles] = useState([]);

  // 共有データ
  const sharedText = searchParams.get('text') || '';
  const sharedTitle = searchParams.get('title') || '';
  const sharedUrl = searchParams.get('url') || '';
  const fileCount = parseInt(searchParams.get('files') || '0');

  // 共有内容をまとめる
  const sharedContent = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n');

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // Cache API からファイルを取得
  useEffect(() => {
    if (fileCount === 0) return;
    (async () => {
      try {
        const cache = await caches.open('share-target');
        const files = [];
        for (let i = 0; i < fileCount; i++) {
          const response = await cache.match(`/share-file-${i}`);
          if (response) {
            const blob = await response.blob();
            files.push(new File([blob], `shared-${i}.${blob.type.split('/')[1] || 'bin'}`, { type: blob.type }));
          }
        }
        setSharedFiles(files);
        // キャッシュをクリア
        const keys = await cache.keys();
        await Promise.all(keys.map((k) => cache.delete(k)));
      } catch (err) {
        console.error('[share] Failed to load files from cache:', err);
      }
    })();
  }, [fileCount]);

  const getRoomDisplayName = (room) => {
    if (room.type === 'group') return room.name;
    return room.partner_display_name || 'トーク';
  };

  const filteredRooms = rooms.filter((room) => {
    if (!search) return true;
    const name = getRoomDisplayName(room).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handleSend = async (roomId) => {
    if (sending) return;
    setSending(true);
    try {
      // テキスト/URL があれば送信
      if (sharedContent.trim()) {
        await api.sendMessage(roomId, sharedContent.trim());
      }
      // ファイルがあればアップロード
      if (sharedFiles.length > 0) {
        await api.uploadMedia(roomId, sharedFiles);
      }
      // 該当ルームに遷移
      navigate(`/rooms/${roomId}`, { replace: true });
    } catch (err) {
      console.error('[share] Send failed:', err);
      alert('送信に失敗しました: ' + err.message);
      setSending(false);
    }
  };

  return (
    <div className="share-container">
      <header className="share-header">
        <button className="share-back" onClick={() => navigate('/talk')}>
          <ArrowLeft size={22} />
        </button>
        <h1>共有先を選択</h1>
      </header>

      {/* 共有内容プレビュー */}
      <div className="share-preview">
        {sharedContent && (
          <div className="share-preview-text">
            {sharedContent.length > 100 ? sharedContent.slice(0, 100) + '...' : sharedContent}
          </div>
        )}
        {sharedFiles.length > 0 && (
          <div className="share-preview-files">
            {sharedFiles.map((f, i) => (
              <span key={i} className="share-preview-file">
                {f.type.startsWith('image/') ? '🖼️' : '📎'} {f.name}
              </span>
            ))}
          </div>
        )}
        {!sharedContent && sharedFiles.length === 0 && (
          <div className="share-preview-empty">共有データがありません</div>
        )}
      </div>

      {/* 検索 */}
      <div className="share-search">
        <input
          type="text"
          placeholder="ルームを検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ルーム一覧 */}
      <div className="share-room-list">
        {filteredRooms.map((room) => (
          <button
            key={room.id}
            className="share-room-item"
            onClick={() => handleSend(room.id)}
            disabled={sending}
          >
            <div className="share-room-avatar">
              {room.type === 'group' ? '🏠' : '👤'}
            </div>
            <div className="share-room-name">{getRoomDisplayName(room)}</div>
            <Send size={16} className="share-room-send" />
          </button>
        ))}
      </div>

      {sending && <div className="share-sending">送信中...</div>}
    </div>
  );
}

export default SharePage;
