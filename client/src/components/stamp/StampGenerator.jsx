import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import './StampGenerator.css';

function StampGenerator({ onClose }) {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleGenerated = (data) => {
      setGenerating(false);
      setResult(data);
    };

    const handleError = (data) => {
      setGenerating(false);
      setError(data.error || 'スタンプ生成に失敗しました');
    };

    socket.on('stamp:generated', handleGenerated);
    socket.on('stamp:error', handleError);

    return () => {
      socket.off('stamp:generated', handleGenerated);
      socket.off('stamp:error', handleError);
    };
  }, []);

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;

    setGenerating(true);
    setError('');
    try {
      await api.generateStampPack(prompt.trim(), name.trim() || undefined);
      // Response is 202 — wait for Socket.IO event
    } catch (err) {
      setGenerating(false);
      setError(err.message);
    }
  };

  if (result) {
    return (
      <div className="stamp-generator">
        <div className="stamp-generator-header">
          <span>スタンプ作成完了</span>
          <button className="stamp-picker-close" onClick={onClose}>✕</button>
        </div>
        <div className="stamp-generator-result">
          <p className="stamp-generator-success">
            {result.pack.name} — {result.count}枚のスタンプが作成されました！
          </p>
          <div className="stamp-generator-preview">
            {result.stamps.map((s, i) => (
              <img key={i} src={`/media/${s.filePath}`} alt={s.label} />
            ))}
          </div>
          <button className="stamp-generator-done" onClick={onClose}>
            使ってみる
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stamp-generator">
      <div className="stamp-generator-header">
        <button className="stamp-picker-close" onClick={onClose}>←</button>
        <span>AIでスタンプを作成</span>
      </div>
      <div className="stamp-generator-form">
        <label>どんなスタンプを作りたいですか？</label>
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="例：柴犬が仕事してるスタンプ"
          rows={3}
          disabled={generating}
        />
        <label>パック名（省略可）</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="例：はたらく柴犬"
          disabled={generating}
        />
        {error && <div className="stamp-generator-error">{error}</div>}
        {generating && (
          <div className="stamp-generator-progress">
            <div className="stamp-generator-spinner" />
            <span>AIがスタンプを生成中...</span>
          </div>
        )}
        <button
          className="stamp-generator-btn"
          onClick={handleGenerate}
          disabled={!prompt.trim() || generating}
        >
          {generating ? '生成中...' : 'スタンプを生成'}
        </button>
      </div>
    </div>
  );
}

export default StampGenerator;
