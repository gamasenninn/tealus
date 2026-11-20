import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { CourierEntry, CourierBridgeBeat } from '../../services/api';

/** 配達役 (courier/) の状態の名前を日本語に (courier/src/tick.mts の BridgeState) */
const STATE_LABEL: Record<string, string> = {
  idle: '待っている',
  delivered: '届けた直後',
  busy: '作業中',
  blocked: '確認待ち',
  missing: '居ない',
  unknown: '分からない',
  held: '保留 (配っていない)',
  unreadable: '便がまだ無い',
  failed: '渡せなかった',
};
/** 目立たせる状態 (人の手が要るかもしれない) */
const ALERT_STATES = new Set(['blocked', 'missing', 'unknown', 'held', 'failed']);
/** 配達役は 1 分ごとに鼓動を送る。これより古ければ一覧は今の様子ではない */
const STALE_MS = 5 * 60_000;
const REFRESH_MS = 10_000;

/** 配達役の起動より前は覚えていないので、状態の始まりが起動と同じ (5 秒以内) なら「○時より前から」と出す (2026-11-20) */
const SAME_AS_START_MS = 5_000;

function ago(iso: string | undefined, now: number, startedAt?: string): string {
  if (!iso) return '—';
  if (startedAt && Math.abs(new Date(iso).getTime() - new Date(startedAt).getTime()) <= SAME_AS_START_MS) {
    return `${new Date(startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} より前から`;
  }
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return '1 分以内';
  if (m < 60) return `${m} 分前から`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} 時間前から` : `${Math.floor(h / 24)} 日前から`;
}

/**
 * 管理画面「AIの班」(2026-11-20 利用者判断「A でつくって」、docs/12 §7)。
 * ★ 配達役の鼓動 (1 分ごと) を班ごとに並べるだけ。画面の文字や本文は出さない (配達役が載せない作り)
 * ★ 10 秒ごとに読み直す (開いているあいだだけ)
 */
function CourierStatus() {
  const [items, setItems] = useState<CourierEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.getAdminCourier();
        if (alive) { setItems(r.couriers); setError(''); }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (loading) return <div className="admin-loading">読み込み中...</div>;
  const now = Date.now();

  return (
    <div>
      <div className="admin-section-header"><h2>AIの班</h2></div>
      <p>配達役が届けている班の様子です (開いているあいだ 10 秒ごとに読み直します)。確認待ちが 10 分続くと業務メモにも知らせます。</p>
      {error && <div className="admin-error">{error}</div>}
      {items.length === 0 ? <p>配達役の鼓動がまだありません (配達役が動いていないか、動き出したばかりです)</p> : items.map((c) => {
        const stale = now - new Date(c.last_seen).getTime() >= STALE_MS;
        const bridges: Array<[string, CourierBridgeBeat]> = Object.entries(c.info?.bridges ?? {});
        return (
          <div key={c.user_id} style={{ marginBottom: 24 }}>
            <p>
              {c.display_name} の最後の鼓動: {new Date(c.last_seen).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </p>
            {stale && <div className="admin-error">★ 鼓動が 5 分以上来ていません。配達役が止まっているかもしれません (下の一覧は止まる前の様子です)</div>}
            {c.info?.problem && <div className="admin-error">★ {c.info.problem}</div>}
            {bridges.length === 0 ? <p>届けている班がありません</p> : (
              <div className="admin-user-list"><table>
                <thead><tr><th>班</th><th>状態</th><th>新着</th><th>この状態はいつから</th></tr></thead>
                <tbody>
                  {bridges.map(([project, b]) => (
                    <tr key={project}>
                      <td>{project}</td>
                      <td style={ALERT_STATES.has(b.state) ? { color: 'var(--color-danger, #c0392b)', fontWeight: 'bold' } : undefined}>
                        {STATE_LABEL[b.state] ?? b.state}
                      </td>
                      <td>{b.pending}</td>
                      <td>{ago(b.since, now, c.info?.started_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default CourierStatus;
