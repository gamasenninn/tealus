import { useState, useCallback } from 'react';
import { api } from '../services/api';
import type { MessageTag } from '../types';

export type TagEntry = MessageTag & { id: string };

/**
 * #344 候補3: メッセージのタグ状態 + 再取得を 1 本化。
 * MessageBubble に 3 箇所コピーされていた `api.getMessageTags → setTags` を集約する。
 */
export function useMessageTags(messageId: string, initialTags?: TagEntry[]) {
  const [tags, setTags] = useState<TagEntry[]>(initialTags || []);
  const refreshTags = useCallback(async () => {
    try {
      const res = await api.getMessageTags(messageId);
      setTags(res.tags as TagEntry[]);
    } catch (err) {
      console.error('Tag refresh error:', err);
    }
  }, [messageId]);
  return { tags, refreshTags };
}
