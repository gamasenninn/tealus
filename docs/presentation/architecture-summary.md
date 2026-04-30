# Tealus アーキテクチャ要約 (Phase 0 共通素材)

**プレゼン用の簡略版**。詳細は `docs/03_アーキテクチャ設計.md` 参照。本ファイルは Full pitch / 技術評価者向け資料・LP の **アーキ図** の元素材。

---

## 一言で

> **PWA + Node.js + PostgreSQL + Redis** の標準 web stack に、**MCP / mediasoup / OpenAI** を統合した messenger。

「特殊な technology」を使っていないので OSS として読みやすく、自社で動かしやすい。

---

## システム構成 (簡略図)

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare DNS / SSL                   │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│                  Nginx (リバプロ)                        │
└─┬──────────────────────────────────────────────────────┬┘
  │                                                      │
┌─┴────────────────────────┐         ┌──────────────────┴─┐
│   Node.js サーバー       │         │  React PWA         │
│   - Express (REST API)   │         │  - Vite ビルド     │
│   - Socket.IO (リアルタイム)│         │  - Service Worker  │
│   - Web Push 通信        │         │  - Web Push        │
└─┬────────────────┬──────┘         └────────────────────┘
  │                │
┌─┴──────────┐  ┌──┴────────┐  ┌────────────────────┐
│ PostgreSQL │  │   Redis   │  │  外部 AI / TTS     │
│  (RLS)     │  │ (Pub/Sub  │  │  - OpenAI Whisper  │
│            │  │  在席状態)│  │  - OpenAI gpt-4o   │
│            │  │           │  │  - Aivis (TTS)     │
└────────────┘  └───────────┘  └────────────────────┘
                                         ▲
                                         │
┌────────────────────────────────────────┴──────────────┐
│  agent-server (Light agent)         Claude Code CLI   │
│  - OpenAI Agents SDK                (Deep agent)      │
│  - tealus-mcp 統合                  - tealus-mcp 統合│
│  - 11 MCP tools                     - 11 MCP tools   │
└───────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────┐
│  rtc-server (オプショナル、通話用)                       │
│  - mediasoup SFU (WebRTC)                              │
│  - PlainTransport (TTS 配信)                           │
└─────────────────────────────────────────────────────────┘
```

---

## 各コンポーネントの役割

### Core (必須)

| コンポーネント | 役割 |
|---|---|
| **Cloudflare** | DNS、SSL、外部アクセス、DDoS 防御 |
| **Nginx** | リバプロ、SSL 終端、静的ファイル配信 |
| **Node.js (Express + Socket.IO)** | REST API、WebSocket、Web Push |
| **PostgreSQL** | 全データ永続化 (RLS で行単位アクセス制御) |
| **Redis** | WebSocket Pub/Sub、在席状態、セッションキャッシュ |
| **React PWA** | UI、PWA、Web Push 受信 |

### AI 連携層

| コンポーネント | 役割 |
|---|---|
| **OpenAI Whisper API** | 音声 → raw_text 転写 |
| **OpenAI gpt-4o-mini** | raw_text → formatted_text 整形、AI agent の応答 |
| **Aivis (任意)** | TTS (Text-to-Speech) 高品質音声合成 |
| **agent-server** | Light agent の host (OpenAI Agents SDK) |
| **Claude Code CLI** | Deep agent (user の手元に常駐) |
| **tealus-mcp v0.6.0** | 11 MCP tools、Light/Deep 両 agent から共通利用 |

### 通話層 (オプショナル)

| コンポーネント | 役割 |
|---|---|
| **rtc-server** | mediasoup SFU、WebRTC、トランシーバー、TTS 配信 |

---

## デプロイ構成 (3 種)

### 1. **Default** (`docker-compose.yml`)
- Postgres + Redis のみ Docker
- Node サービスはホスト (`npm run dev`)
- 用途: 開発者環境

### 2. **Full** (`docker-compose.full.yml`) ← **OSS 採用者の推奨**
- Postgres + Redis + server + agent-server を Docker
- 1 ファイル paste & build で起動
- 用途: NAS / Linux / Mac mini デプロイ

### 3. **+RTC** (`docker-compose.rtc.yml`)
- Full に加えて rtc-server も Docker (Linux のみ、`network_mode: host` で UDP 対応)
- 用途: 通話機能を含む完全構成

---

## DB 主要テーブル (Phase 1-4)

```
users ──┬──< room_members >──┬── rooms
        │                     │
        ├──< messages >───────┘
        │      │
        │      ├──< message_media         (画像/動画/ファイル)
        │      ├──< voice_transcriptions  (Whisper raw + AI 整形 formatted、version 履歴)
        │      ├──< message_reactions     (リアクション)
        │      ├──< message_tags          (TODO / tealus関係 等)
        │      └──< message_reads         (既読数)
        │
        ├──< room_read_cursors >── rooms (未読数)
        ├──< push_subscriptions          (PWA Push)
        └──< tags >── rooms              (room スコープのタグ)
```

詳細は `docs/02_DB設計.md` 参照。21 migrations、すべて idempotent。

---

## データフロー: 音声メッセージ転写

```
1. [React] 録音 → POST /api/rooms/:id/voice
2. [Node.js] message (type='voice') 作成、voice_transcriptions に pending 行
3. [非同期] transcribeVoiceMessage() 起動
4. [OpenAI Whisper] raw_text 取得 (whisper_context に組織固有プロンプト注入)
5. [OpenAI gpt-4o-mini] AI 整形 → formatted_text
   ↑ vocabulary + guidelines を SYSTEM_PROMPT に注入 (組織固有辞書)
6. [Socket.IO] voice:transcription イベントでルーム配信
7. [DB] voice_transcriptions に raw + formatted 保存 (version=1、edited_by=NULL)

[user 編集時]
8. PUT /api/messages/:id/transcription → version=2、edited_by=userId で INSERT
9. 編集履歴は INSERT のみ (immutable)、自動学習 (#206) のラベルデータになる
```

「**Whisper の prompt は鈍器**」 → vocabulary を強く渡すと隣接音が歪む副作用。Tealus は **AI 整形に正規化を集約**、Whisper にはドメイン文脈の散文のみ渡す設計。

---

## MCP エコシステム (Tealus 独自の AI 統合)

```
┌──────────────────────────────────────────────────┐
│ Light Agent (gpt-4o-mini)  Deep Agent (Claude)   │
│       ↓                          ↓                │
│  ╔═══════ tealus-mcp v0.6.0 (11 tools) ════════╗ │
│  ║  send_message     send_image                 ║ │
│  ║  get_messages     get_message_media          ║ │
│  ║  list_rooms       join_room                  ║ │
│  ║  mark_read        mark_tag_done              ║ │
│  ║  search_messages  create_room  delete_room   ║ │
│  ╚═══════════════════════════════════════════════╝ │
│       ↓                                            │
│  Tealus Bot API (REST + JWT 認証)                 │
└──────────────────────────────────────────────────┘
```

導入は **`npx -y github:gamasenninn/tealus-mcp`** 1 行。npm publish ではなく GitHub 直接 install (#187)。

---

## セキュリティ / アクセス制御

| 層 | 実装 |
|---|---|
| 認証 | JWT (Bot 認証も同じ token system) |
| ルームアクセス | RLS (Row Level Security)、room_members 経由でルーム単位制限 |
| 削除権限 | 送信者のみ (一部 admin override)、ルーム削除は creator + solo member 必須 (#207) |
| Bot 権限 | 参加ルームのみアクセス、admin と user の 2 階層 |
| メディア | 認証必須、JWT 検証で配信 |

---

## 拡張性 / 採用容易性

- **Frontend**: React + Vite (標準 web stack、特殊技術なし)
- **Backend**: Node.js (npm エコシステム、開発者多数)
- **Database**: PostgreSQL (世界標準、運用ノウハウ豊富)
- **AI**: OpenAI API (cost 透明、API key 1 つで動く)
- **MCP**: モダンな AI tool プロトコル、Claude / OpenAI 両対応
- **Docker**: 標準 deploy 方式、NAS UI から起動可能

「**特殊技術ゼロ**」がコンセプト。OSS 採用者が手元で動かしやすく、自社改造もしやすい。

---

## 改訂履歴

- 2026-04-30 v1: 既存 `docs/03_アーキテクチャ設計.md` を pitch 用に簡略化。Step 14 までの実装 (MCP 11 ツール、self-improving、create/delete primitive) を反映。
