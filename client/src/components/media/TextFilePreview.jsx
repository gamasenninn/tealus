import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import './TextFilePreview.css';

const TEXT_EXTENSIONS = [
  '.md', '.markdown', '.txt', '.json', '.csv', '.tsv',
  '.yaml', '.yml', '.log', '.xml', '.html', '.htm',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.cs', '.php',
  '.sh', '.bash', '.zsh', '.sql', '.css', '.scss',
];

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/**
 * media (= message_media row) が text として preview 可能か判定
 * - mime_type が text/* or application/json/xml
 * - または file_name 拡張子が TEXT_EXTENSIONS のいずれか
 */
export function isTextFile(media) {
  if (!media) return false;
  const mime = (media.mime_type || '').toLowerCase();
  if (mime.startsWith('text/')) return true;
  if (mime === 'application/json' || mime === 'application/xml') return true;
  const fileName = (media.file_name || '').toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/**
 * media が markdown rendering 対象か判定 (= 拡張子 .md/.markdown or mime text/markdown)
 */
export function isMarkdownFile(media) {
  if (!media) return false;
  const mime = (media.mime_type || '').toLowerCase();
  if (mime === 'text/markdown') return true;
  const fileName = (media.file_name || '').toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

const MAX_PREVIEW_BYTES = 256 * 1024; // 256KB 超過は警告 + 切り捨て

/**
 * text file (= MD / .txt / .json / .csv / source code 等) の inline preview
 * - 折り畳み default、tap で expand
 * - UTF-8 で fetch + decode (= Chrome Android 等の charset 認識問題回避)
 * - markdown は既存 react-markdown + remarkGfm + remarkBreaks で rendering
 *   (= MessageBubble.jsx と同 plugin = Tealus 内 markdown 統一感)
 * - その他 text は <pre> で raw 表示 (= source code / log 等)
 */
export default function TextFilePreview({ media }) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!expanded || content !== null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/media/${media.file_path}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        if (text.length > MAX_PREVIEW_BYTES) {
          setContent(text.slice(0, MAX_PREVIEW_BYTES));
          setTruncated(true);
        } else {
          setContent(text);
          setTruncated(false);
        }
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [expanded, media.file_path, content]);

  const isMd = isMarkdownFile(media);

  return (
    <div className="text-file-preview">
      <button
        type="button"
        className="text-file-preview__toggle"
        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
        aria-expanded={expanded}
      >
        {expanded ? '▼ プレビューを閉じる' : '▶ プレビューを開く'}
      </button>
      {expanded && (
        <div className="text-file-preview__body">
          {loading && <span className="text-file-preview__status">読み込み中...</span>}
          {error && <span className="text-file-preview__error">エラー: {error}</span>}
          {content !== null && (
            <>
              {isMd ? (
                <div className="text-file-preview__markdown">
                  <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</Markdown>
                </div>
              ) : (
                <pre className="text-file-preview__pre">{content}</pre>
              )}
              {truncated && (
                <div className="text-file-preview__truncated">
                  ⚠ 大きすぎるため先頭 {MAX_PREVIEW_BYTES / 1024}KB のみ表示。全体を見るにはダウンロードしてください。
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
