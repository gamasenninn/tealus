/**
 * #336 汎用フォーム primitive — content 内 ```tealus-form fence の parse と回答 text 組み立て。
 *
 * フォームメッセージの content は「可読ヘッダ + fenced tealus-form JSON」形式。
 * fence が機械可読の source of truth。parse 失敗/不在は null を返し、呼び出し側は
 * markdown fallback (可読ヘッダ表示) に委ねる。純関数のみ (Vitest 対象)。
 */
import type { FormSchema, FormField } from '../types';

const FENCE_RE = /```tealus-form\s*\n([\s\S]*?)\n```/;

/** content から FormSchema を抽出。fence 不在・壊れ JSON・妥当性 NG は null。 */
export function parseForm(content: string | null | undefined): FormSchema | null {
  if (typeof content !== 'string' || !content) return null;
  const m = content.match(FENCE_RE);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]) as unknown;
    if (!isValidSchema(obj)) return null;
    return obj;
  } catch {
    return null;
  }
}

function isValidSchema(o: unknown): o is FormSchema {
  if (!o || typeof o !== 'object') return false;
  const s = o as Record<string, unknown>;
  if (s.version !== 1) return false;
  if (typeof s.title !== 'string') return false;
  if (!Array.isArray(s.fields) || s.fields.length === 0) return false;
  return s.fields.every((f) => {
    if (!f || typeof f !== 'object') return false;
    const fld = f as Record<string, unknown>;
    if (typeof fld.id !== 'string' || typeof fld.label !== 'string') return false;
    if (fld.type === 'radio') return Array.isArray(fld.options) && fld.options.length > 0;
    return fld.type === 'text';
  });
}

/** フォーム回答の入力値。radio は選択 value(+補足 text)、text は text。 */
export type FormValues = Record<string, { value?: string; text?: string }>;

/** radio option の value → label 解決 (補足ラベルも) */
function radioLabel(field: Extract<FormField, { type: 'radio' }>, value: string | undefined): string {
  const opt = field.options.find((o) => o.value === value);
  return opt ? opt.label : (value || '(未選択)');
}

/**
 * 回答を human-readable text に組み立てる。
 * 先頭に reply_mention (あれば単独行) → 「【回答】<title>」→ 各 field「<label>: <値>」。
 * radio の allow_text 補足は次行にインデントで追記。
 */
export function buildAnswerText(schema: FormSchema, values: FormValues): string {
  const lines: string[] = [];
  if (schema.reply_mention) {
    lines.push(schema.reply_mention, '');
  }
  lines.push(`【回答】${schema.title}`);
  for (const field of schema.fields) {
    const v = values[field.id] || {};
    if (field.type === 'radio') {
      lines.push(`${field.label}: ${radioLabel(field, v.value)}`);
      const opt = field.options.find((o) => o.value === v.value);
      if (opt?.allow_text && v.text && v.text.trim()) {
        lines.push(`　${opt.text_label || '補足'}: ${v.text.trim()}`);
      }
    } else {
      lines.push(`${field.label}: ${(v.text || '').trim()}`);
    }
  }
  return lines.join('\n');
}
