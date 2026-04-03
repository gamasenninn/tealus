import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import './SearchPage.css';

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomId = searchParams.get('room_id');
  const initialQuery = searchParams.get('q') || '';

  // Restore from sessionStorage on mount
  const cached = sessionStorage.getItem('searchCache');
  const cachedData = cached ? JSON.parse(cached) : null;

  const [query, setQuery] = useState(initialQuery || cachedData?.query || '');
  const [results, setResults] = useState(cachedData?.results || []);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  const doSearch = async (q) => {
    setSearching(true);
    try {
      const data = await api.search(q.trim(), roomId);
      setResults(data.results);
      sessionStorage.setItem('searchCache', JSON.stringify({ query: q.trim(), results: data.results }));
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const handleSearch = (q) => {
    setQuery(q);
    // Update URL with query for back navigation
    const params = new URLSearchParams(searchParams);
    if (q.trim()) {
      params.set('q', q.trim());
    } else {
      params.delete('q');
    }
    setSearchParams(params, { replace: true });

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(q), 300);
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

  const scrollRef = useRef(null);

  // Restore scroll position on mount
  useEffect(() => {
    if (cachedData && scrollRef.current) {
      const savedScroll = sessionStorage.getItem('searchScroll');
      if (savedScroll) {
        scrollRef.current.scrollTop = parseInt(savedScroll);
      }
    }
  }, [results.length]);

  const handleResultClick = (result) => {
    // Save scroll position before navigating
    if (scrollRef.current) {
      sessionStorage.setItem('searchScroll', scrollRef.current.scrollTop);
    }
    navigate(`/rooms/${result.room_id}?msg=${result.id}`);
  };

  return (
    <div className="search-container">
      <header className="search-header">
        <button className="search-back" onClick={() => { sessionStorage.removeItem('searchCache'); sessionStorage.removeItem('searchScroll'); navigate(-1); }}>←</button>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder={roomId ? 'ルーム内検索...' : '全ルーム検索...'}
          autoFocus
        />
      </header>

      <div className="search-results" ref={scrollRef}>
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
