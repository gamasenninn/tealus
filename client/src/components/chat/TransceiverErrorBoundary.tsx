import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { reportClientError } from '../../services/errorReport';

interface TransceiverErrorBoundaryProps {
  children?: ReactNode;
}

interface TransceiverErrorBoundaryState {
  hasError: boolean;
}

class TransceiverErrorBoundary extends Component<TransceiverErrorBoundaryProps, TransceiverErrorBoundaryState> {
  constructor(props: TransceiverErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[TransceiverErrorBoundary]', error, errorInfo);
    reportClientError('render', error, errorInfo.componentStack);   // #525 本体のログへ
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
