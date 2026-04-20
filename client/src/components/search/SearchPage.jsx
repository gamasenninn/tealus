import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';
import { ArrowLeft, CheckSquare, Square, Star } from 'lucide-react';
import './SearchPage.css';

function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomId = searchParams.get('room_id');
  const initialQuery = searchParams.get('q') || '';
  const initialTagId = searchParams.get('tag_id') || '';

  const cached = sessionStorage.getItem('searchCache');
  const cachedData = cached ? JSON.parse(cached) : null;

  const [query, setQuery] = useState(initialQuery || cachedData?.query || '');
  const [results, setResults] = useState(cachedData?.results || []);
  const cachedTodo = cachedData?.todoTagId || '';
  const [searching, setSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const debounceRef = useRef(null);

  // TODO フィルタ
  const [todoTagId, setTodoTagId] = useState(initialTagId || cachedTodo);
  const [todoTags, setTodoTags] = useState([]);
  const [filterDone, setFilterDone] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const isTodoMode = !!todoTagId;

  // TODO タグ一覧を取得（現在のルーム or 全ルーム）
  useEffect(() => {
    if (roomId) {
      // ルーム指定あり → そのルームの TODO タグ
      api.getTodoTags(roomId).then(d => {
        setTodoTags(d.tags || []);
        const restoreTagId = initialTagId || cachedTodo;
        if (restoreTagId) doTodoSearch(restoreTagId, filterDone, sortBy);
      }).catch(() => {});
    } else {
      // ルーム指定なし → 全ルームの TODO タグを集約
      api.getRooms().then(data => {
        const allTags = new Map();
        Promise.all(
          (data.rooms || []).map(room =>
            api.getTodoTags(room.id).then(d => {
              (d.tags || []).forEach(tag => {
                if (!allTags.has(tag.name)) allTags.set(tag.name, tag);
              });
            }).catch(() => {})
          )
        ).then(() => {
          setTodoTags(Array.from(allTags.values()));
        });
      }).catch(() => {});
    }
  }, [roomId]);

  const doSearch = async (q, offset = 0) => {
    setSearching(true);
    try {
      const data = await api.search(q.trim(), { roomId, offset });
      if (offset === 0) {
        setResults(data.results);
      } else {
        setResults(prev => [...prev, ...data.results]);
      }
      setHasMore(data.results.length >= 50);
      if (offset === 0) {
        sessionStorage.setItem('searchCache', JSON.stringify({ query: q.trim(), results: data.results }));
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const doTodoSearch = async (tagId, isDone, sort, offset = 0) => {
    setSearching(true);
    try {
      const data = await api.search(query.trim() || null, { roomId, tagId, isDone, sort, offset });
      if (offset === 0) {
        setResults(data.results);
        sessionStorage.setItem('searchCache', JSON.stringify({ query: query.trim(), results: data.results, todoTagId: tagId }));
      } else {
        setResults(prev => [...prev, ...data.results]);
      }
      setHasMore(data.results.length >= 50);
    } catch (err) {
      console.error('TODO search error:', err);
    } finally {
      setSearching(false);
    }
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      if (isTodoMode) {
        await doTodoSearch(todoTagId, filterDone, sortBy, results.length);
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

    if (isTodoMode) {
      debounceRef.current = setTimeout(() => doTodoSearch(todoTagId, filterDone, sortBy), 300);
      return;
    }

    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const handleTodoFilter = (tagId) => {
    setTodoTagId(tagId);
    if (tagId) {
      doTodoSearch(tagId, filterDone, sortBy);
    } else {
      setResults([]);
    }
  };

  const handleDoneFilter = (value) => {
    setFilterDone(value);
    if (todoTagId) doTodoSearch(todoTagId, value, sortBy);
  };

  const handleSort = (value) => {
    setSortBy(value);
    if (todoTagId) doTodoSearch(todoTagId, filterDone, value);
  };

  const toggleDone = async (result) => {
    // result にタグ ID が含まれている場合はそれを使う、なければフィルタの tag_id
    const tagId = result.tag_id || todoTagId;
    const newDone = !result.is_done;
    try {
      await api.updateMessageTag(result.id, tagId, { is_done: newDone });
      setResults(prev => prev.map(r =>
        r.id === result.id ? { ...r, is_done: newDone } : r
      ));
    } catch (err) {
      console.error('Toggle done error:', err);
    }
  };

  const cyclePriority = async (result) => {
    const tagId = todoTagId;
    const newPriority = ((result.priority || 0) + 1) % 4;
    try {
      await api.updateMessageTag(result.id, tagId, { priority: newPriority });
      setResults(prev => prev.map(r =>
        r.id === result.id ? { ...r, priority: newPriority } : r
      ));
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

  useEffect(() => {
    if (cachedData && scrollRef.current) {
      const savedScroll = sessionStorage.getItem('searchScroll');
      if (savedScroll) scrollRef.current.scrollTop = parseInt(savedScroll);
    }
  }, [results.length]);

  const handleResultClick = (result) => {
    if (scrollRef.current) {
      sessionStorage.setItem('searchScroll', scrollRef.current.scrollTop);
    }
    navigate(`/rooms/${result.room_id}?msg=${result.id}&q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="search-container">
      <header className="search-header">
        <button className="search-back" onClick={() => { sessionStorage.removeItem('searchCache'); sessionStorage.removeItem('searchScroll'); navigate(-1); }}><ArrowLeft size={22} /></button>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder={isTodoMode ? 'TODO 内を検索...' : roomId ? 'ルーム内検索...' : '全ルーム検索...'}
          autoFocus={!cachedData && !initialTagId}
        />
      </header>

      {/* TODO フィルタバー */}
      {todoTags.length > 0 && (
        <div className="todo-filter-bar">
          <select
            value={todoTagId}
            onChange={e => handleTodoFilter(e.target.value)}
            className="todo-filter-select"
          >
            <option value="">キーワード検索</option>
            {todoTags.map(tag => (
              <option key={tag.id} value={tag.id}>📋 {tag.name}</option>
            ))}
          </select>
          {isTodoMode && (
            <>
              <select value={filterDone} onChange={e => handleDoneFilter(e.target.value)} className="todo-filter-select">
                <option value="">すべて</option>
                <option value="false">未完了</option>
                <option value="true">完了</option>
              </select>
              <select value={sortBy} onChange={e => handleSort(e.target.value)} className="todo-filter-select">
                <option value="created_at">新しい順</option>
                <option value="priority">重要度順</option>
              </select>
            </>
          )}
        </div>
      )}

      <div className="search-results" ref={scrollRef} onScroll={(e) => {
        const el = e.target;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) loadMore();
      }}>
        {searching && <div className="search-loading">検索中...</div>}

        {!searching && (query.trim() || isTodoMode) && results.length === 0 && (
          <div className="search-empty">
            {isTodoMode ? 'TODO はありません' : `「${query}」に一致するメッセージはありません`}
          </div>
        )}

        {results.map(r => (
          <div key={r.id} className={`search-result-item ${r.is_done ? 'done' : ''}`}>
            {isTodoMode && (
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
