import { useState, memo } from 'react';
import { api } from '../../services/api';
import { getSocket } from '../../services/socket';
import { useMessageStore } from '../../stores/messageStore';
import { useAuthStore } from '../../stores/authStore';
import { buildAnswerText, hasUserAnsweredForm, type FormValues } from '../../utils/parseForm';
import type { FormSchema, Message } from '../../types';
import './FormBubble.css';

interface FormBubbleProps {
  message: Message;
  schema: FormSchema;
  roomId?: string;
}

/**
 * #336 汎用フォーム primitive のレンダラ。
 * radio(単一選択・補足text) + text(自由記述) を React 要素で描画し、[回答する] で
 * 回答を human-readable text に組み立て、先頭に schema.reply_mention を付けて
 * reply_to=フォームID の新規メッセージとして送信する (= CCブリッジ起動を兼ねる)。
 * ★ 送信は socket 経路 (message:send)。REST POST は message.created webhook を発火せず
 *   cc-queue routing に乗らないため、行頭 @cc-* で consumer を起こすには socket が必須
 *   (MessageInput.handleSend と同じ socket 優先・REST fallback)。
 */
function FormBubble({ message, schema, roomId }: FormBubbleProps) {
  const [values, setValues] = useState<FormValues>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // #336 二重回答防止: サーバに状態を持たず、既存の返信データから「自分がこのフォームに
  // 回答済みか」を導出する。リロード後も残り(隣接ロード)、他人の回答も message:new で
  // ライブに反映され、ボタンが締まる。ローカル `sent` は送信直後〜返信到達までの即時反映用。
  const userId = useAuthStore((s) => s.user?.id);
  const answeredInStore = useMessageStore((s) => hasUserAnsweredForm(s.messages, message.id, userId));
  const answered = sent || answeredInStore;

  const setRadio = (fieldId: string, value: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], value } }));
  const setText = (fieldId: string, text: string) =>
    setValues((prev) => ({ ...prev, [fieldId]: { ...prev[fieldId], text } }));

  // required 未充足なら送信不可
  const canSubmit = schema.fields.every((f) => {
    if (!f.required) return true;
    const v = values[f.id];
    if (f.type === 'radio') return !!v?.value;
    return !!v?.text?.trim();
  });

  const handleSubmit = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canSubmit || sending || answered || !roomId) return;
    setSending(true);
    try {
      const content = buildAnswerText(schema, values);
      const socket = getSocket();
      if (socket?.connected) {
        // socket 経路: message.created webhook が発火し cc-queue routing に乗る (reply_mention 起動)
        socket.emit('message:send', { room_id: roomId, content, reply_to: message.id });
      } else {
        // fallback: socket 未接続時のみ REST (この経路は webhook 非発火 = consumer 起動しない)
        await api.request('POST', `/rooms/${roomId}/messages`, { content, type: 'text', reply_to: message.id });
        await useMessageStore.getState().fetchMessages(roomId);
      }
      setSent(true);
      window.dispatchEvent(new CustomEvent('scroll:bottom'));
    } catch (err) {
      console.error('Form answer send error:', err);
      setSending(false); // 失敗時は再試行可能に
    }
  };

  return (
    <div className="cform-bubble" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="cform-title">📋 {schema.title}</div>
      {schema.intro && <div className="cform-intro">{schema.intro}</div>}

      {schema.fields.map((field) => (
        <div key={field.id} className="cform-field">
          <div className="cform-label">
            {field.label}
            {field.required && <span className="cform-required">*</span>}
          </div>

          {field.type === 'radio' ? (
            <div className="cform-radio-group">
              {field.options.map((opt) => {
                const selected = values[field.id]?.value === opt.value;
                return (
                  <div key={opt.value} className="cform-radio-row">
                    <label className="cform-radio-option">
                      <input
                        type="radio"
                        name={`${message.id}-${field.id}`}
                        checked={selected}
                        disabled={answered}
                        onChange={() => setRadio(field.id, opt.value)}
                      />
                      <span>{opt.label}</span>
                    </label>
                    {opt.allow_text && selected && (
                      <input
                        type="text"
                        className="cform-suboption-text"
                        placeholder={opt.text_label || '補足'}
                        value={values[field.id]?.text || ''}
                        disabled={answered}
                        onChange={(e) => setText(field.id, e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : field.multiline ? (
            <textarea
              className="cform-text"
              rows={3}
              placeholder={field.placeholder || ''}
              value={values[field.id]?.text || ''}
              disabled={answered}
              onChange={(e) => setText(field.id, e.target.value)}
            />
          ) : (
            <input
              type="text"
              className="cform-text"
              placeholder={field.placeholder || ''}
              value={values[field.id]?.text || ''}
              disabled={answered}
              onChange={(e) => setText(field.id, e.target.value)}
            />
          )}
        </div>
      ))}

      <button
        className="cform-submit"
        onClick={handleSubmit}
        disabled={!canSubmit || sending || answered}
      >
        {answered ? '回答済み' : sending ? '送信中…' : (schema.submit_label || '回答する')}
      </button>
    </div>
  );
}

export default memo(FormBubble);
