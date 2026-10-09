import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportClientError } from '../services/errorReport';

/**
 * #525 一番外の受け止め。
 *
 * ★ 以前は、メッセージ 1 件 (MessageErrorBoundary) とトランシーバーの表示の外で描画が失敗すると、
 *   画面全体が真っ白になり、何が起きたかもどこにも残らなかった。
 *   今は「読み込み直す」を出し、何が起きたかを本体のログへ送る。
 */
interface Props { children: ReactNode }
interface State { hasError: boolean }

class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info);
    reportClientError('render', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="app-error-fallback" role="alert">
        <p className="app-error-title">画面の表示で問題が起きました</p>
        <p className="app-error-note">読み込み直すと戻ります。何度も起きるときは管理者に知らせてください。</p>
        <button type="button" className="app-error-reload" onClick={() => window.location.reload()}>
          読み込み直す
        </button>
      </div>
    );
  }
}

export default AppErrorBoundary;
