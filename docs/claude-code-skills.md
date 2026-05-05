# Claude Code Skill 設定ガイド

このプロジェクトで Claude Code の **custom skill** (`/<name>` slash command) を作成・管理するための reference。

> **TL;DR**: `.claude/skills/<name>.md` (flat file) では **読み込まれない**。
> `.claude/skills/<name>/SKILL.md` (ディレクトリ + SKILL.md) が必須。

## 背景 (この doc が存在する理由)

2026-05-05 までの 1 ヶ月、`.claude/skills/listen-tealus.md` を flat file で配置していたが `/listen-tealus` slash command として **一度も認識されなかった**。Claude session ごとに skill 内容を Read して手動で procedure 実行する状態が続いていた。

公式仕様 (code.claude.com/docs/en/skills.md) を確認して原因判明 → ディレクトリ構造に修正 (commit `fe2f0b6`) → 即動作。

## 仕様

### 配置

```
.claude/skills/
└── <skill-name>/
    └── SKILL.md          # 必須 entry point
    └── (任意の補助ファイル)
        ├── CONFIG_SCHEMA.md
        └── EXAMPLES.md
```

| ❌ 動かない | ✅ 動く |
|---|---|
| `.claude/skills/foo.md` | `.claude/skills/foo/SKILL.md` |
| `.claude/commands/foo.md` (deprecated) | `.claude/skills/foo/SKILL.md` |

### Frontmatter

```yaml
---
name: <skill-name>
description: <1-2 行の skill 概要、available skills list に表示される>
disable-model-invocation: true   # optional
---

# <skill-name>

(skill 本文 — 手順 / 参照 / 注意事項など)
```

| field | 必須 | 用途 |
|---|---|---|
| `name` | optional | 省略時 dirname から推定。明示推奨 |
| `description` | optional | 省略時 `# h1` または最初の段落から推定。available skills list に表示されるので明示推奨 |
| `disable-model-invocation` | optional (default false) | `true` で Claude の自動 invoke を防ぎ、`/<name>` 経由のみに限定。Monitor を arm する系など deterministic 実行が必要な skill に推奨 |

### scope (project-level vs user-level)

- **project-level**: `.claude/skills/<name>/SKILL.md` (repo 内、git 管理)
- **user-level**: `~/.claude/skills/<name>/SKILL.md` (個人 PC、複数 project 横断)

両方に同名 skill があると available list に **重複表示** される。project-specific (config file 依存等) は **project-level に統一推奨**、user-level は別 project でも使う汎用 skill のみ。

### Discovery 動作

- file edit (frontmatter / 本文) → session 内で **即時反映** (Claude Code restart 不要)
- 新規 dir 作成 → 通常は restart 不要、available skills list に即時 surface するケースが多い
- 一部 ext / file 変更で reload されないケースは **Claude Code restart で確実に反映**

### `.claude/commands/` との関係

- 旧 `.claude/commands/<name>.md` (flat) は deprecated
- 新 `.claude/skills/<name>/SKILL.md` (dir) に統合
- 両方ある場合 skills が優先

## このプロジェクトの skill

| skill | 配置 | 用途 |
|---|---|---|
| `listen-tealus` | `.claude/skills/listen-tealus/SKILL.md` | Tealus cc-queue jsonl を Monitor で待機、`@cc-{project}` mention に auto-reply |

詳細は各 SKILL.md を参照。

## 新 skill を作る時の checklist

1. [ ] `.claude/skills/<name>/` ディレクトリ作成
2. [ ] `SKILL.md` 作成 (frontmatter `name` + `description`、本文に手順)
3. [ ] auto-invoke を防ぎたい場合 `disable-model-invocation: true` を追加
4. [ ] (optional) 補助ファイル (`CONFIG_SCHEMA.md` 等) を同 dir に
5. [ ] available skills list に出現するか確認 (Claude session で確認)
6. [ ] `/<name>` slash command で実行確認
7. [ ] git commit (project-level の場合)

## トラブルシューティング

### `Unknown command: /<name>` / `Unknown skill: <name>` エラー

1. ディレクトリ構造 (`<name>/SKILL.md`) を確認
2. frontmatter の `---` syntax を確認 (上下に `---` 必要、indentation 不可)
3. Claude Code を restart して再 discovery を強制
4. 同名の duplicate (project + user) がないか確認

### available skills list に description が表示されない

- frontmatter の `description` field が無い → 省略時は `# h1` か最初の段落から自動推定されるが、明示推奨

## 関連

- 本 doc 起点 issue / commit: [`fe2f0b6`](https://github.com/gamasenninn/tealus/commit/fe2f0b6) `.claude/skills/listen-tealus: flat .md → dir/SKILL.md 修正`
- Claude Code 公式 skill 仕様: https://code.claude.com/docs/en/skills.md
- Tealus cc-tealus bridge: [docs/setup-cc-tealus-bridge.md](setup-cc-tealus-bridge.md)
