import { Download } from 'lucide-react';
import './ImageGrid.css';

function ImageGrid({ media, onImageClick }) {
  const images = media.filter((m) => m.mime_type.startsWith('image/'));
  const others = media.filter((m) => !m.mime_type.startsWith('image/'));

  const downloadAll = (e) => {
    e.stopPropagation();
    images.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = `/media/${img.file_path}`;
        a.download = img.file_name || `image_${i + 1}`;
        a.click();
      }, i * 300); // 300ms 間隔で連続ダウンロード
    });
  };

  const getGridClass = () => {
    switch (images.length) {
      case 1: return 'image-grid grid-1';
      case 2: return 'image-grid grid-2';
      case 3: return 'image-grid grid-3';
      case 4: return 'image-grid grid-4';
      default: return 'image-grid grid-many';
    }
  };

  return (
    <div className="media-container">
      {images.length > 0 && (
        <div className="image-grid-wrapper">
          <div className={getGridClass()}>
            {images.map((img, index) => (
              <div
                key={img.id}
                className="grid-item"
                onClick={() => onImageClick(images, index)}
              >
                <img
                  src={`/media/${img.thumbnail_path || img.file_path}`}
                  alt={img.file_name}
                  loading="lazy"
                />
              </div>
            ))}
          </div>
          <div className="grid-download-row">
            <button className="grid-download-all" onClick={downloadAll} title="全画像をダウンロード">
              <Download size={12} /> 全{images.length}枚
            </button>
          </div>
        </div>
      )}
      {others.map((m) => {
        if (m.mime_type.startsWith('video/')) {
          return (
            <video key={m.id} src={`/media/${m.file_path}`} controls className="media-video" />
          );
        }
        return (
          <a key={m.id} href={`/media/${m.file_path}`} target="_blank" rel="noopener noreferrer" className="media-file" onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            window.open(`/media/${m.file_path}`, '_blank');
          }}>
            📎 {m.file_name}
          </a>
        );
      })}
    </div>
  );
}

export default ImageGrid;
