/**
 * ルームごとの読み上げエンジン・声 (2026-09-26、利用者判断「案 B: ルームごとに切り替える」)
 *
 * ★ ダッシュボードのルーム設定 (room_settings.json) で、エンジン (Aivis / OpenAI / Gemini) と声を選べるようにする。
 *   それまでは声の選択が Aivis 専用で、**全体が OpenAI / Gemini のときは黙って無視されていた**。
 *
 * ★ 決め方 (resolveRoomTts):
 *   全体 (TTS_PROVIDER) が browser / none → ルームの設定は効かない
 *     (端末は起動時に全体の設定を見て動き方を決める。ルームだけサーバの声にすると読み上げボタンと食い違う)
 *   それ以外 → ルームの tts_engine があればそれ、無ければ全体のエンジン
 *   声: そのエンジンの一覧に在るときだけ使う (エンジンを替えたあとに前の声が残っていても壊れない)
 *   Aivis の声は今までどおり tts_model_uuid (既存のルーム設定をそのまま生かす)
 *
 * ★★ 声の一覧はここ 1 か所。ダッシュボードは GET /config/tts-options で受け取る
 *   (それまで Aivis の 10 種はダッシュボードのコードに直接書いてあった)。
 *
 * @module lib/ttsRoom
 */
import fs from 'node:fs';
import path from 'node:path';
import { getBotUserId } from './botApi.mts';

export type TtsEngine = 'aivis' | 'openai' | 'gemini';

export const TTS_ENGINES: { id: TtsEngine; label: string }[] = [
  { id: 'aivis', label: 'Aivis' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
];

export interface TtsVoice { id: string; name: string }

/** ★ 声の一覧。★★ openai は公式ドキュメントで確かめた gpt-4o-mini-tts の 13 種 (2026-09-26)、gemini は 30 種 */
export const TTS_VOICES: Record<TtsEngine, TtsVoice[]> = {
  aivis: [
    { id: 'f5017410-fbb5-49e1-97cb-e785f42e15f5', name: '凛音エル（青年女性）' },
    { id: 'a59cb814-0083-4369-8542-f51a29e72af7', name: 'まお（青年女性）' },
    { id: '6d11c6c2-f4a4-4435-887e-23dd60f8b8dd', name: 'にせ（青年男性）' },
    { id: 'e9339137-2ae3-4d41-9394-fb757a7e61e6', name: 'まい（青年女性）' },
    { id: '47e53151-a378-46f3-abee-ce13aa07feb1', name: '阿井田 茂（中年男性）' },
    { id: '71e72188-2726-4739-9aa9-39567396fb2a', name: 'fumifumi（成人男性）' },
    { id: 'baaae3c0-7b22-4605-8ba5-80c959b41a48', name: 'morioki（成人女性）' },
    { id: '696c98a2-c0b7-4fe7-8cf2-c7e9b8a9bd82', name: 'ろてじん/長老ボイス（老年男性）' },
    { id: 'a670e6b8-0852-45b2-8704-1bc9862f2fe6', name: '花音（青年女性）' },
    { id: '22e8ed77-94fe-4ef2-871f-a86f94e9a579', name: 'コハク（青年女性）' },
  ],
  openai: ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']
    .map((id) => ({ id, name: id === 'marin' || id === 'cedar' ? `${id}（おすすめ）` : id })),
  gemini: ['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
    'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
    'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat']
    .map((id) => ({ id, name: id })),
};

export interface RoomTtsSettings {
  tts_engine?: string;
  tts_voice?: string;
  tts_model_uuid?: string;
}

export type ResolvedTts =
  | { mode: 'browser' }
  | { mode: 'none' }
  | { mode: 'server'; engine: TtsEngine; modelUuid?: string; voice?: string };

const isEngine = (v: unknown): v is TtsEngine => v === 'aivis' || v === 'openai' || v === 'gemini';

/** 全体の TTS_PROVIDER → エンジン (★ aivis-cloud とそれ以外の知らない値は aivis、既存どおり) */
function engineOfProvider(provider: string | undefined): TtsEngine {
  if (provider === 'openai') return 'openai';
  if (provider === 'gemini') return 'gemini';
  return 'aivis';
}

/** ★ ルームの設定から、どのエンジン・声で読むかを決める (純関数) */
export function resolveRoomTts(globalProvider: string | undefined, room: RoomTtsSettings | null | undefined): ResolvedTts {
  if (globalProvider === 'browser') return { mode: 'browser' };
  if (globalProvider === 'none') return { mode: 'none' };
  const r = room || {};
  const engine = isEngine(r.tts_engine) ? r.tts_engine : engineOfProvider(globalProvider);
  if (engine === 'aivis') {
    return r.tts_model_uuid ? { mode: 'server', engine, modelUuid: r.tts_model_uuid } : { mode: 'server', engine };
  }
  const voice = r.tts_voice && TTS_VOICES[engine].some((v) => v.id === r.tts_voice) ? r.tts_voice : undefined;
  return voice ? { mode: 'server', engine, voice } : { mode: 'server', engine };
}

/** ★ ルームの room_settings.json を読む (★ 無い・壊れているときは null。読み上げのたびに読むので保存すればすぐ効く) */
export function readRoomTtsSettings(roomId: string | undefined): RoomTtsSettings | null {
  if (!roomId) return null;
  try {
    const agentId = getBotUserId();
    if (!agentId) return null;
    const workspaceRoot = process.env.AGENT_WORKSPACE_ROOT || path.join(import.meta.dirname, '../../agent-workspaces');
    const settingsPath = path.join(workspaceRoot, agentId, roomId, 'room_settings.json');
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as RoomTtsSettings;
  } catch { return null; }
}
