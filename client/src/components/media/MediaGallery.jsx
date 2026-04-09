import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import ImageViewer from './ImageViewer';
import { ArrowLeft } from 'lucide-react';
import './MediaGallery.css';

function MediaGallery() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [viewerState, setViewerState] = useState(null);
  const [videoPlayer, setVideoPlayer] = useState(null);
  const [roomName, setRoomName] = useState('');

  const loadMedia = useCallback(async (offset = 0, append = false) => {
    try {
      setLoading(true);
      const res = await api.getMediaGallery(roomId, {
        tag: selectedTag,
        category: selectedCategory,
        offset,
        limit: 30,
      });
      setMedia(prev => append ? [...prev, ...res.media] : res.media);
      setHasMore(res.has_more);
    } catch (err) {
      console.error('Gallery load error:', err);
    } finally {
      setLoading(false);
    }
  }, [roomId, selectedTag, selectedCategory]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  useEffect(() => {
    const loadTags = async () => {
      try {
        const [tagsRes, roomRes] = await Promise.all([
          api.getRoomTags(roomId),
          api.getRoom(roomId),
        ]);
        setTags(tagsRes.tags);
        setRoomName(roomRes.room?.name || 'DM');
      } catch (err) {
        console.error('Tags load error:', err);
      }
    };
    loadTags();
  }, [roomId]);

  const loadMore = () => {
    if (!loading && hasMore) {
      loadMedia(media.length, true);
    }
  };

  const images = media.filter(m => m.mime_type?.startsWith('image/'));

  const handleImageClick = (index) => {
    const imageItems = images.map(m => ({
      file_path: m.file_path,
      thumbnail_path: m.thumbnail_path,
      file_name: m.file_name,
    }));
    setViewerState({ images: imageItems, index });
  };

  const getDocIcon = (fileName) => {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const icons = {
      pdf: '📄', doc: '📝', docx: '📝',
      xls: '📊', xlsx: '📊', csv: '📊',
      ppt: '📑', pptx: '📑',
      txt: '📋', md: '📋', rtf: '📋',
      zip: '📦', rar: '📦', '7z': '📦',
      json: '🔧', xml: '🔧', yaml: '🔧', yml: '🔧',
    };
    return icons[ext] || '📎';
  };

  const getDocExt = (fileName) => {
    const ext = (fileName || '').split('.').pop().toUpperCase();
    return ext || '';
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="gallery-container">
      <header className="gallery-header">
        <button className="icon-button" onClick={() => navigate(-1)}><ArrowLeft size={22} /></button>
        <h1>{roomName} — ファイル</h1>
      </header>

      <div className="gallery-category-filter">
        {[
          { key: null, label: 'すべて' },
          { key: 'image', label: '画像' },
          { key: 'video', label: '動画' },
          { key: 'audio', label: '音声' },
          { key: 'document', label: 'ドキュメント' },
        ].map(cat => (
          <button
            key={cat.key || 'all'}
            className={`gallery-category-chip ${selectedCategory === cat.key ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat.key)}
          >{cat.label}</button>
        ))}
      </div>

      {tags.length > 0 && (
        <div className="gallery-tag-filter">
          {tags.map(tag => (
            <button
              key={tag.id}
              className={`gallery-tag-chip ${selectedTag === tag.id ? 'active' : ''}`}
              onClick={() => setSelectedTag(selectedTag === tag.id ? null : tag.id)}
            >
              #{tag.name}
              <span className="gallery-tag-count">{tag.usage_count}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && media.length === 0 && (
        <div className="gallery-empty">
          {selectedTag ? 'このタグのメディアはありません' : 'メディアはまだありません'}
        </div>
      )}

      <div className="gallery-grid">
        {media.map((item, index) => {
          const isImage = item.mime_type?.startsWith('image/');
          const isVideo = item.mime_type?.startsWith('video/');
          const isAudio = item.mime_type?.startsWith('audio/');
          const imageIndex = isImage ? images.indexOf(item) : -1;

          return (
            <div
              key={item.id || index}
              className="gallery-item"
              onClick={() => {
                if (isImage) handleImageClick(imageIndex);
                else if (isVideo) setVideoPlayer(item);
                else if (isAudio) setVideoPlayer(item);
                else window.open(`/media/${item.file_path}`, '_blank');
              }}
            >
              {isImage ? (
                <img
                  src={`/media/${item.thumbnail_path || item.file_path}`}
                  alt={item.file_name}
                  loading="lazy"
                />
              ) : isVideo ? (
                item.thumbnail_path ? (
                  <div className="gallery-video-thumb has-thumb">
                    <img
                      src={`/media/${item.thumbnail_path}`}
                      alt={item.file_name}
                      loading="lazy"
                    />
                    <span className="gallery-play-icon">▶</span>
                  </div>
                ) : (
                  <div className="gallery-video-thumb">
                    <span>🎬</span>
                    <span className="gallery-file-label">{item.file_name}</span>
                  </div>
                )
              ) : isAudio ? (
                <div className="gallery-file-thumb">
                  <span>🎵</span>
                  <span className="gallery-file-label">{item.file_name}</span>
                </div>
              ) : (
                <div className="gallery-file-thumb">
                  <span>{getDocIcon(item.file_name)}</span>
                  <span className="gallery-file-ext">{getDocExt(item.file_name)}</span>
                  <span className="gallery-file-label">{item.file_name}</span>
                </div>
              )}
              <div className="gallery-item-date">{formatDate(item.message_created_at)}</div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <div className="gallery-load-more">
          <button onClick={loadMore} disabled={loading}>
            {loading ? '読み込み中...' : 'もっと見る'}
          </button>
        </div>
      )}

      {viewerState && (
        <ImageViewer
          images={viewerState.images}
          initialIndex={viewerState.index}
          onClose={() => setViewerState(null)}
        />
      )}

      {videoPlayer && (
        <div className="gallery-video-overlay" onClick={() => setVideoPlayer(null)}>
          <div className="gallery-video-player" onClick={e => e.stopPropagation()}>
            <button className="gallery-video-close" onClick={() => setVideoPlayer(null)}>✕</button>
            {videoPlayer.mime_type?.startsWith('audio/') ? (
              <audio
                src={`/media/${videoPlayer.file_path}`}
                controls
                autoPlay
                style={{ width: '100%', minWidth: '300px' }}
              />
            ) : (
              <video
                src={`/media/${videoPlayer.file_path}`}
                controls
                autoPlay
                style={{ maxWidth: '100%', maxHeight: '80vh' }}
              />
            )}
            <div className="gallery-video-actions">
              <a
                href={`/media/${videoPlayer.file_path}`}
                download={videoPlayer.file_name}
                className="gallery-download-btn"
              >ダウンロードして再生</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MediaGallery;
