import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api } from '../../services/api';
import BottomNav from '../common/BottomNav';
import './HomePage.css';

function HomePage() {
  const [activeTab, setActiveTab] = useState('announcements');
  const [announcements, setAnnouncements] = useState([]);
  const [portalLinks, setPortalLinks] = useState([]);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  // Portal iframe load 状態 ('loading' | 'loaded' | 'timeout')
  // X-Frame-Options block 時は load event がまだ発火するため timeout 検出だけでは
  // 不十分。常時表示の「新タブで開く」 button と組み合わせて user の動線確保。
  const [iframeState, setIframeState] = useState('loading');
  const iframeRef = useRef(null);
  const iframeTimeoutRef = useRef(null);

  useEffect(() => {
    loadAnnouncements();
    loadPortalLinks();
  }, []);

  // activeTab が portal-* に切り替わった時、iframe load の watch を仕掛ける
  useEffect(() => {
    if (activeTab.startsWith('portal-')) {
      startIframeLoadWatch();
    }
    return () => {
      if (iframeTimeoutRef.current) {
        clearTimeout(iframeTimeoutRef.current);
        iframeTimeoutRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const startIframeLoadWatch = () => {
    setIframeState('loading');
    if (iframeTimeoutRef.current) clearTimeout(iframeTimeoutRef.current);
    iframeTimeoutRef.current = setTimeout(() => {
      setIframeState((s) => (s === 'loading' ? 'timeout' : s));
    }, 5000);
  };

  const handleIframeLoad = () => {
    setIframeState('loaded');
    if (iframeTimeoutRef.current) {
      clearTimeout(iframeTimeoutRef.current);
      iframeTimeoutRef.current = null;
    }
  };

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
                startIframeLoadWatch();
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
                    {(title || msg.is_unread) && (
                      <div className="announcement-header">
                        {msg.is_unread && <span className="announcement-unread-dot" />}
                        {title && <h2 className="announcement-title">{title}</h2>}
                      </div>
                    )}

                    {body && (
                      <div className={`announcement-body ${!isExpanded && isLong ? 'collapsed' : ''}`}>
                        <Markdown remarkPlugins={[remarkGfm]}>{isExpanded || !isLong ? body : body.slice(0, 150) + '...'}</Markdown>
                      </div>
                    )}

                    {isLong && (
                      <button className="announcement-expand" onClick={() => toggleExpand(msg.id)}>
                        {isExpanded ? '閉じる' : 'もっと見る'}
                      </button>
                    )}

                    {msg.media?.length > 0 && (
                      <div className="announcement-media">
                        {msg.media.map(m => {
                          if (m.mime_type?.startsWith('image/')) {
                            return <img key={m.id} src={`/media/${m.file_path}`} alt="" className="announcement-image" />;
                          }
                          if (m.mime_type?.startsWith('video/')) {
                            return <video key={m.id} src={`/media/${m.file_path}`} controls className="announcement-video" />;
                          }
                          if (m.mime_type?.startsWith('audio/')) {
                            return <audio key={m.id} src={`/media/${m.file_path}`} controls className="announcement-audio" />;
                          }
                          return (
                            <a key={m.id} href={`/media/${m.file_path}`} target="_blank" rel="noopener noreferrer" className="announcement-file">
                              {m.file_name || 'ファイル'}
                            </a>
                          );
                        })}
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

        {activeTab.startsWith('portal-') && (() => {
          const portal = tabs.find(t => t.id === activeTab);
          return (
            <div className="home-iframe-wrapper">
              <iframe
                ref={iframeRef}
                className="home-iframe"
                src={portal?.url}
                title={portal?.label}
                allow="microphone; camera; autoplay; fullscreen"
                onLoad={handleIframeLoad}
              />
              {portal?.url && (
                <a
                  href={portal.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="home-iframe-open-external"
                  title="新タブで開く"
                  aria-label="新タブで開く"
                >
                  ↗
                </a>
              )}
              {iframeState === 'loading' && (
                <div className="home-iframe-overlay loading">
                  <div className="home-iframe-spinner" />
                  <p>読み込み中...</p>
                </div>
              )}
              {iframeState === 'timeout' && (
                <div className="home-iframe-overlay timeout">
                  <p className="home-iframe-overlay-title">読み込みに時間がかかっています</p>
                  <p className="home-iframe-overlay-msg">
                    サイトが埋め込み表示を許可していない可能性があります。新タブで開いてみてください。
                  </p>
                  {portal?.url && (
                    <a
                      href={portal.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="home-iframe-overlay-button"
                    >
                      新タブで開く
                    </a>
                  )}
                  <button
                    className="home-iframe-overlay-dismiss"
                    onClick={() => setIframeState('loaded')}
                  >
                    閉じる
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <BottomNav />
    </div>
  );
}

export default HomePage;
