import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { ArrowLeft, CheckSquare, Square, X } from 'lucide-react';
import './SearchPage.css';

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomId = searchParams.get('room_id');
  const initialQuery = searchParams.get('q') || '';

  const cached = sessionStorage.getItem('searchCache');
  const cachedData = cached ? JSON.parse(cached) : null;

  const [query, setQuery] = useState(initialQuery || cachedData?.query || '');
  const [results, setResults] = useState(cachedData?.results || []);
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef(null);

  // タグフィルタ
  const [allTags, setAllTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState(cachedData?.selectedTags || []);
  const [filterDone, setFilterDone] = useState(localStorage.getItem('todoFilterDone') || '');
  const [sortBy, setSortBy] = useState(localStorage.getItem('todoSortBy') || 'created_at');
  const [showAllTags, setShowAllTags] = useState(false);

  const hasTodoSelected = selectedTags.some(name => allTags.find(t => t.name === name && t.is_todo));

  // タグ一覧を取得
  useEffect(() => {
    if (roomId) {
      // ルーム内: そのルームのタグを取得
      Promise.all([
        api.getTodoTags(roomId),
        api.getRoomTags(roomId),
      ]).then(([todoData, allData]) => {
        const todoTags = (todoData.tags || []).map(t => ({ ...t, is_todo: true }));
        const generalTags = (allData.tags || []).filter(t => !t.is_todo);
        setAllTags([...todoTags, ...generalTags]);
      }).catch(() => {});
    } else {
      // 全ルーム: 集約 API
      api.getAllTags().then(data => {
        setAllTags(data.tags || []);
      }).catch(() => {});
    }
  }, [roomId]);

  // 復元: キャッシュから選択タグがある場合は自動検索
  useEffect(() => {
    if (cachedData?.selectedTags?.length > 0) {
      doTagSearch(cachedData.selectedTags, filterDone, sortBy);
    }
  }, []);

  const saveCache = (q, res, tags) => {
    sessionStorage.setItem('searchCache', JSON.stringify({
      query: q, results: res, selectedTags: tags,
    }));
  };

  const doSearch = async (q, offset = 0) => {
    setSearching(true);
    try {
      const data = await api.search(q.trim(), { roomId, offset });
      if (offset === 0) {
        setResults(data.results);
        saveCache(q.trim(), data.results, []);
      } else {
        setResults(prev => [...prev, ...data.results]);
      }
      setHasMore(data.results.length >= 50);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const doTagSearch = async (tags, isDone, sort, offset = 0) => {
    setSearching(true);
    try {
      const opts = { roomId, isDone, sort, offset };
      if (roomId && tags.length === 1) {
        // ルーム内 + 単一タグ: tag_id ベース（高速）
        const tagObj = allTags.find(t => t.name === tags[0]);
        if (tagObj) opts.tagId = tagObj.id;
      } else {
        // 複数タグ or 全ルーム: tag_names ベース（AND 検索）
        opts.tagNames = tags;
      }
      const data = await api.search(query.trim() || null, opts);
      if (offset === 0) {
        setResults(data.results);
        saveCache(query.trim(), data.results, tags);
      } else {
        setResults(prev => [...prev, ...data.results]);
      }
      setHasMore(data.results.length >= 50);
    } catch (err) {
      console.error('Tag search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      if (selectedTags.length > 0) {
        await doTagSearch(selectedTags, filterDone, sortBy, results.length);
      } else if (query.trim()) {
        await doSearch(query, results.length);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const handleSearch = (q) => {
    setQuery(q);
    const params = new URLSearchParams(searchParams);
    if (q.trim()) params.set('q', q.trim());
    else params.delete('q');
    setSearchParams(params, { replace: true });

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (selectedTags.length > 0) {
      debounceRef.current = setTimeout(() => doTagSearch(selectedTags, filterDone, sortBy), 300);
      return;
    }
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const toggleTag = (tagName) => {
    const newTags = selectedTags.includes(tagName)
      ? selectedTags.filter(n => n !== tagName)
      : [...selectedTags, tagName];
    setSelectedTags(newTags);
    if (newTags.length > 0) {
      doTagSearch(newTags, filterDone, sortBy);
    } else {
      setResults([]);
      saveCache(query, [], []);
    }
  };

  const clearTags = () => {
    setSelectedTags([]);
    setResults([]);
    saveCache(query, [], []);
  };

  const handleDoneFilter = (value) => {
    setFilterDone(value);
    localStorage.setItem('todoFilterDone', value);
    if (selectedTags.length > 0) doTagSearch(selectedTags, value, sortBy);
  };

  const handleSort = (value) => {
    setSortBy(value);
    localStorage.setItem('todoSortBy', value);
    if (selectedTags.length > 0) doTagSearch(selectedTags, filterDone, value);
  };

  const toggleDone = async (result) => {
    const tagId = result.tag_id || (allTags.find(t => t.name === selectedTags[0])?.id);
    if (!tagId) return;
    const newDone = !result.is_done;
    try {
      await api.updateMessageTag(result.id, tagId, { is_done: newDone });
      setResults(prev => prev.map(r => r.id === result.id ? { ...r, is_done: newDone } : r));
    } catch (err) {
      console.error('Toggle done error:', err);
    }
  };

  const cyclePriority = async (result) => {
    const tagId = result.tag_id || (allTags.find(t => t.name === selectedTags[0])?.id);
    if (!tagId) return;
    const newPriority = ((result.priority || 0) + 1) % 4;
    try {
      await api.updateMessageTag(result.id, tagId, { priority: newPriority });
      setResults(prev => prev.map(r => r.id === result.id ? { ...r, priority: newPriority } : r));
    } catch (err) {
      console.error('Cycle priority error:', err);
    }
  };

  const renderPriority = (priority) => {
    const stars = '★'.repeat(priority || 0) + '☆'.repeat(3 - (priority || 0));
    return <span className="todo-priority">{stars}</span>;
  };

  const highlightText = (text, keyword) => {
    if (!text || !keyword) return text;
    const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) => regex.test(part) ? <mark key={i}>{part}</mark> : part);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  };

  const scrollRef = useRef(null);

  useEffect(() => {
    if (cachedData && scrollRef.current) {
      const savedScroll = sessionStorage.getItem('searchScroll');
      if (savedScroll) scrollRef.current.scrollTop = parseInt(savedScroll);
    }
  }, [results.length]);

  const handleResultClick = (result) => {
    if (scrollRef.current) sessionStorage.setItem('searchScroll', scrollRef.current.scrollTop);
    navigate(`/rooms/${result.room_id}?msg=${result.id}&q=${encodeURIComponent(query)}`);
  };

  // タグの分類
  const todoTags = allTags.filter(t => t.is_todo);
  const generalTags = allTags.filter(t => !t.is_todo);
  const visibleTodoTags = showAllTags ? todoTags : todoTags.slice(0, 10);
  const visibleGeneralTags = showAllTags ? generalTags : generalTags.slice(0, 10);
  const hasMoreTags = (todoTags.length > 10 || generalTags.length > 10) && !showAllTags;

  return (
    <div className="search-container">
      <header className="search-header">
        <button className="search-back" onClick={() => { sessionStorage.removeItem('searchCache'); sessionStorage.removeItem('searchScroll'); navigate(-1); }}><ArrowLeft size={22} /></button>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder={roomId ? 'ルーム内検索...' : '全ルーム検索...'}
          autoFocus={!cachedData}
        />
      </header>

      {/* タグフィルタ */}
      {allTags.length > 0 && (
        <div className="tag-filter-area">
          {selectedTags.length > 0 && (
            <div className="tag-filter-selected">
              {selectedTags.map(name => (
                <span key={name} className="tag-chip selected" onClick={() => toggleTag(name)}>{name}</span>
              ))}
              <button className="tag-clear-btn" onClick={clearTags}><X size={14} /></button>
            </div>
          )}

          {todoTags.length > 0 && (
            <div className="tag-filter-section">
              <div className="tag-filter-label">📋 TODO</div>
              <div className="tag-filter-chips">
                {visibleTodoTags.map(tag => (
                  <span
                    key={tag.name}
                    className={`tag-chip ${selectedTags.includes(tag.name) ? 'selected' : ''}`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name} {tag.total_usage > 0 ? `(${tag.total_usage})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {generalTags.length > 0 && (
            <div className="tag-filter-section">
              <div className="tag-filter-label"># タグ</div>
              <div className="tag-filter-chips">
                {visibleGeneralTags.map(tag => (
                  <span
                    key={tag.name}
                    className={`tag-chip ${selectedTags.includes(tag.name) ? 'selected' : ''}`}
                    onClick={() => toggleTag(tag.name)}
                  >
                    {tag.name} {tag.total_usage > 0 ? `(${tag.total_usage})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {hasMoreTags && (
            <button className="tag-show-more" onClick={() => setShowAllTags(true)}>もっと見る...</button>
          )}

          {/* TODO 選択時の追加フィルタ */}
          {hasTodoSelected && (
            <div className="todo-sub-filters">
              <select value={filterDone} onChange={e => handleDoneFilter(e.target.value)} className="todo-filter-select">
                <option value="">すべて</option>
                <option value="false">未完了</option>
                <option value="true">完了</option>
              </select>
              <select value={sortBy} onChange={e => handleSort(e.target.value)} className="todo-filter-select">
                <option value="created_at">新しい順</option>
                <option value="priority">重要度順</option>
              </select>
            </div>
          )}
        </div>
      )}

      <div className="search-results" ref={scrollRef} onScroll={(e) => {
        const el = e.target;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) loadMore();
      }}>
        {searching && <div className="search-loading">検索中...</div>}

        {!searching && (query.trim() || selectedTags.length > 0) && results.length === 0 && (
          <div className="search-empty">
            {selectedTags.length > 0 ? '該当するメッセージはありません' : `「${query}」に一致するメッセージはありません`}
          </div>
        )}

        {results.map(r => (
          <div key={r.id} className={`search-result-item ${r.is_done ? 'done' : ''}`}>
            {hasTodoSelected && (
              <div className="todo-controls">
                <button className="todo-checkbox" onClick={() => toggleDone(r)}>
                  {r.is_done ? <CheckSquare size={20} /> : <Square size={20} />}
                </button>
                <button className="todo-priority-btn" onClick={() => cyclePriority(r)}>
                  {renderPriority(r.priority)}
                </button>
              </div>
            )}
            <div className="search-result-body" onClick={() => handleResultClick(r)}>
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
          </div>
        ))}
        {loadingMore && <div className="search-loading">読み込み中...</div>}
      </div>
    </div>
  );
}

export default SearchPage;
