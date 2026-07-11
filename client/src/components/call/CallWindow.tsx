import { useEffect, useRef } from 'react';

interface CallWindowProps {
  callUrl: string;
  onEnd: () => void;
}

function CallWindow({ callUrl, onEnd }: CallWindowProps) {
  const winRef = useRef<Window | null>(null);

  useEffect(() => {
    // 別ウィンドウ/タブで通話画面を開く（トップレベルコンテキスト = スタンドアロンと同等の性能）
    const w = 800, h = 600;
    const left = (screen.width - w) / 2;
    const top = (screen.height - h) / 2;
    winRef.current = window.open(
      callUrl, 'tealus-call',
      `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no,resizable=yes`
    );

    // ウィンドウが閉じられたら通話終了
    const timer = setInterval(() => {
      if (winRef.current?.closed) {
        clearInterval(timer);
        onEnd();
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      if (winRef.current && !winRef.current.closed) {
        winRef.current.close();
      }
    };
  }, [callUrl, onEnd]);

  // 親ウィンドウには何も描画しない
  return null;
}

export default CallWindow;
