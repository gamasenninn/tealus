import { useRef, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMessageStore } from '../stores/messageStore';
import { useRoomStore } from '../stores/roomStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { SCROLL_NEAR_BOTTOM, INITIAL_SCROLL_DELAY } from '../constants/ui';

export interface UseMessageScrollResult {
  messagesEndRef: RefObject<HTMLDivElement | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
}

/**
 * Manages scroll behavior, pagination, and auto-scroll.
 */
export function useMessageScroll(roomId: string): UseMessageScrollResult {
  const { user } = useAuthStore();
  const { messages, loadMore, hasMore } = useMessageStore();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const isInitialLoad = useRef(true);
  const isLoadingMore = useRef(false);
  // ★ #506 最下部にいるか (スクロールのたびに記録)。開いたときは一番下へ動かすので最下部から始まる
  const atBottom = useRef(true);

  /**
   * #506 一番下へ「一度に」合わせる。★ 滑らかなスクロール (scrollIntoView smooth) は裏のタブでは動かず、
   *   監視中 (ウィンドウが他の後ろ) に短い便でも取り残されていた
   */
  const pinToBottom = () => {
    const c = messagesContainerRef.current;
    if (c) c.scrollTop = c.scrollHeight;
  };

  // ★ #506 画像などが遅れて読み込まれて背が伸びたら、最下部にいる間は合わせ直す。
  //   画像の load は上へ伝わらないので、入れ物で捕まえる (capture)
  const loadListenerOn = useRef<HTMLElement | null>(null);
  const ensureLoadListener = () => {
    const c = messagesContainerRef.current;
    if (!c || loadListenerOn.current === c) return;
    c.addEventListener('load', () => { if (atBottom.current) pinToBottom(); }, true);
    loadListenerOn.current = c;
  };

  // Reset on room change
  useEffect(() => {
    isInitialLoad.current = true;
    atBottom.current = true;   // #506 開いたら一番下から始まる

    const handleScrollBottom = (e: Event) => {
      // ★ #507 マルチトークの「すべて最下部へ」は instant: 一度に合わせ、最下部にいる記録も戻す (その後の新着も追いかける)。
      //   送信後の合図 (instant なし) は今までどおり滑らか
      if ((e as CustomEvent<{ instant?: boolean }>).detail?.instant) {
        atBottom.current = true;
        pinToBottom();
        return;
      }
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    window.addEventListener('scroll:bottom', handleScrollBottom);

    return () => {
      sessionStorage.removeItem(`scrollPos:${roomId}`);
      window.removeEventListener('scroll:bottom', handleScrollBottom);
    };
  }, [roomId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length === 0) return;

    if (isInitialLoad.current) {
      const savedScrollTop = sessionStorage.getItem(`scrollPos:${roomId}`);

      if (savedScrollTop !== null) {
        setTimeout(() => {
          const container = messagesContainerRef.current;
          if (container) {
            container.scrollTop = parseInt(savedScrollTop);
            // #506 復元した位置で「最下部にいるか」を判定し直す
            atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_NEAR_BOTTOM;
          }
          markReadWhenVisible();
        }, INITIAL_SCROLL_DELAY);
        sessionStorage.removeItem(`scrollPos:${roomId}`);
      } else {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView();
          markReadWhenVisible();
        }, INITIAL_SCROLL_DELAY);
      }
      isInitialLoad.current = false;
    } else {
      // ★ #506 「最下部にいるか」は新着が来る前の記録 (atBottom) で判定する。
      //   以前は新着を描いたあとに「下端から 100px 以内か」を測っていたので、新着の高さが 100px を超えると
      //   「最下部にいない」になり、長い便ほど埋もれた (本番で 218px の便が 222px 取り残された)
      if (atBottom.current) {
        pinToBottom();
        // #474 裏にある間は既読にしない (その間の分は useSocketSync が溜めて、画面に戻ったときに既読にする)
        if (document.visibilityState === 'visible') markVisibleAsRead();
      }
    }
  }, [messages.length]);

  // ★ #506 最下部にいる間は、投稿の中身が変わって (リンクのプレビューなど) 背が伸びても合わせ直す
  useEffect(() => {
    ensureLoadListener();
    if (!isInitialLoad.current && atBottom.current) pinToBottom();
  }, [messages]);

  // IntersectionObserver for loading older messages
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = messagesContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore.current && !isInitialLoad.current) {
          isLoadingMore.current = true;
          const prevScrollHeight = container.scrollHeight;

          loadMore(roomId).then(() => {
            setTimeout(() => {
              const newScrollHeight = container.scrollHeight;
              container.scrollTop = newScrollHeight - prevScrollHeight;
              isLoadingMore.current = false;
            }, 150);
          }).catch(() => { isLoadingMore.current = false; });
        }
      },
      { root: container, rootMargin: '100px 0px 0px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [roomId, hasMore]);

  const markVisibleAsRead = useCallback(() => {
    const unreadIds = messages
      .filter((m) => m.sender_id !== user!.id)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      api.markRead(roomId, unreadIds).then(() => {
        // mark-read 後に room list を再 fetch → App Badge を即更新 (badge spike、5/12)
        useRoomStore.getState().fetchRooms();
      }).catch(() => {});
      const socket = getSocket();
      if (socket) {
        socket.emit('message:read', { room_id: roomId, message_ids: unreadIds });
      }
    }
  }, [messages, roomId, user]);

  // #474 の残り: 部屋を開いたときの既読も、画面が裏にあるなら見えるようになるまで待つ。
  //   裏のタブが自分で読み込み直したとき (新しい版への更新など) に、開いた部屋をまとめて既読にしていた
  const readDeferred = useRef(false);
  const markRef = useRef(markVisibleAsRead);
  markRef.current = markVisibleAsRead;
  const markReadWhenVisible = () => {
    if (document.visibilityState === 'visible') markRef.current();
    else readDeferred.current = true;
  };
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && readDeferred.current) {
        readDeferred.current = false;
        markRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      readDeferred.current = false;   // 部屋を切り替えたら、前の部屋の「待ち」は持ち越さない
    };
  }, [roomId]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    sessionStorage.setItem(`scrollPos:${roomId}`, String(container.scrollTop));
    // ★ #506 新着が来る前の「最下部にいるか」を覚えておく (判定の幅は今までと同じ 100px)
    atBottom.current = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_NEAR_BOTTOM;
    ensureLoadListener();
  };

  return { messagesEndRef, messagesContainerRef, loadMoreSentinelRef, handleScroll };
}
