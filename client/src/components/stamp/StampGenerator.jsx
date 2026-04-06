import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import './StampGenerator.css';

const DEFAULT_LABELS = [
  '了解です', 'おはよう', 'OK!', 'おやすみ',
  'ごめんね', 'ありがとう', 'いいね！', '了解！',
  'うるうる', 'がんばります', 'ちらっ', 'ありがとうございました',
  'おつかれさま', 'ねむい', 'えっ!?', 'カンパーイ！',
];

function StampGenerator({ onClose }) {
  const { roomId } = useParams();
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [labels, setLabels] = useState([...DEFAULT_LABELS]);
  const [showLabels, setShowLabels] = useState(false);
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

  const updateLabel = (index, value) => {
    const newLabels = [...labels];
    newLabels[index] = value;
    setLabels(newLabels);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    const activeLabels = labels.filter(l => l.trim());
    if (activeLabels.length < 2) {
      setError('ラベルは最低2つ必要です');
      return;
    }

    setGenerating(true);
    setError('');
    try {
      await api.generateStampPack(prompt.trim(), name.trim() || undefined, roomId, activeLabels);
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

        <div className="stamp-labels-toggle" onClick={() => setShowLabels(!showLabels)}>
          {showLabels ? '▼' : '▶'} ラベルをカスタマイズ（{labels.filter(l => l.trim()).length}枚）
        </div>

        {showLabels && (
          <div className="stamp-labels-grid">
            {labels.map((label, i) => (
              <input
                key={i}
                type="text"
                value={label}
                onChange={e => updateLabel(i, e.target.value)}
                placeholder={`(空欄でスキップ)`}
                disabled={generating}
                className="stamp-label-input"
              />
            ))}
          </div>
        )}

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
