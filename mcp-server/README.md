# mcp-server is moved

このパッケージ (`tealus-mcp`) は **独立 repo に分離** されました。
最新の実装は以下を参照してください:

**👉 https://github.com/gamasenninn/tealus-mcp**

## 利用方法 (MCP クライアント設定)

```json
{
  "mcpServers": {
    "tealus": {
      "command": "npx",
      "args": ["-y", "github:gamasenninn/tealus-mcp"],
      "env": {
        "TEALUS_API_URL": "https://your-tealus.example.com",
        "TEALUS_USER_ID": "bot-user-id",
        "TEALUS_PASSWORD": "bot-password"
      }
    }
  }
}
```

clone 不要、`npx -y github:gamasenninn/tealus-mcp` で GitHub から直接取得して起動します。

## 移転の経緯

- 元: `gamasenninn/tealus` monorepo の `mcp-server/` ディレクトリ
- 新: `gamasenninn/tealus-mcp` 独立 repo (v0.1.0 から)
- 理由: MCP クライアント側 (Claude Code / Cursor 等) からの zero-config install ([#187](https://github.com/gamasenninn/tealus/issues/187))
- npm registry には publish しない方針 (GitHub 直接 install で十分かつ 2FA 等の障壁を回避)
