# Tealus の本体・agent-server・rtc-server と追加の起動を、ログオンしたときに立ち上げる (2026-10-31 小野さん判断 8、docs/10 §6 の 1)
#
# 使い方 (Windows / PowerShell 5.1 以上):
#   試すだけ (何も起動しない):
#     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\startup\tealus-autostart.ps1 -DryRun
#   ログオン時に走らせる (タスクスケジューラ。登録は 1 回だけ。docs/10 §6.1):
#     下の「登録」を参照
#
# 1. 本体 (3000) がもう動いていれば本体は上げない (2 回目のログオン・手で上げたあとに二重に上げない)。
#    ★ ほかは続けて確かめる (改善ループ 51。以前はここで全部やめ、rtc-server と追加の起動が上がらなかった)
# 2. Docker の DB (tealus_postgres) が応えるまで待つ。★ ログオンしないと Docker Desktop が上がらず、DB より先に本体を上げると
#    起動時の拾い直しが空振りする (立ち上げ手順の「順番を間違えたとき」)。待っても来なければ何も上げずに終わる
# 3. Windows Terminal の窓「tealus」に、本体のタブを開いて npm start
# 4. 本体が応える (/api/config が 200) のを待ってから、agent-server のタブを開いて npm start
#    ★ 本体の webhook は 3 回試して諦めるので、agent-server は本体のすぐ後に上げる
# ★ 止め方は今までどおり: そのタブで Ctrl+C (SIGINT が届く。docs/05)
# 5. rtc-server (3100) を上げる (2026-11-13 判断。3100 がもう待ち受けていれば上げない)
# 6. ~\.tealus\startup\extras.ps1 があれば呼ぶ。会社ごとに違うもの (無線の送り込み・ptt・通話履歴など) はリポジトリの外のそこに書く
#    (docs/10 §6 の 1。11-13 01:11 の予告なしの再起動で、無線の録音が手で上げるまで 19 分止まった)
# 7. 45 秒待って、本体・agent-server・rtc-server が待ち受けているかを数え直す。欠けがあれば ★ と「終了: 欠けあり」(改善ループ 51)
# 記録: ~\.tealus\startup\logs\autostart-YYYYMMDD.log
#
# 登録 (管理者でなくてよい。ログオンした本人の権限で走る):
#   $a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File C:\app\tealus\scripts\startup\tealus-autostart.ps1'
#   $t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
#   Register-ScheduledTask -TaskPath '\Tealus\' -TaskName 'TealusAutostart' -Action $a -Trigger $t -Description 'ログオン時に Tealus の本体と agent-server を上げる'
# 外す:
#   Unregister-ScheduledTask -TaskPath '\Tealus\' -TaskName 'TealusAutostart' -Confirm:$false
#
# ★ このファイルは BOM 付き UTF-8 で保存すること (PowerShell 5.1 は BOM が無いと日本語を壊す)

param(
  [string]$Repo           = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path,
  [string]$Container      = 'tealus_postgres',
  [int]$WaitDbMinutes     = 15,
  [int]$WaitServerSeconds = 180,
  [int]$ServerPort        = 3000,
  [int]$AgentPort         = 4000,
  [int]$RtcPort           = 3100,
  [string]$Extras         = (Join-Path $env:USERPROFILE '.tealus\startup\extras.ps1'),
  [switch]$DryRun
)

$logDir = Join-Path $env:USERPROFILE '.tealus\startup\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ('autostart-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))
function Write-Log([string]$msg) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $log -Value $line -Encoding UTF8
  Write-Output $line
}
function Test-Port([int]$port) {
  return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}
function Open-Tab([string]$title, [string]$dir) {
  # ★ 題と場所は "" で囲む (改善ループ 51)。PowerShell 5.1 の Start-Process は配列の要素を囲まずに空白でつなぐので、
  #   題に空白があると (例「VOX 録音」) wt が後ろ半分をコマンドと読み、起動エラーのタブになっていた
  $wtArgs = @('-w', 'tealus', 'new-tab', '--title', "`"$title`"", '-d', "`"$dir`"", 'powershell.exe', '-NoExit', '-Command', 'npm start')
  if ($DryRun) { Write-Log ('(試すだけ) wt.exe ' + ($wtArgs -join ' ')); return }
  Start-Process -FilePath 'wt.exe' -ArgumentList $wtArgs
  Write-Log "$title のタブを開きました ($dir)"
}

Write-Log "=== 開始 (Repo=$Repo$(if ($DryRun) { ', 試すだけ' })) ==="

function Invoke-Extras {
  if (Test-Path $Extras) {
    Write-Log "追加の起動 ($Extras) を呼びます"
    try { & $Extras -DryRun:$DryRun -Logger ${function:Write-Log} } catch { Write-Log "★ 追加の起動に失敗: $($_.Exception.Message)" }
  }
}

# ★ 本体がもう動いていても、ほかは確かめて上げる (改善ループ 51)。以前はここで全部やめていたので、
#   本体だけ手で上げた後や、追加の起動がこけた後にタスクを走らせ直しても、rtc-server も追加の起動も上がらなかった。
#   agent-server・rtc-server・追加の起動は、それぞれ自分で二重起動をよける
$serverWasUp = Test-Port $ServerPort
if ($serverWasUp) {
  Write-Log "本体 ($ServerPort) はもう動いているので、本体は上げません (ほかは確かめます)"
} else {
  # 2. DB を待つ
  $deadline = (Get-Date).AddMinutes($WaitDbMinutes)
  $dbReady = $false
  while ((Get-Date) -lt $deadline) {
    docker exec $Container pg_isready -q 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
    Start-Sleep -Seconds 10
  }
  if (-not $dbReady) {
    Write-Log "★ DB ($Container) が $WaitDbMinutes 分待っても応えないので、本体・agent-server・rtc-server は上げません (Docker Desktop を確かめてから、手で上げてください)"
    # ★ 追加の起動 (録音など) は DB も本体も要らないものがあるので、それだけは上げる (改善ループ 51)。
    #   以前は DB がこけると録音まで道連れで上がらなかった
    Invoke-Extras
    Write-Log '=== 終了: 失敗 ==='
    exit 1
  }
  Write-Log "DB ($Container) が応えました"

  # 3. 本体。★ DB を待っている間に手で上げられていたら上げない (改善ループ 51。待ちは最長 15 分ある)
  if (Test-Port $ServerPort) {
    Write-Log "本体 ($ServerPort) は待っている間に上がったので、上げません"
    $serverWasUp = $true
  } else {
    Open-Tab '本体' (Join-Path $Repo 'server')
  }
}

# 4. 本体が応えるのを待ってから agent-server
if (-not $DryRun -and -not $serverWasUp) {
  $deadline = (Get-Date).AddSeconds($WaitServerSeconds)
  $up = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "http://localhost:$ServerPort/api/config" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
  }
  if (-not $up) { Write-Log "★ 本体が $WaitServerSeconds 秒で応えませんでした。agent-server も上げます (本体を試し直しながら待つ作りなので)" }
  else { Write-Log '本体が応えました (/api/config 200)' }
}
if (Test-Port $AgentPort) {
  Write-Log "agent-server ($AgentPort) はもう動いているので、上げません"
} else {
  Open-Tab 'agent-server' (Join-Path $Repo 'agent-server')
}

# 5. rtc-server (通話・トランシーバー)。★ ネットにつながってから上げる (公開 IP を起動時に引く)。ここまで来ればつながっている
if (Test-Port $RtcPort) {
  Write-Log "rtc-server ($RtcPort) はもう動いているので、上げません"
} elseif (Test-Path (Join-Path $Repo 'rtc-server')) {
  Open-Tab 'rtc-server' (Join-Path $Repo 'rtc-server')
}

# 6. 会社ごとに違う常駐 (リポジトリの外)。無ければ何もしない。失敗しても本体側の起動は済んでいる
Invoke-Extras

# 7. ★ 上がったかを数え直す (改善ループ 51)。以前はタブを開いただけで「成功」と書き、上がらなくても誰も気づけなかった
if ($DryRun) { Write-Log '=== 終了: 試すだけ ==='; exit 0 }
Start-Sleep -Seconds 45
$missing = @()
foreach ($p in @(@{ Name = '本体'; Port = $ServerPort }, @{ Name = 'agent-server'; Port = $AgentPort }, @{ Name = 'rtc-server'; Port = $RtcPort })) {
  if ($p.Name -eq 'rtc-server' -and -not (Test-Path (Join-Path $Repo 'rtc-server'))) { continue }
  if (-not (Test-Port $p.Port)) { $missing += "$($p.Name) ($($p.Port))" }
}
if ($missing.Count) {
  Write-Log "★ 待ち受けていないもの: $($missing -join '、') (タブを開いて、エラーを確かめてください)"
  Write-Log '=== 終了: 欠けあり ==='
  exit 1
}
Write-Log '本体・agent-server・rtc-server が待ち受けています'
Write-Log '=== 終了: 成功 ==='
