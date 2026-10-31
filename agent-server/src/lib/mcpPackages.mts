/**
 * ★ #577 起動のたびに npx でダウンロードする MCP の道具の版。ここ 1 か所で固定する。
 *
 * ★ 版を書かないと「その時に registry が返すもの」が動く。2026-10-11 に server-filesystem の上流が
 *   新しい major (1.0.0) を出し、手元 (キャッシュの 2026.1.14) と新しいマシン・Docker で違う版が動く状態になった。
 * ★ 上げるときは、先に手で 1 回 `npx -y <名前@版> --help` を流してキャッシュに入れる
 *   (初回のダウンロードが MCP の接続待ちを越えると、その回の道具が繋がらない)。
 */
export const FILESYSTEM_MCP_PACKAGE = '@modelcontextprotocol/server-filesystem@2026.1.14';

/**
 * tealus-mcp (別 repo) の版。Light v2・Deep・ルームごとの MCP の 3 か所がここを使う。
 * ★ 2026-10-15 に v0.14.7 → v0.16.0。v0.14.7 のままだと send_form (v0.14.8) と edit_message (v0.15.0) が
 *   エージェントから見えなかった (docs は「18 個」と書いていたが、本体では一度も成り立っていなかった)
 * ★ 上げるときは tealus-mcp の CHANGELOG を読み、先に手で 1 回 `npx -y <これ> ` を流してキャッシュに入れる (上と同じ理由)
 */
export const TEALUS_MCP_PACKAGE = 'github:gamasenninn/tealus-mcp#v0.16.1';
