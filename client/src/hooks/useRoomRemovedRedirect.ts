import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { notify } from '../stores/confirmStore';

/**
 * #533 開いている部屋から外れたら (自分で退会・外された)、知らせを出してトークの一覧へ戻る。
 *
 * ★ 以前は外された本人の画面に部屋が開いたまま残り、送ろうとして初めて失敗した。
 *   本体が本人へ room:removed を送り、services/socket.ts が window の 'tealus:room-removed' に変えて流す
 * ★ マルチトークのパネル (embed) の中では移らない (パネルの中にトーク一覧が出てしまう)。知らせだけ
 */
export function useRoomRemovedRedirect(roomId: string, isEmbed: boolean): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onRemoved = (e: Event) => {
      if ((e as CustomEvent<{ room_id?: string }>).detail?.room_id !== roomId) return;
      void notify('この部屋のメンバーではなくなりました');
      if (!isEmbed) navigate('/talk', { replace: true });
    };
    window.addEventListener('tealus:room-removed', onRemoved);
    return () => window.removeEventListener('tealus:room-removed', onRemoved);
  }, [roomId, isEmbed, navigate]);
}
