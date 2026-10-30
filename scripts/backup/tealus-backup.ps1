# Tealus の定期バックアップ (2026-09-28 作成。#595 で repo に入れ、置き先などを引数にした)
#
# 使い方 (Windows / PowerShell 5.1 以上。本番は毎日 3:00 にタスクスケジューラから呼ぶ):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\backup\tealus-backup.ps1 -Dest \\nas\share\tealus-bak
#   ★ 置き先はドライブ文字 (S: など) でなく UNC で書く。タスクスケジューラからはドライブ文字が見えないことがある
#
# 1. DB   : 毎回まるごと (pg_dump -Fc)。表の数を確かめてから置く。新しい方から -Keep 本を残す
#           ★ PowerShell 5.1 の > は文字コードを変えて dump を壊すので、コンテナの中で書いてから docker cp で出す
# 2. メディア: robocopy /E で新しい・変わったファイルだけを足す。★ 元で消えたものはバックアップでは消さない
#           (うっかり消したものも戻せるように。溜まり続けるので、容量は時々見る)
# 3. 鍵と設定: .env (鍵)・.gitignore で外している会社の設定を <置き先>\secrets\<日時>\ へ写す。-Keep 世代を残す
#           ★ 暗号化はしない。置き場に誰が入れるかに注意
#           ★ 無いファイルは記録して飛ばす (失敗にしない)。写すのに失敗したら失敗にする
#           ★ gitignore で外す設定を増やしたら、下の $Secrets にも足すこと (2026-10-13 に watchdogs.json が漏れていた)
# 4. 記録 : <置き先>\logs\backup-YYYYMMDD.log。失敗したら終了コード 1
#           ★★ 最後の行の「=== 終了: 成功 ===」は**約束**。本体の見張り (docs/09) と doctor が
#              server/src/services/backupLog.mts でこの文字列を読む。変えるならそちらも直す
#
# ★ このファイルは BOM 付き UTF-8 で保存すること (PowerShell 5.1 は BOM が無いと日本語を壊す)

param(
  [Parameter(Mandatory = $true)][string]$Dest,
  [string]$Repo      = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Container = 'tealus_postgres',
  [string]$DbUser    = 'tealus',
  [string]$DbName    = 'tealus',
  [int]$Keep         = 14,
  [int]$MinTables    = 20
)

$ErrorActionPreference = 'Stop'
$EnvFile = Join-Path $Repo 'server\.env'

$Stamp = Get-Date -Format 'yyyyMMdd-HHmm'
foreach ($d in 'db', 'media', 'logs', 'secrets') { New-Item -ItemType Directory -Force (Join-Path $Dest $d) | Out-Null }
$Log = Join-Path $Dest ("logs\backup-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
function Write-Log([string]$m) { Add-Content -Path $Log -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) -Encoding UTF8 }

$ok = $true
Write-Log "=== 開始 ==="

# ---- 1. DB ----------------------------------------------------------------------
try {
  $inner = "/tmp/tealus-$Stamp.dump"
  $local = Join-Path $env:TEMP "tealus-$Stamp.dump"
  docker exec $Container pg_dump -U $DbUser -Fc -f $inner $DbName
  if ($LASTEXITCODE -ne 0) { throw "pg_dump 失敗 (exit $LASTEXITCODE)" }
  $tables = (docker exec $Container pg_restore --list $inner | Select-String 'TABLE DATA').Count
  if ($tables -lt $MinTables) { throw "dump の表が少ない ($tables < $MinTables)" }
  docker cp "${Container}:$inner" $local | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker cp 失敗 (exit $LASTEXITCODE)" }
  docker exec $Container rm -f $inner | Out-Null
  $size = (Get-Item $local).Length
  Move-Item $local (Join-Path $Dest "db\tealus-$Stamp.dump") -Force
  Write-Log ("DB ok: tealus-{0}.dump {1:N1} MB, 表 {2}" -f $Stamp, ($size / 1MB), $tables)
  $old = Get-ChildItem (Join-Path $Dest 'db') -Filter 'tealus-*.dump' | Sort-Object Name -Descending | Select-Object -Skip $Keep
  foreach ($f in $old) { Remove-Item $f.FullName -Force; Write-Log "DB 古いものを消した: $($f.Name)" }
} catch {
  $ok = $false; Write-Log "DB 失敗: $($_.Exception.Message)"
}

# ---- 2. メディア --------------------------------------------------------------------
try {
  $mediaLine = Select-String -Path $EnvFile -Pattern '^MEDIA_ROOT=' | Select-Object -First 1
  if (-not $mediaLine) { throw "MEDIA_ROOT が $EnvFile に無い" }
  $media = ($mediaLine.Line -split '=', 2)[1].Trim().Trim('"')
  if (-not (Test-Path $media)) { throw "MEDIA_ROOT が見つからない: $media" }
  $rlog = Join-Path $Dest ("logs\robocopy-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
  robocopy $media (Join-Path $Dest 'media') /E /FFT /R:2 /W:5 /NP /NDL /NFL "/LOG+:$rlog" | Out-Null
  $rc = $LASTEXITCODE
  if ($rc -ge 8) { throw "robocopy 失敗 (exit $rc、詳細は $rlog)" }
  Write-Log "メディア ok: robocopy exit $rc (0=変化なし 1=コピーあり。8 以上が失敗)"
} catch {
  $ok = $false; Write-Log "メディア失敗: $($_.Exception.Message)"
}

# ---- 3. 鍵と設定 ------------------------------------------------------------------
try {
  $Secrets = @(
    'server\.env', 'agent-server\.env', 'agent-server\mcp_config.json', 'agent-server\config\system_prompt.md', 'agent-server\config\settings.json',
    'server\config\room-triggers.json', 'server\config\watchdogs.json',
    'server\config\line-groups.json', 'server\config\line-group-mappings.json',
    'server\config\line-members.json', 'server\config\mining_report.json', 'server\config\dictionary.local.ttl'
  )
  $Secrets += Get-ChildItem (Join-Path $Repo 'server\config') -Filter 'transcription_guideline*.json' -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'transcription_guideline.example.json' } | ForEach-Object { "server\config\$($_.Name)" }
  $sdir = Join-Path $Dest "secrets\$Stamp"
  $copied = 0; $missing = @()
  foreach ($rel in $Secrets) {
    $src = Join-Path $Repo $rel
    if (-not (Test-Path $src)) { $missing += $rel; continue }
    $dst = Join-Path $sdir $rel
    New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null
    Copy-Item $src $dst -Force
    $copied++
  }
  if ($copied -eq 0) { throw "写せたファイルが 0 本" }
  Write-Log ("鍵と設定 ok: {0} 本 → secrets\{1}{2}" -f $copied, $Stamp, $(if ($missing.Count) { " (無いので飛ばした: $($missing -join ', '))" } else { '' }))

  # ★ 部屋ごとの AI の設定 (プロンプト・CLAUDE.md・声・道具) を丸ごと写す (2026-10-30 小野さん判断 1)。
  #   置き場は repo の外 (<AGENT_WORKSPACE_ROOT>\_room-configs) で、以前はどこにも写していなかった。
  #   ★ 道具の設定に資格情報が入りうるので secrets と同じ世代に置く
  $agentEnv = Join-Path $Repo 'agent-server\.env'
  $wsLine = Select-String -Path $agentEnv -Pattern '^AGENT_WORKSPACE_ROOT=' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($wsLine) {
    $roomCfg = Join-Path (($wsLine.Line -split '=', 2)[1].Trim().Trim('"')) '_room-configs'
    if (Test-Path $roomCfg) {
      Copy-Item $roomCfg (Join-Path $sdir '_room-configs') -Recurse -Force
      $n = (Get-ChildItem (Join-Path $sdir '_room-configs') -Recurse -File).Count
      Write-Log ("部屋の AI 設定 ok: {0} 本 → secrets\{1}\_room-configs" -f $n, $Stamp)
    } else { Write-Log "部屋の AI 設定: 置き場が無いので飛ばした ($roomCfg)" }
  } else { Write-Log "部屋の AI 設定: agent-server\.env に AGENT_WORKSPACE_ROOT が無いので飛ばした" }
  $oldS = Get-ChildItem (Join-Path $Dest 'secrets') -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep
  foreach ($d in $oldS) { Remove-Item $d.FullName -Recurse -Force; Write-Log "鍵と設定 古いものを消した: $($d.Name)" }
} catch {
  $ok = $false; Write-Log "鍵と設定 失敗: $($_.Exception.Message)"
}

Write-Log ("=== 終了: {0} ===" -f $(if ($ok) { '成功' } else { '★ 失敗あり' }))
if (-not $ok) { exit 1 }
# ★ 成功も明示する。書かないと最後に動いた robocopy の終了コード (1 = コピーあり) が残り、
#   呼んだ側 (殻の `exit $LASTEXITCODE`・タスクスケジューラ) には失敗に見える (2026-10-13 の試走で実際にそうなった)
exit 0
