import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import './SearchPage.css';

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const roomId = searchParams.get('room_id');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  const handleSearch = (q) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.search(q.trim(), roomId);
        setResults(data.results);
      } catch (err) {
        console.error('Search error:', err);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const highlightText = (text, keyword) => {
    if (!text || !keyword) return text;
    const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i}>{part}</mark> : part
    );
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  const handleResultClick = (result) => {
    navigate(`/rooms/${result.room_id}?msg=${result.id}`);
  };

  return (
    <div className="search-container">
      <header className="search-header">
        <button className="search-back" onClick={() => navigate(-1)}>←</button>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder={roomId ? 'ルーム内検索...' : '全ルーム検索...'}
          autoFocus
        />
      </header>

      <div className="search-results">
        {searching && <div className="search-loading">検索中...</div>}

        {!searching && query.trim() && results.length === 0 && (
          <div className="search-empty">「{query}」に一致するメッセージはありません</div>
        )}

        {results.map(r => (
          <div key={r.id} className="search-result-item" onClick={() => handleResultClick(r)}>
            <div className="search-result-header">
              <span className="search-result-room">{r.room_name || 'トーク'}</span>
              <span className="search-result-date">{formatDate(r.created_at)}</span>
            </div>
            <div className="search-result-sender">{r.sender_display_name}</div>
            <div className="search-result-content">
              {r.type === 'voice' && '🎤 '}
              {highlightText(r.content, query)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SearchPage;
