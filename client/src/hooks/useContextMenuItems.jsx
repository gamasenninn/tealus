import { Copy, Reply, Tag, Pencil, ClipboardList, Trash2, History, Megaphone, CheckSquare } from 'lucide-react';
import { api } from '../services/api';
import { useMessageStore } from '../stores/messageStore';

/**
 * メッセージのコンテキストメニュー項目を生成するhook
 */
export function buildContextMenuItems({
  message, isOwn, roomId, currentRoom,
  onEdit, onShowEditHistory,
  onReply, onShowTagModal, onShowTodoMenu,
}) {
  const items = [];

  // Copy (text messages only)
  if (message.content && message.type === 'text') {
    items.push({
      icon: <Copy size={16} />,
      label: 'コピー',
      onClick: () => navigator.clipboard.writeText(message.content),
    });
  }

  // Edit message / Add caption
  const editPolicy = currentRoom?.message_edit_policy || 'none';
  const isFirstCaption = !message.content && isOwn && message.type !== 'system' && message.type !== 'stamp';
  const canEditMessage = !message.is_deleted && message.type !== 'system' && message.type !== 'stamp' && (
    isFirstCaption || (editPolicy === 'sender' && isOwn) || editPolicy === 'member'
  );
  if (canEditMessage) {
    items.push({
      icon: <Pencil size={16} />,
      label: message.content ? 'メッセージを編集' : 'テキストを追加',
      onClick: onEdit,
    });
  }
  if (message.is_edited) {
    items.push({
      icon: <History size={16} />,
      label: '編集履歴',
      onClick: onShowEditHistory,
    });
  }

  // Reply
  items.push({
    icon: <Reply size={16} />,
    label: 'リプライ',
    onClick: onReply,
  });

  // Tag
  items.push({
    icon: <Tag size={16} />,
    label: 'タグを追加',
    onClick: onShowTagModal,
  });

  // TODO
  items.push({
    icon: <CheckSquare size={16} />,
    label: 'TODO',
    onClick: onShowTodoMenu,
  });

  // Copy voice transcription text
  const transText = message.transcription?.formatted_text || message.transcription?.raw_text;
  if (message.type === 'voice' && message.transcription?.status === 'done' && transText) {
    items.push({
      icon: <Copy size={16} />,
      label: '文字起こしをコピー',
      onClick: () => navigator.clipboard.writeText(transText),
    });
  }

  // Voice transcription actions
  const canEditTranscription = isOwn || currentRoom?.allow_member_transcription_edit;
  if (canEditTranscription && message.type === 'voice' && message.transcription?.status === 'done') {
    items.push({
      icon: <Pencil size={16} />,
      label: '文字起こしを編集',
      onClick: () => {
        window.dispatchEvent(new CustomEvent('voice:edit', { detail: { messageId: message.id } }));
      },
    });
    if (message.transcription?.version > 1) {
      items.push({
        icon: <ClipboardList size={16} />,
        label: '編集履歴',
        onClick: () => {
          window.dispatchEvent(new CustomEvent('voice:history', { detail: { messageId: message.id } }));
        },
      });
    }
  }

  // Publish/Unpublish (announcement rooms only)
  if (currentRoom?.is_announcement && !message.is_deleted && message.type !== 'system') {
    items.push({
      icon: <Megaphone size={16} />,
      label: message.is_published ? 'お知らせから非公開' : 'お知らせに公開',
      onClick: async () => {
        try {
          await api.togglePublish(roomId, message.id, !message.is_published);
        } catch (err) { console.error(err); }
      },
    });
  }

  // Delete (own messages only)
  if (isOwn) {
    items.push({
      icon: <Trash2 size={16} />,
      label: '削除',
      danger: true,
      onClick: async () => {
        if (confirm('このメッセージを削除しますか？')) {
          try {
            await api.deleteMessage(roomId, message.id);
            useMessageStore.getState().markDeleted(message.id);
          } catch (err) { console.error('Delete error:', err); }
        }
      },
    });
  }

  // Reaction handler
  const onReaction = async (emoji) => {
    try {
      await api.toggleReaction(roomId, message.id, emoji);
    } catch (err) { console.error('Reaction error:', err); }
  };

  return { items, onReaction };
}
