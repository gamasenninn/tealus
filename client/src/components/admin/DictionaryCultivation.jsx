import { useState, useEffect } from 'react';
import { api } from '../../services/api';

// #327 辞書育成 — 自己成長辞書のトリアージ。
// 辞書は文字起こしの修正から自動で育つので、人間の仕事は著述でなく「承認/却下/読み修正」。

const SCOPES = [
  { key: 'auto', label: '自動学習' },
  { key: 'all', label: '全件' },
  { key: 'rejected', label: '却下済' },
];
const STATUS_LABEL = { pending: '確認待ち', active: '有効', rejected: '却下' };
const STATUS_COLOR = { pending: '#b06000', active: '#188038', rejected: '#c5221f' };
const SOURCE_LABEL = { auto: '自己成長', manual: '手動', organon: 'organon' };

function DictionaryCultivation() {
  const [aliases, setAliases] = useState([]);
  const [scope, setScope] = useState('auto');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { termId, value }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [scope]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api.getDictionaryAliases(scope, search);
      setAliases(data.aliases || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  const approve = async (id) => {
    try { await api.approveDictionaryAlias(id); await load(); } catch (err) { setError(err.message); }
  };
  const reject = async (id) => {
    try { await api.rejectDictionaryAlias(id); await load(); } catch (err) { setError(err.message); }
  };
  const saveReading = async () => {
    if (!editing || !editing.value.trim()) return;
    try {
      await api.setDictionaryReading(editing.termId, editing.value.trim());
      setEditing(null); await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <div className="admin-section-header">
        <h2>辞書育成</h2>
        <button className="admin-create-btn" onClick={load}>更新</button>
      </div>
      <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>
        文字起こしの修正から自動で育つ辞書です。自動学習された変換を承認（有効化）・却下・読み修正できます。
        「確認待ち」は累積中でまだ補正に使われていません。承認すると次回の文字起こしから効きます。
      </p>

      <div className="admin-tabs" style={{ marginBottom: 12, display: 'flex', alignItems: 'center' }}>
        {SCOPES.map((s) => (
          <button
            key={s.key}
            className={`admin-tab ${scope === s.key ? 'active' : ''}`}
            onClick={() => setScope(s.key)}
          >
            {s.label}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ marginLeft: 'auto' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="語で検索"
            style={{ padding: '6px 10px', fontSize: '14px' }}
          />
        </form>
      </div>

      {error && <div className="admin-error">{error}</div>}

      {loading ? (
        <div className="admin-loading">読み込み中...</div>
      ) : aliases.length === 0 ? (
        <p style={{ color: '#888' }}>該当する語はありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>正しい語</th>
              <th>崩れ（別名）</th>
              <th>由来</th>
              <th>状態</th>
              <th>回数</th>
              <th>読み</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.alias_id}>
                <td>{a.term}</td>
                <td>{a.alias}</td>
                <td>{SOURCE_LABEL[a.source] || a.source}</td>
                <td><span style={{ color: STATUS_COLOR[a.status], fontWeight: 600 }}>{STATUS_LABEL[a.status] || a.status}</span></td>
                <td>{a.count}</td>
                <td>
                  {editing && editing.termId === a.term_id ? (
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        style={{ width: 100, padding: '4px 6px' }}
                        autoFocus
                      />
                      <button className="admin-create-btn" onClick={saveReading}>保存</button>
                      <button className="kebab-btn" onClick={() => setEditing(null)}>×</button>
                    </span>
                  ) : (
                    <span>
                      {a.reading || '—'}
                      <button
                        className="kebab-btn"
                        style={{ marginLeft: 4 }}
                        title="読みを修正"
                        onClick={() => setEditing({ termId: a.term_id, value: a.reading || '' })}
                      >
                        ✎
                      </button>
                    </span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.status !== 'active' && (
                    <button className="admin-create-btn" onClick={() => approve(a.alias_id)}>承認</button>
                  )}
                  {a.status !== 'rejected' && (
                    <button className="kebab-btn" style={{ marginLeft: 6 }} onClick={() => reject(a.alias_id)}>却下</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default DictionaryCultivation;
