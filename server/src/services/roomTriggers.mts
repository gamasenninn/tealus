/**
 * ルームトリガー: 設定の読み込みと検証 (#382 第 1 段)
 *
 * 設計は docs/06_ルームトリガー設計.md。**拡張を思いついたら先に §9「作らないもの」を読むこと。**
 *
 * ★ この module の姿勢: **黙って減らさない。**
 *   壊れた行は落とすが、必ず warn を返す。落として無言だと「設定したのに動かない」が
 *   沈黙になり、この機能がいちばん困る形で壊れる (docs/06 §6)。
 *
 * ★★ 判定のたびに読み直す = 再起動不要。前例は line-group-mappings.json (§4)。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 種別。★ text は許さない —— ループ防止の本体 (docs/06 §6.1) */
export const ALLOWED_TYPES = ['image', 'video', 'voice', 'stamp'] as const;
export type TriggerType = (typeof ALLOWED_TYPES)[number];

export type TriggerWhen = 'immediate' | 'every' | 'schedule';

export interface RoomTrigger {
  id: string;
  room_id: string;
  /** 人が読むための併記。room_id が正 (§4.1) */
  room: string;
  types: TriggerType[];
  when: TriggerWhen;
  message: string;
  as_user_id: string;
  enabled: boolean;
  description: string;
  /** when === 'every' のみ */
  interval_minutes?: number;
  /** when === 'schedule' のみ。JST の HH:MM */
  at?: string;
}

export interface LoadResult {
  triggers: RoomTrigger[];
  /** 落とした行の理由。呼び出し側が必ず warn として出すこと */
  warnings: string[];
  /**
   * ★ 設定ファイルの mtime = 「このトリガーを有効にした時刻」。
   *   まだ一度も撃っていないトリガーの起点に使う (roomTriggerDecide の bootstrapAt)。
   *   ファイルが無い / パース済みの値から読んだ場合は null。
   */
  mtime: Date | null;
}

export const CONFIG_PATH = path.join(import.meta.dirname, '..', '..', 'config', 'room-triggers.json');

/**
 * 自動投稿の印 (docs/06 §10)。
 *
 * ★ 2 行目に置く。接頭辞にすると `^@cc-` の先頭判定に当たらなくなり、
 *   **エージェントが起動しない** = 機能そのものが動かない。
 * ★★ 括弧の中は id。§3.1.1 でこの文字列が「前回撃った時刻」の検索キーになる。
 */
export function markFor(id: string): string {
  return `— 自動投稿 (room-triggers: ${id})`;
}

/** 投稿する本文。1 行目は message そのまま (mention 判定を壊さない) */
export function buildBody(t: RoomTrigger): string {
  return `${t.message}\n${markFor(t.id)}`;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** 1 行を検証する。通れば RoomTrigger、駄目なら理由 */
function validate(raw: unknown, index: number): RoomTrigger | string {
  const where = `room-triggers[${index}]`;
  if (typeof raw !== 'object' || raw === null) return `${where}: オブジェクトではありません`;
  const r = raw as Record<string, unknown>;

  if (!isNonEmptyString(r.id)) return `${where}: id がありません`;
  if (!isNonEmptyString(r.room_id)) return `${where} (${r.id}): room_id がありません`;
  if (!isNonEmptyString(r.message)) return `${where} (${r.id}): message がありません`;
  // ★ 設定した人と名義は同じ人に限る (§5)。別々にできると他人名義で無人実行を仕込める
  if (!isNonEmptyString(r.as_user_id)) return `${where} (${r.id}): as_user_id がありません`;

  const when = r.when;
  if (when !== 'immediate' && when !== 'every' && when !== 'schedule') {
    return `${where} (${r.id}): when が immediate / every / schedule のいずれでもありません`;
  }

  const types = Array.isArray(r.types) ? r.types : [];
  // ★ text を許さない = ループ防止の本体 (§6.1)
  if (types.includes('text')) {
    return `${where} (${r.id}): types に text は許されません (エージェントの返信で無限ループになります)`;
  }
  const bad = types.find((t) => !ALLOWED_TYPES.includes(t as TriggerType));
  if (bad !== undefined) return `${where} (${r.id}): types に未知の種別 ${String(bad)} があります`;
  // schedule は時刻だけで撃つので types を要求しない
  if (when !== 'schedule' && types.length === 0) {
    return `${where} (${r.id}): types が空です (${when} は種別で絞ります)`;
  }

  if (when === 'every' && (typeof r.interval_minutes !== 'number' || r.interval_minutes <= 0)) {
    return `${where} (${r.id}): every には interval_minutes (正の数) が要ります`;
  }
  // ★ JST の HH:MM。UTC と混ぜない (§6)
  if (when === 'schedule' && !(isNonEmptyString(r.at) && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.at))) {
    return `${where} (${r.id}): schedule には at (JST の HH:MM) が要ります`;
  }

  return {
    id: r.id,
    room_id: r.room_id,
    room: isNonEmptyString(r.room) ? r.room : '',
    types: types as TriggerType[],
    when,
    message: r.message,
    as_user_id: r.as_user_id,
    // ★ 既定は false。書き忘れで勝手に撃たない方が安全
    enabled: r.enabled === true,
    description: isNonEmptyString(r.description) ? r.description : '',
    ...(when === 'every' ? { interval_minutes: r.interval_minutes as number } : {}),
    ...(when === 'schedule' ? { at: r.at as string } : {}),
  };
}

/** パース済みの値から読む (テストと loadTriggers の共通部分) */
export function loadTriggersFrom(parsed: unknown, mtime: Date | null = null): LoadResult {
  if (!Array.isArray(parsed)) {
    return { triggers: [], warnings: ['room-triggers.json が配列ではありません (全行を無視します)'], mtime };
  }
  const triggers: RoomTrigger[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  parsed.forEach((raw, i) => {
    const result = validate(raw, i);
    if (typeof result === 'string') {
      warnings.push(result);
      return;
    }
    // ★ id が重複すると印から前回発火を引けなくなる (§3.1.1/§4.0)
    if (seen.has(result.id)) {
      warnings.push(`room-triggers[${i}]: id ${result.id} が重複しています (後の行を無視します)`);
      return;
    }
    seen.add(result.id);
    triggers.push(result);
  });
  return { triggers, warnings, mtime };
}

/**
 * 設定ファイルを読む。
 *
 * ★ ファイルが無いのは正常 (トリガー未設定)。壊れているのは warn。
 *   **起動は止めない** —— トリガーの設定ミスで本体が上がらない方が高くつく。
 */
export function loadTriggers(configPath: string = CONFIG_PATH): LoadResult {
  let text: string;
  let mtime: Date | null = null;
  try {
    text = fs.readFileSync(configPath, 'utf8');
    // ★ 「有効にした時刻」として使う。読めなければ null (= 従来どおりの挙動に落ちる)
    try { mtime = fs.statSync(configPath).mtime; } catch { mtime = null; }
  } catch {
    return { triggers: [], warnings: [], mtime: null };
  }
  try {
    return loadTriggersFrom(JSON.parse(text), mtime);
  } catch (err) {
    return {
      triggers: [],
      warnings: [`room-triggers.json が JSON として読めません: ${err instanceof Error ? err.message : String(err)}`],
      mtime,
    };
  }
}
