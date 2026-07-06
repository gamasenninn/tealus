import { useState, useEffect } from 'react';
import { api } from '../../services/api';

// #327 辞書育成 — 自己成長辞書。2つの面をサブタブで（同一文脈維持=別メンテ画面にしない）:
//   崩れ(別名): alias のトリアージ(承認/却下/手動追加)。フラット・検索・状態/回数。
//   語(term)  : term の編集(読み/description/category)。読みは term に1つ=ここで直す。

const SCOPES = [
  { key: 'auto', label: '自動学習' },
  { key: 'all', label: '全件' },
  { key: 'rejected', label: '却下済' },
];
const STATUS_LABEL = { pending: '確認待ち', active: '有効', rejected: '却下' };
const STATUS_COLOR = { pending: '#b06000', active: '#188038', rejected: '#c5221f' };
const SOURCE_LABEL = { auto: '自己成長', manual: '手動', organon: 'organon' };

function DictionaryCultivation() {
  const [view, setView] = useState('aliases');
  return (
    <div>
      <div className="admin-section-header">
        <h2>辞書育成</h2>
      </div>
      <div className="admin-tabs" style={{ marginBottom: 12 }}>
        <button className={`admin-tab ${view === 'aliases' ? 'active' : ''}`} onClick={() => setView('aliases')}>崩れ（別名）</button>
        <button className={`admin-tab ${view === 'terms' ? 'active' : ''}`} onClick={() => setView('terms')}>語（term）</button>
      </div>
      {view === 'aliases' ? <AliasView /> : <TermView />}
    </div>
  );
}

// --- 崩れ（別名）ビュー: alias トリアージ ---
function AliasView() {
  const [aliases, setAliases] = useState([]);
  const [scope, setScope] = useState('auto');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addTerm, setAddTerm] = useState('');
  const [addAlias, setAddAlias] = useState('');

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
  const submitAdd = async (e) => {
    e.preventDefault();
    if (!addTerm.trim() || !addAlias.trim()) return;
    try {
      await api.addDictionaryAlias(addTerm.trim(), addAlias.trim());
      setAddTerm(''); setAddAlias(''); await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>
        文字起こしの修正から自動で育つ変換候補です。承認（有効化）・却下できます。「確認待ち」は累積中でまだ
        補正に使われていません。自動で拾えない語（難読名など）は下から手動追加。読みの修正は「語」タブで。
      </p>

      <form onSubmit={submitAdd} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '0 0 12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#555' }}>手動追加:</span>
        <input value={addTerm} onChange={(e) => setAddTerm(e.target.value)} placeholder="正しい語（例 五月女）" style={{ padding: '6px 10px', fontSize: 14 }} />
        <span style={{ color: '#888' }}>←</span>
        <input value={addAlias} onChange={(e) => setAddAlias(e.target.value)} placeholder="崩れ（例 ソフトメイ）" style={{ padding: '6px 10px', fontSize: 14 }} />
        <button type="submit" className="admin-create-btn" disabled={!addTerm.trim() || !addAlias.trim()}>追加</button>
      </form>

      <div className="admin-tabs" style={{ marginBottom: 12, display: 'flex', alignItems: 'center' }}>
        {SCOPES.map((s) => (
          <button key={s.key} className={`admin-tab ${scope === s.key ? 'active' : ''}`} onClick={() => setScope(s.key)}>{s.label}</button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ marginLeft: 'auto' }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="語・崩れで検索" style={{ padding: '6px 10px', fontSize: '14px' }} />
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
            <tr><th>正しい語</th><th>崩れ（別名）</th><th>由来</th><th>状態</th><th>回数</th><th>読み</th><th></th></tr>
          </thead>
          <tbody>
            {aliases.map((a) => (
              <tr key={a.alias_id}>
                <td>{a.term}</td>
                <td>{a.alias}</td>
                <td>{SOURCE_LABEL[a.source] || a.source}</td>
                <td><span style={{ color: STATUS_COLOR[a.status], fontWeight: 600 }}>{STATUS_LABEL[a.status] || a.status}</span></td>
                <td>{a.count}</td>
                <td style={{ color: '#888' }}>{a.reading || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {a.status !== 'active' && <button className="admin-create-btn" onClick={() => approve(a.alias_id)}>承認</button>}
                  {a.status !== 'rejected' && <button className="kebab-btn" style={{ marginLeft: 6 }} onClick={() => reject(a.alias_id)}>却下</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// --- 語（term）ビュー: term 編集（読み/description） ---
function TermView() {
  const [terms, setTerms] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // { id, reading, description }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api.getDictionaryTerms(search);
      setTerms(data.terms || []);
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };
  const save = async () => {
    if (!editing) return;
    try {
      await api.updateDictionaryTerm(editing.id, { reading: editing.reading.trim(), description: editing.description });
      setEditing(null); await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <div>
      <p style={{ color: '#888', fontSize: '13px', margin: '0 0 12px' }}>
        正しい語（term）の編集です。読みは音韻マッチ（自動学習）に使われます（pykakasi の自動読みが誤って
        いれば直してください）。description は人物・区別のメモ（補正には使いません）。
      </p>
      <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="語で検索" style={{ padding: '6px 10px', fontSize: 14 }} />
      </form>

      {error && <div className="admin-error">{error}</div>}
      {loading ? (
        <div className="admin-loading">読み込み中...</div>
      ) : terms.length === 0 ? (
        <p style={{ color: '#888' }}>該当する語はありません。</p>
      ) : (
        <table>
          <thead>
            <tr><th>語</th><th>分類</th><th>読み</th><th>メモ（description）</th><th>別名数</th><th></th></tr>
          </thead>
          <tbody>
            {terms.map((t) => {
              const ed = editing && editing.id === t.id;
              return (
                <tr key={t.id}>
                  <td>{t.term}</td>
                  <td style={{ color: '#888' }}>{t.category}</td>
                  <td>
                    {ed ? (
                      <input value={editing.reading} onChange={(e) => setEditing({ ...editing, reading: e.target.value })} style={{ width: 110, padding: '4px 6px' }} autoFocus />
                    ) : (t.reading || '—')}
                  </td>
                  <td>
                    {ed ? (
                      <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} style={{ width: 220, padding: '4px 6px' }} />
                    ) : (t.description || <span style={{ color: '#bbb' }}>—</span>)}
                  </td>
                  <td>{t.alias_count}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {ed ? (
                      <span style={{ display: 'inline-flex', gap: 4 }}>
                        <button className="admin-create-btn" onClick={save}>保存</button>
                        <button className="kebab-btn" onClick={() => setEditing(null)}>×</button>
                      </span>
                    ) : (
                      <button className="kebab-btn" onClick={() => setEditing({ id: t.id, reading: t.reading || '', description: t.description || '' })}>編集</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default DictionaryCultivation;
