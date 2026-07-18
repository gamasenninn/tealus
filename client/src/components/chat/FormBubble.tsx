import { useState, memo } from 'react';
import { api } from '../../services/api';
import { useMessageStore } from '../../stores/messageStore';
import { buildAnswerText, type FormValues } from '../../utils/parseForm';
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
 * 送信は sendStamp 同型 (api.request POST /rooms/:id/messages with type:'text', reply_to)。
 */
function FormBubble({ message, schema, roomId }: FormBubbleProps) {
  const [values, setValues] = useState<FormValues>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

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
    if (!canSubmit || sending || sent || !roomId) return;
    setSending(true);
    try {
      const content = buildAnswerText(schema, values);
      await api.request('POST', `/rooms/${roomId}/messages`, {
        content,
        type: 'text',
        reply_to: message.id,
      });
      setSent(true);
      await useMessageStore.getState().fetchMessages(roomId);
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
                        disabled={sent}
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
                        disabled={sent}
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
              disabled={sent}
              onChange={(e) => setText(field.id, e.target.value)}
            />
          ) : (
            <input
              type="text"
              className="cform-text"
              placeholder={field.placeholder || ''}
              value={values[field.id]?.text || ''}
              disabled={sent}
              onChange={(e) => setText(field.id, e.target.value)}
            />
          )}
        </div>
      ))}

      <button
        className="cform-submit"
        onClick={handleSubmit}
        disabled={!canSubmit || sending || sent}
      >
        {sent ? '回答済み' : sending ? '送信中…' : (schema.submit_label || '回答する')}
      </button>
    </div>
  );
}

export default memo(FormBubble);
