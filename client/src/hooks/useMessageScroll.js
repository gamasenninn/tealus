import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../stores/authStore';
import { useMessageStore } from '../stores/messageStore';
import { getSocket } from '../services/socket';
import { api } from '../services/api';
import { SCROLL_THRESHOLD, SCROLL_NEAR_BOTTOM, SCROLL_HEADER_OFFSET, INITIAL_SCROLL_DELAY } from '../constants/ui';

/**
 * Manages scroll behavior, pagination, auto-scroll, and sticky date.
 */
export function useMessageScroll(roomId) {
  const { user } = useAuthStore();
  const { messages, loadMore, hasMore } = useMessageStore();
  const [stickyDate, setStickyDate] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const isInitialLoad = useRef(true);

  // Reset on room change
  useEffect(() => {
    isInitialLoad.current = true;

    const handleScrollBottom = () => {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    };
    window.addEventListener('scroll:bottom', handleScrollBottom);

    return () => {
      window.removeEventListener('scroll:bottom', handleScrollBottom);
    };
  }, [roomId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length === 0) return;

    if (isInitialLoad.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView();
        markVisibleAsRead();
      }, INITIAL_SCROLL_DELAY);
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

  const markVisibleAsRead = useCallback(() => {
    const unreadIds = messages
      .filter((m) => m.sender_id !== user.id)
      .map((m) => m.id);
    if (unreadIds.length > 0) {
      api.markRead(roomId, unreadIds).catch(() => {});
      const socket = getSocket();
      if (socket) {
        socket.emit('message:read', { room_id: roomId, message_ids: unreadIds });
      }
    }
  }, [messages, roomId, user]);

  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    if (container.scrollTop < SCROLL_THRESHOLD && hasMore) {
      const prevScrollHeight = container.scrollHeight;
      loadMore(roomId).then(() => {
        requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeight;
        });
      });
    }

    // Update sticky date
    const separators = container.querySelectorAll('[data-date]');
    let currentDate = null;
    for (const sep of separators) {
      const rect = sep.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      if (rect.top <= containerRect.top + SCROLL_HEADER_OFFSET) {
        currentDate = sep.getAttribute('data-date');
      } else {
        break;
      }
    }
    setStickyDate(currentDate);
  };

  return { messagesEndRef, messagesContainerRef, stickyDate, handleScroll };
}
