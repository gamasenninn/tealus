import './ImageGrid.css';

function ImageGrid({ media, onImageClick }) {
  const images = media.filter((m) => m.mime_type.startsWith('image/'));
  const others = media.filter((m) => !m.mime_type.startsWith('image/'));

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
      )}
      {others.map((m) => {
        if (m.mime_type.startsWith('video/')) {
          return (
            <video key={m.id} src={`/media/${m.file_path}`} controls className="media-video" />
          );
        }
        return (
          <a key={m.id} href={`/media/${m.file_path}`} className="media-file" onClick={async (e) => {
            e.preventDefault();
            try {
              const res = await fetch(`/media/${m.file_path}`);
              const blob = await res.blob();
              const url = window.URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = m.file_name;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              window.URL.revokeObjectURL(url);
            } catch (err) {
              window.open(`/media/${m.file_path}`, '_blank');
            }
          }}>
            📎 {m.file_name}
          </a>
        );
      })}
    </div>
  );
}

export default ImageGrid;
