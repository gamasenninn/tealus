# 配達役 (docs/12) を、この機械の起動時に起こす。何度走らせても同じ形になる (起きているものには触らない)
#
#   1. herdr のサーバ (画面なし) が居なければ起こす
#   2. この機械の起動の表 (~/.tealus/herdr-agents.json) にある Claude が居なければ起こす
#      ★ 配達役 (bridges.json) とは別のファイル。エージェントを起こすのは配達役でなく、この機械の自前の起動 (docs/12 §9)
#        形: [{ "agent": "lp", "label": "lp", "cwd": "C:/app/tealus-site", "resume": "<会話の id>" }]
#      - workspace は herdr が自分で戻す (label で探す)。無ければ作る
#      - ★ herdr はサーバを起こし直しても Claude までは戻さない (2026-11-19 に試し用のセッションで確かめた)
#      - `resume` (会話の id) を書いた班は同じ会話の続きで起こす
#   3. 配達役が居なければ起こす (居るかどうかは ~/.tealus/courier/lock-*.json の pid で見る)
#
# ★ プロセスは番号 (PID) でしか見ない・止めない。コマンドラインの一部一致で探すと agent-server まで巻き込む (2026-11-19)
# ★ 秘密はここに書かない (auth.json は ~/.tealus/courier/ にある)
#
# 使い方: powershell -NoProfile -ExecutionPolicy Bypass -File C:\app\tealus\courier\scripts\start.ps1

$ErrorActionPreference = 'Continue'   # ★ 'Stop' だと herdr が stderr に書いた時点で止まる (PowerShell 5.1)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8   # ★ herdr の出力は UTF-8。既定 (cp932) で読むと日本語の題名で JSON が壊れ、居る Claude を「居ない」と見る
$CourierDir = Join-Path $env:USERPROFILE '.tealus\courier'
$Herdr = if ($env:HERDR_BIN) { $env:HERDR_BIN } else { Join-Path $env:USERPROFILE '.herdr-test\bin\herdr.exe' }
$RepoCourier = Split-Path -Parent $PSScriptRoot
$Log = Join-Path $CourierDir 'start.log'

function Say([string]$msg) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') [start] $msg"
  Write-Output $line
  Add-Content -Path $Log -Value $line -Encoding utf8
}

function HerdrJson([string[]]$a) {
  $out = & $Herdr @a 2>$null | Out-String   # ★ stderr を混ぜると JSON が読めない
  try { return $out | ConvertFrom-Json } catch { return $null }
}

# --- 1. herdr のサーバ ---
$st = & $Herdr status server 2>&1 | Out-String
if ($st -notmatch '(?m)^\s*status:\s*running') {
  Start-Process -FilePath $Herdr -ArgumentList 'server' -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $CourierDir 'herdr-server.log') -RedirectStandardError (Join-Path $CourierDir 'herdr-server.err.log') | Out-Null
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    if ((& $Herdr status server 2>&1 | Out-String) -match '(?m)^\s*status:\s*running') { $ok = $true; break }
  }
  if (-not $ok) { Say 'herdr のサーバが起きません。ここで止まります'; exit 1 }
  Say 'herdr のサーバを起こしました'
} else {
  Say 'herdr のサーバは起きています'
}

# --- 2. 届け先の Claude ---
$table = Join-Path $env:USERPROFILE '.tealus\herdr-agents.json'
$agents = if (Test-Path $table) { Get-Content $table -Raw -Encoding utf8 | ConvertFrom-Json } else { @() }
foreach ($b in $agents) {
  if (-not $b.cwd -or -not $b.label) { continue }
  if ($b.label -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { Say "$($b.agent): workspace の名前の形が違うので飛ばします"; continue }
  if ($b.agent -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { Say "$($b.label): 届け先の名前の形が違うので飛ばします"; continue }
  if ($b.resume -and $b.resume -notmatch '^[0-9a-f-]{36}$') { Say "$($b.label): 会話の id の形が違うので飛ばします"; continue }

  $got = HerdrJson @('agent', 'get', $b.agent)
  if ($got -and $got.result.agent) { Say "$($b.label): Claude ($($b.agent)) は居ます ($($got.result.agent.agent_status))"; continue }

  $ws = (HerdrJson @('workspace', 'list')).result.workspaces | Where-Object { $_.label -eq $b.label } | Select-Object -First 1
  if (-not $ws) {
    $created = HerdrJson @('workspace', 'create', '--cwd', $b.cwd, '--label', $b.label, '--no-focus')
    $pane = $created.result.root_pane.pane_id
    Say "$($b.label): workspace を作りました ($pane)"
  } else {
    $pane = "$($ws.workspace_id):p1"
    Say "$($b.label): herdr が戻した workspace を使います ($pane)"
  }
  if (-not $pane) { Say "$($b.label): ペインが分からないので飛ばします"; continue }

  $args2 = @('agent', 'start', $b.agent, '--kind', 'claude', '--pane', $pane)
  if ($b.resume) { $args2 += @('--', '--resume', $b.resume) }
  $started = $null
  for ($i = 0; $i -lt 10; $i++) {   # ペインのシェルが入力を待つまで少し掛かる
    $started = HerdrJson $args2
    if ($started -and $started.result.agent) { break }
    Start-Sleep -Seconds 2
  }
  if ($started -and $started.result.agent) { Say "$($b.label): Claude ($($b.agent)) を起こしました$(if ($b.resume) { ' (同じ会話の続き)' })" }
  else { Say "$($b.label): Claude を起こせませんでした" }
}

# --- 3. 配達役 ---
$alive = $false
foreach ($f in Get-ChildItem -Path $CourierDir -Filter 'lock-*.json' -ErrorAction SilentlyContinue) {
  try {
    $lockPid = (Get-Content $f.FullName -Raw | ConvertFrom-Json).pid
    if ($lockPid -and (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) { $alive = $true; Say "配達役は起きています (pid $lockPid)"; break }
  } catch { }
}
if (-not $alive) {
  # ★ 起こすたびに courier.log を上書きしていたので、前の記録を日時つきの名前に移してから起こす (2026-11-20 改善ループ 93)。
  #   止まった理由はたいてい前の記録の末尾にある。14 日より古い控えは消す
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  foreach ($n in @('courier.log', 'courier.err.log')) {
    $src = Join-Path $CourierDir $n
    if ((Test-Path $src) -and (Get-Item $src).Length -gt 0) {
      Move-Item -Path $src -Destination (Join-Path $CourierDir ($n -replace '\.log$', "-$stamp.log")) -Force
    }
  }
  Get-ChildItem -Path $CourierDir -Filter 'courier*-????????-??????.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force -ErrorAction SilentlyContinue
  $env:HERDR_BIN = $Herdr
  $p = Start-Process -FilePath 'node' -ArgumentList 'src/index.mts' -WorkingDirectory $RepoCourier -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $CourierDir 'courier.log') -RedirectStandardError (Join-Path $CourierDir 'courier.err.log')
  Say "配達役を起こしました (pid $($p.Id))"
}
