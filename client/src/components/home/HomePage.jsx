import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { api } from '../../services/api';
import BottomNav from '../common/BottomNav';
import './HomePage.css';

function HomePage() {
  const [activeTab, setActiveTab] = useState('announcements');
  const [announcements, setAnnouncements] = useState([]);
  const [portalLinks, setPortalLinks] = useState([]);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef(null);

  useEffect(() => {
    loadAnnouncements();
    loadPortalLinks();
  }, []);

  const loadPortalLinks = async () => {
    try {
      const data = await api.getPortalLinks();
      setPortalLinks(data.links || []);
    } catch (err) {
      console.error('Load portal links error:', err);
    }
  };

  const loadAnnouncements = async () => {
    try {
      const data = await api.getAnnouncements();
      setAnnouncements(data.messages || []);

      // 未読メッセージを既読にする
      const unreadMsgs = (data.messages || []).filter(m => m.is_unread);
      if (unreadMsgs.length > 0) {
        // ルームごとにグループ化してmarkRead
        const byRoom = {};
        unreadMsgs.forEach(m => {
          if (!byRoom[m.room_id]) byRoom[m.room_id] = [];
          byRoom[m.room_id].push(m.id);
        });
        Object.entries(byRoom).forEach(([roomId, ids]) => {
          api.markRead(roomId, ids).catch(() => {});
        });
      }
    } catch (err) {
      console.error('Load announcements error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const parseTitle = (content) => {
    if (!content) return { title: null, body: content };
    const lines = content.split('\n');
    const firstLine = lines[0].trim();
    if (firstLine.startsWith('#')) {
      const title = firstLine.replace(/^#+\s*/, '');
      const body = lines.slice(1).join('\n').trim();
      return { title, body };
    }
    return { title: null, body: content };
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric' });
  };

  const tabs = [
    { id: 'announcements', label: 'お知らせ' },
    ...portalLinks.map(p => ({ id: `portal-${p.id}`, label: p.title, url: p.url })),
  ];

  return (
    <div className="home-container">
      <header className="home-header">
        <h1>ホーム</h1>
      </header>

      <div className="home-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`home-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => {
              if (activeTab === tab.id && tab.url && iframeRef.current) {
                // アクティブなポータルタブを再タップ → iframe リロード
                try { iframeRef.current.contentWindow.location.reload(); } catch (e) {
                  // クロスオリジンの場合はsrc再設定でリロード
                  iframeRef.current.src = iframeRef.current.src;
                }
              } else {
                setActiveTab(tab.id);
              }
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="home-content">
        {activeTab === 'announcements' && (
          <>
            {loading ? (
              <div className="home-empty">読み込み中...</div>
            ) : announcements.length === 0 ? (
              <div className="home-empty">お知らせはありません</div>
            ) : (
              announcements.map(msg => {
                // 音声メッセージは文字起こしテキストを使用
                const displayContent = msg.content || msg.transcription?.formatted_text || msg.transcription?.raw_text || '';
                const { title, body } = parseTitle(displayContent);
                const isExpanded = expandedIds.has(msg.id);
                const isLong = body && body.length > 150;

                return (
                  <div key={msg.id} className="announcement-card">
                    <div className="announcement-header">
                      {msg.is_unread && <span className="announcement-unread-dot" />}
                      <h2 className="announcement-title">{title || '(無題)'}</h2>
                    </div>

                    {body && (
                      <div className={`announcement-body ${!isExpanded && isLong ? 'collapsed' : ''}`}>
                        <Markdown>{isExpanded || !isLong ? body : body.slice(0, 150) + '...'}</Markdown>
                      </div>
                    )}

                    {isLong && (
                      <button className="announcement-expand" onClick={() => toggleExpand(msg.id)}>
                        {isExpanded ? '閉じる' : 'もっと見る'}
                      </button>
                    )}

                    {msg.media?.length > 0 && (
                      <div className="announcement-media">
                        {msg.media.map(m => (
                          m.mime_type?.startsWith('image/') && (
                            <img key={m.id} src={`/media/${m.file_path}`} alt="" className="announcement-image" />
                          )
                        ))}
                      </div>
                    )}

                    <div className="announcement-footer">
                      <span>{msg.sender_display_name}</span>
                      <span>{formatDate(msg.created_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab.startsWith('portal-') && (
          <iframe
            ref={iframeRef}
            className="home-iframe"
            src={tabs.find(t => t.id === activeTab)?.url}
            title={tabs.find(t => t.id === activeTab)?.label}
          />
        )}
      </div>

      <BottomNav />
    </div>
  );
}

export default HomePage;
