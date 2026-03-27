import { useState, useEffect, useCallback } from 'react';
import './ImageViewer.css';

function ImageViewer({ images, initialIndex, onClose }) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const current = images[currentIndex];

  const goNext = useCallback(() => {
    if (currentIndex < images.length - 1) setCurrentIndex(currentIndex + 1);
  }, [currentIndex, images.length]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  }, [currentIndex]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev]);

  return (
    <div className="viewer-overlay" onClick={onClose}>
      <button className="viewer-close" onClick={onClose}>✕</button>

      <div className="viewer-content" onClick={(e) => e.stopPropagation()}>
        {currentIndex > 0 && (
          <button className="viewer-nav viewer-prev" onClick={goPrev}>‹</button>
        )}

        <img
          src={`/media/${current.file_path}`}
          alt={current.file_name}
          className="viewer-image"
        />

        {currentIndex < images.length - 1 && (
          <button className="viewer-nav viewer-next" onClick={goNext}>›</button>
        )}
      </div>

      {images.length > 1 && (
        <div className="viewer-counter">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
}

export default ImageViewer;
