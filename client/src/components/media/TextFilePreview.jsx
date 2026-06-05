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

/**
 * media が JSON 対象か判定 (= 拡張子 .json or mime application/json)
 */
export function isJsonFile(media) {
  if (!media) return false;
  const mime = (media.mime_type || '').toLowerCase();
  if (mime === 'application/json') return true;
  const fileName = (media.file_name || '').toLowerCase();
  return fileName.endsWith('.json');
}

/**
 * media が CSV / TSV 対象か判定 (= 拡張子 .csv/.tsv or mime text/csv)
 */
export function isCsvFile(media) {
  if (!media) return false;
  const mime = (media.mime_type || '').toLowerCase();
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') return true;
  const fileName = (media.file_name || '').toLowerCase();
  return fileName.endsWith('.csv') || fileName.endsWith('.tsv');
}

/**
 * JSON を自動成形 (= parse → stringify with indent 2)、parse fail なら raw text 返す
 */
export function formatJson(text) {
  try {
    const obj = JSON.parse(text);
    return { formatted: JSON.stringify(obj, null, 2), ok: true };
  } catch {
    return { formatted: text, ok: false };
  }
}

/**
 * CSV/TSV を rows 2D array に parse (= 簡易 RFC 4180、" escape 対応)
 * separator は ',' or '\t'、空行は skip
 */
export function parseCsv(text, separator = ',') {
  const rows = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line === '') continue;
    const cells = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === separator && !inQuote) {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
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
  const isJson = isJsonFile(media);
  const isCsv = isCsvFile(media);

  // CSV/TSV 自動 separator 判定 (= .tsv なら tab、それ以外 ,)
  const csvSeparator = (media.file_name || '').toLowerCase().endsWith('.tsv') ? '\t' : ',';

  const renderBody = () => {
    if (isMd) {
      return (
        <div className="text-file-preview__markdown">
          <Markdown remarkPlugins={[remarkGfm, remarkBreaks]}>{content}</Markdown>
        </div>
      );
    }
    if (isJson) {
      const { formatted, ok } = formatJson(content);
      return (
        <>
          <pre className="text-file-preview__pre">{formatted}</pre>
          {!ok && (
            <div className="text-file-preview__notice">
              ⚠ JSON parse 失敗 (= 不正な形式)、raw text で表示
            </div>
          )}
        </>
      );
    }
    if (isCsv) {
      const rows = parseCsv(content, csvSeparator);
      if (rows.length === 0) return <pre className="text-file-preview__pre">{content}</pre>;
      const [header, ...body] = rows;
      return (
        <div className="text-file-preview__table-wrapper">
          <table className="text-file-preview__table">
            <thead>
              <tr>{header.map((cell, i) => <th key={i}>{cell}</th>)}</tr>
            </thead>
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <pre className="text-file-preview__pre">{content}</pre>;
  };

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
              {renderBody()}
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
