import './LinkPreview.css';

function LinkPreview({ preview }) {
  if (!preview) return null;

  return (
    <a
      className="link-preview"
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image_url && (
        <img src={preview.image_url} alt="" className="link-preview-image" />
      )}
      <div className="link-preview-info">
        {preview.title && <div className="link-preview-title">{preview.title}</div>}
        {preview.description && <div className="link-preview-desc">{preview.description}</div>}
        <div className="link-preview-url">{new URL(preview.url).hostname}</div>
      </div>
    </a>
  );
}

export default LinkPreview;
