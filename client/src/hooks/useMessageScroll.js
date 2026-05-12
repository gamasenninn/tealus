import { useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMessageStore } from '../stores/messageStore';
import { useRoomStore } from '../stores/roomStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { SCROLL_NEAR_BOTTOM, INITIAL_SCROLL_DELAY } from '../constants/ui';

/**
 * Manages scroll behavior, pagination, and auto-scroll.
 */
export function useMessageScroll(roomId) {
  const { user } = useAuthStore();
  const { messages, loadMore, hasMore } = useMessageStore();
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const isInitialLoad = useRef(true);
  const isLoadingMore = useRef(false);

  // Reset on room change
  useEffect(() => {
    isInitialLoad.current = true;

    const handleScrollBottom = () => {
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
          }
          markVisibleAsRead();
        }, INITIAL_SCROLL_DELAY);
        sessionStorage.removeItem(`scrollPos:${roomId}`);
      } else {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView();
          markVisibleAsRead();
        }, INITIAL_SCROLL_DELAY);
      }
      isInitialLoad.current = false;
    } else {
      const container = messagesContainerRef.current;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_NEAR_BOTTOM;
        if (isNearBottom) {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          markVisibleAsRead();
        }
      }
    }
  }, [messages.length]);

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
      .filter((m) => m.sender_id !== user.id)
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

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    sessionStorage.setItem(`scrollPos:${roomId}`, container.scrollTop);
  };

  return { messagesEndRef, messagesContainerRef, loadMoreSentinelRef, handleScroll };
}
