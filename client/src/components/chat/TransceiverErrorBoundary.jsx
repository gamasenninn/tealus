import { Component } from 'react';

class TransceiverErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[TransceiverErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      // トランシーバー部分だけエラー表示。チャット本体は動き続ける
      return null;
    }
    return this.props.children;
  }
}

export default TransceiverErrorBoundary;
