# Linny

オープンソースの社内メッセンジャー。直感的なチャットUIで、画像・動画はサーバー保存（端末容量を使わない）。

## 背景

- 既存メッセンジャーの画像・動画が個人スマホの容量を圧迫
- 外部サービスのAPI連携コストが高額
- 誰でも使える直感的なUIが必要

## 機能（Phase 1）

- 1対1チャット / グループチャット
- テキストメッセージ（リアルタイム送受信）
- 画像・動画・ファイルのアップロード（サーバー保存・サムネイル自動生成）
- 既読表示（トーク一覧: 未読数、トーク画面: 既読数）
- リプライ（引用返信）
- Push通知（PWA Service Worker）
- 社員番号ログイン（JWT認証）
- 直感的な吹き出しUI
- PWA対応（スマホ・PCのブラウザから利用、ホーム画面に追加可能）

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 19 + Vite + PWA (vite-plugin-pwa) |
| 状態管理 | Zustand |
| バックエンド | Node.js + Express + Socket.IO |
| DB | PostgreSQL 16 (RLS有効) |
| キャッシュ | Redis 7 |
| ファイルアップロード | multer + sharp (サムネイル生成) |
| 認証 | JWT + bcrypt |
| Push通知 | web-push (VAPID) |
| コンテナ | Docker Compose |

## セットアップ

### 前提条件

- Node.js 18+
- Docker / Docker Compose
- Git

### 1. リポジトリをクローン

```bash
git clone https://github.com/gamasenninn/linny.git
cd linny
```

### 2. Docker起動（PostgreSQL + Redis）

```bash
docker-compose up -d
```

これにより以下が起動します:

| サービス | ポート | 用途 |
|----------|--------|------|
| PostgreSQL | 5432 | 開発用DB |
| PostgreSQL | 5433 | テスト用DB |
| Redis | 6379 | セッション・在席状態管理 |

### 3. サーバーセットアップ

```bash
cd server
npm install
```

#### 環境変数

`server/.env` はデフォルト値が設定済みですが、本番環境では以下を変更してください:

| 変数 | 説明 |
|------|------|
| `JWT_SECRET` | JWT署名キー（必ず変更） |
| `VAPID_PUBLIC_KEY` | Web Push公開鍵 |
| `VAPID_PRIVATE_KEY` | Web Push秘密鍵 |

VAPID鍵の生成:
```bash
npx web-push generate-vapid-keys
```

#### DBマイグレーション

```bash
npm run migrate
```

#### サーバー起動

```bash
npm run dev    # 開発（nodemon）
npm start      # 本番
```

サーバーは `http://localhost:3000` で起動します。

### 4. クライアントセットアップ

```bash
cd client
npm install
npm run dev
```

クライアントは `http://localhost:5173` で起動します。
Viteのプロキシ設定により、`/api/*` と `/socket.io` はサーバーに自動転送されます。

### 5. 初回ユーザー登録

ブラウザで `http://localhost:5173` を開いても、まだユーザーがいません。
APIで初回ユーザーを登録します:

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"employee_id":"EMP001","display_name":"管理者","password":"password123"}'
```

以降はログイン画面から社員番号とパスワードでログインできます。

## テスト

### サーバーテスト（Jest）

```bash
cd server

# テスト用DB起動済みであること（docker-compose up -d）
npm test           # 全テスト実行
npm run test:watch # ウォッチモード
```

### クライアントテスト（Vitest）

```bash
cd client
npm test           # 全テスト実行
npm run test:watch # ウォッチモード
```

## ディレクトリ構成

```
linny/
├── client/                    # React PWA フロントエンド
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/          # ログイン画面
│   │   │   ├── chat/          # トーク画面（吹き出し・入力）
│   │   │   └── room-list/     # トーク一覧・ルーム作成
│   │   ├── services/          # APIクライアント・Socket.IO
│   │   └── stores/            # Zustand状態管理
│   └── __tests__/
│
├── server/                    # Node.js バックエンド
│   ├── src/
│   │   ├── routes/            # REST APIエンドポイント
│   │   ├── socket/            # Socket.IOハンドラ
│   │   ├── middleware/        # JWT認証・ファイルアップロード
│   │   ├── services/          # Push通知・サムネイル生成
│   │   └── db/                # DB接続・マイグレーション
│   └── __tests__/
│
├── media/                     # アップロードファイル保存先
├── docs/                      # 設計書
│   ├── 01_要件定義.md
│   ├── 02_DB設計.md
│   └── 03_アーキテクチャ設計.md
│
├── docker-compose.yml
└── CLAUDE.md                  # AI開発ガイドライン
```

## API一覧

| メソッド | パス | 説明 |
|----------|------|------|
| POST | /api/auth/register | ユーザー登録 |
| POST | /api/auth/login | ログイン（JWT発行） |
| GET | /api/auth/me | 現在ユーザー取得 |
| GET | /api/users | ユーザー一覧 |
| GET | /api/rooms | ルーム一覧（未読数付き） |
| POST | /api/rooms | グループ作成 |
| POST | /api/rooms/direct | 1対1ルーム作成 |
| GET | /api/rooms/:id | ルーム詳細 |
| GET | /api/rooms/:id/messages | メッセージ履歴（ページネーション） |
| POST | /api/rooms/:id/messages | メッセージ送信 |
| POST | /api/rooms/:id/media | ファイルアップロード |
| POST | /api/rooms/:id/read | 既読マーク |
| POST | /api/push/subscribe | Push通知購読登録 |
| DELETE | /api/push/subscribe | Push通知購読解除 |

## Socket.IO イベント

| イベント | 方向 | 説明 |
|----------|------|------|
| room:join | client → server | ルームに参加 |
| room:leave | client → server | ルームから退出 |
| message:send | client → server | メッセージ送信 |
| message:new | server → client | 新着メッセージ通知 |
| message:read | 双方向 | 既読通知 |

## 本番デプロイ

### Nginx設定例

```nginx
server {
    listen 80;
    server_name linny.example.com;

    # React PWA
    location / {
        root /var/linny/client/dist;
        try_files $uri $uri/ /index.html;
    }

    # REST API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # メディアファイル配信
    location /media/ {
        alias /var/linny/media/;
        expires 30d;
    }
}
```

### クライアントビルド

```bash
cd client
npm run build
# dist/ ディレクトリが生成される
```

## フェーズ計画

- **Phase 1（完了）**: MVP — チャット・メディア・既読・リプライ・メッセージ削除・音声メッセージ（Whisper文字起こし＋AI整形）・グループ管理・ユーザー管理・コンテキストメニュー・日付区切り・通知音・文字サイズ設定・PWA
- **Phase 2**: メッセージ検索、メンション、タイピング表示、オンライン/オフライン、リンクプレビュー、絵文字リアクション、アルバム、スタンプ
- **Phase 3**: AI Bot連携（MCP経由）、AIエージェント参加、音声/ビデオ通話（SFU: mediasoup）、LDAP認証

## ライセンス

MIT License
