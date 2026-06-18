import { Component } from 'react';

/**
 * メッセージ単位の error boundary (#306)
 *
 * MessageBubble / VoiceBubble / Markdown 等の描画で例外が throw されると、
 * error boundary が無い場合は React tree 全体がクラッシュしチャットが白紙化する。
 * 各メッセージをこれで包むことで、1 件の描画失敗を当該メッセージの fallback に
 * 留め、リストの残りは表示し続ける。
 */
class MessageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[MessageErrorBoundary]', this.props.messageId, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="message-render-error"
          style={{ padding: '8px 12px', color: 'var(--text-secondary, #888)', fontSize: '13px' }}
        >
          ⚠ このメッセージを表示できませんでした
        </div>
      );
    }
    return this.props.children;
  }
}

export default MessageErrorBoundary;
