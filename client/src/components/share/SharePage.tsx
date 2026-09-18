import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRoomStore } from '../../stores/roomStore';
import { api } from '../../services/api';
import { sendRoomMessage } from '../../services/sendRoomMessage';
import { ArrowLeft, Send } from 'lucide-react';
import type { Room } from '../../types';
import { planShare } from './sharePlan';
import { diagnoseShare, type ShareRecord } from './shareDiagnosis';
import './SharePage.css';

/**
 * ★ #445 (2026-09-18): 制御中の SW に版を尋ねる。
 *
 * ★★ **旧版は message listener を持たないので黙る。** ★★★ 「返事が無い」こと自体が
 *   「旧 SW が制御している」の証拠になる (★ 沈黙を情報に変える)。
 */
function askServiceWorkerVersion(timeoutMs = 1000): Promise<string | null> {
  return new Promise((resolve) => {
    const controller = navigator.serviceWorker?.controller;
    if (!controller) return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve((e.data && e.data.version) || null);
    };
    try {
      controller.postMessage({ type: 'share-diag' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function SharePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { rooms, fetchRooms } = useRoomStore();
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [sharedFiles, setSharedFiles] = useState<File[]>([]);
  // ★ #445: 送るものが 0 件のときに理由を出す (★★ 黙って遷移しないため)
  const [error, setError] = useState('');
  // ★ #445 (2026-09-18): SW が置いた一度きりの記録 (★★ 読んだら消す)
  const [record, setRecord] = useState<ShareRecord | null>(null);
  const [swReplied, setSwReplied] = useState(true);
  const [diagDetail, setDiagDetail] = useState('');

  // 共有データ
  const sharedText = searchParams.get('text') || '';
  const sharedTitle = searchParams.get('title') || '';
  const sharedUrl = searchParams.get('url') || '';
  const fileCount = parseInt(searchParams.get('files') || '0');

  // 共有内容をまとめる
  const sharedContent = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n');

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  // Cache API から「一度きりの記録」とファイルを取得する
  //
  // ★★★★ 2026-09-18 (#445): 記録の読み出しとファイルの読み出しを **同じ effect に置く**。
  //   ★ 分けると、ファイル側の「キャッシュをクリア」が記録を先に消して競合する。
  // ★★ 記録は **読んだら消す**。★★★ こうすると再訪 (履歴 / 再読み込み) では記録が無く、
  //   「再訪」と「生きている失敗」が自動で分かれる (★ 時計の判断が要らない)。
  useEffect(() => {
    (async () => {
      try {
        const cache = await caches.open('share-target');

        const diagRes = await cache.match('/share-diag');
        if (diagRes) {
          const d = await diagRes.json();
          setRecord({
            fields: Array.isArray(d.fields) ? d.fields : [],
            mediaCount: Number(d.mediaCount) || 0,
            zeroSized: Number(d.zeroSized) || 0,
            sizes: Array.isArray(d.sizes) ? d.sizes : [],
            t: Number(d.t) || 0,
          });
          // ★ SW 側で拾えた例外も捨てない (★★ 画面にしか出せる場所が無い)
          if (d.parseError) setDiagDetail(`SW の読み取りで例外: ${d.parseError}`);
        }

        const files: File[] = [];
        for (let i = 0; i < fileCount; i++) {
          const response = await cache.match(`/share-file-${i}`);
          if (response) {
            const blob = await response.blob();
            files.push(new File([blob], `shared-${i}.${blob.type.split('/')[1] || 'bin'}`, { type: blob.type }));
          }
        }
        setSharedFiles(files);

        // ★ 読み終えてからまとめて消す (★★ 記録も含めて一度きりにする)
        const keys = await cache.keys();
        await Promise.all(keys.map((k) => cache.delete(k)));
      } catch (err) {
        console.error('[share] Failed to load files from cache:', err);
      }
    })();
  }, [fileCount]);

  // ★ 制御中の SW に版を尋ねる (★★ 返事が無い = 旧版が制御している)
  useEffect(() => {
    let alive = true;
    askServiceWorkerVersion().then((v) => {
      if (alive) setSwReplied(v !== null);
    });
    return () => { alive = false; };
  }, []);

  const getRoomDisplayName = (room: Room): string => {
    if (room.type === 'group') return room.name!;
    return room.partner_display_name || 'トーク';
  };

  const filteredRooms = rooms.filter((room) => {
    if (!search) return true;
    const name = getRoomDisplayName(room).toLowerCase();
    return name.includes(search.toLowerCase());
  });

  const handleSend = async (roomId: string) => {
    if (sending) return;

    // ★★★★ #445: 送るものが 0 件なら **遷移しない**。
    //   ★ 旧実装は何も送らずにルームを開いていたので、★★ 利用者には成功に見えていた
    //   (★★★ 2026-09-17: 「朝礼ルームは開くが動画が入らない」の正体がこれ)。
    //   ★ 原因が端末側でも、**黙って失敗しない**ようにするのは独立に効く。
    const plan = planShare(sharedContent, sharedFiles);
    if (plan.nothing) {
      // ★★★★ 2026-09-18 (#445): 文面を **推測から観測に**変える。
      //   ★ 旧実装は fileCount > 0 なら一律「端末の空き容量を確認して」と言っていたが、
      //     **成功した共有を再読み込みしただけでも同じ文面が出ていた** (★★ 誤診)。
      //   ★★★ 空き容量を疑ってよいのは「SW が動いて 0 バイトで届いた」ときだけ。
      const d = diagnoseShare({
        record,
        controlled: Boolean(navigator.serviceWorker?.controller),
        swReplied,
        hasShareParams: searchParams.has('files') || searchParams.has('via') || searchParams.has('text'),
      });
      setError(d.message);
      setDiagDetail((prev) => [prev, `[${d.code}] ${d.detail}`].filter(Boolean).join(' / '));
      console.warn('[share]', d.code, d.detail);
      return;
    }

    setSending(true);
    try {
      // テキスト/URL があれば送信（socket 優先でリンクプレビュー/webhook を有効化、切断時 REST fallback）
      if (plan.willSendText) {
        await sendRoomMessage({ roomId, content: sharedContent.trim() });
      }
      // ファイルがあればアップロード
      if (plan.willUpload) {
        await api.uploadMedia(roomId, sharedFiles);
      }
      // 該当ルームに遷移
      navigate(`/rooms/${roomId}`, { replace: true });
    } catch (err) {
      console.error('[share] Send failed:', err);
      alert('送信に失敗しました: ' + (err instanceof Error ? err.message : String(err)));
      setSending(false);
    }
  };

  return (
    <div className="share-container">
      <header className="share-header">
        <button className="share-back" onClick={() => navigate('/talk')}>
          <ArrowLeft size={22} />
        </button>
        <h1>共有先を選択</h1>
      </header>

      {/* ★ #445: 送れなかった理由。★★ 黙ってルームを開かない */}
      {error && (
        <div className="share-error" role="alert">
          {error}
          {/* ★ #445: 点呼を小さく併記する。★★ 端末に触れないまま原因を追うので、
              利用者がそのまま読み上げ / スクショできる形にしておく */}
          {diagDetail && <div className="share-error-detail">{diagDetail}</div>}
        </div>
      )}

      {/* 共有内容プレビュー */}
      <div className="share-preview">
        {sharedContent && (
          <div className="share-preview-text">
            {sharedContent.length > 100 ? sharedContent.slice(0, 100) + '...' : sharedContent}
          </div>
        )}
        {sharedFiles.length > 0 && (
          <div className="share-preview-files">
            {sharedFiles.map((f, i) => (
              <span key={i} className="share-preview-file">
                {f.type.startsWith('image/') ? '🖼️' : '📎'} {f.name}
              </span>
            ))}
          </div>
        )}
        {!sharedContent && sharedFiles.length === 0 && (
          <div className="share-preview-empty">共有データがありません</div>
        )}
      </div>

      {/* 検索 */}
      <div className="share-search">
        <input
          type="text"
          placeholder="ルームを検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ルーム一覧 */}
      <div className="share-room-list">
        {filteredRooms.map((room) => (
          <button
            key={room.id}
            className="share-room-item"
            onClick={() => handleSend(room.id)}
            disabled={sending}
          >
            <div className="share-room-avatar">
              {room.type === 'group' ? '🏠' : '👤'}
            </div>
            <div className="share-room-name">{getRoomDisplayName(room)}</div>
            <Send size={16} className="share-room-send" />
          </button>
        ))}
      </div>

      {sending && <div className="share-sending">送信中...</div>}
    </div>
  );
}

export default SharePage;
