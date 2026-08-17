import { Download } from 'lucide-react';
import TextFilePreview, { isTextFile } from './TextFilePreview';
import type { MediaItem } from '../../types';
import './ImageGrid.css';

// message_media row は file_path / thumbnail_path を返す (types.ts の MediaItem には未定義)
export type GridMediaItem = MediaItem & { file_path?: string; thumbnail_path?: string | null };

interface ImageGridProps {
  media: GridMediaItem[];
  onImageClick: (images: GridMediaItem[], index: number) => void;
}

function ImageGrid({ media, onImageClick }: ImageGridProps) {
  const images = media.filter((m) => m.mime_type.startsWith('image/'));
  const others = media.filter((m) => !m.mime_type.startsWith('image/'));

  const downloadAll = (e: React.MouseEvent) => {
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
                  alt={img.file_name || undefined}
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
        // ★ 音声はその場に再生バーを出す (動画と同じ扱い)。
        //   通話履歴の .m4a は「クリック = 即ダウンロード」しか無く、聞くだけでも
        //   ファイルが溜まっていた。文字起こしを読みながら音を確かめる使い方が主なので、
        //   バブル内で再生できる方が合う。★ ダウンロードは下のリンクとして残す (#246 を壊さない)。
        //   preload="metadata" — 1 room に何十件も並ぶので本体は先読みしない。
        //   ただし尺とシークバーは出したいので metadata までは取る。
        const isAudio = m.mime_type.startsWith('audio/');
        // #246: download attribute 必須 — 旧 implementation は target="_blank"
        //   + onClick window.open() で新タブ inline 表示していたが、browser save 時に
        //   URL basename (cryptic timestamp + hash) で保存される UX 不備があった。
        //   `<a download={file_name}>` で原本名で DL する native 挙動に変更。
        //   stopPropagation のみ keep (parent click 干渉防止)。
        return (
          <div key={m.id} className="media-file-wrapper">
            {isAudio && (
              <audio
                src={`/media/${m.file_path}`}
                controls
                preload="metadata"
                className="media-audio"
                onClick={(e) => e.stopPropagation()}
              />
            )}
            <a href={`/media/${m.file_path}`}
               download={m.file_name}
               rel="noopener noreferrer"
               className={`media-file${isAudio ? ' media-file-compact' : ''}`}
               onClick={(e) => e.stopPropagation()}>
              📎 {m.file_name}
            </a>
            {/* text file (= MD / .txt / .json / source code 等) は inline preview 折り畳み (= #289 Phase 2.1)
                Chrome Android 等で download → external app の encoding 認識問題回避 */}
            {isTextFile(m) && <TextFilePreview media={m} />}
          </div>
        );
      })}
    </div>
  );
}

export default ImageGrid;
