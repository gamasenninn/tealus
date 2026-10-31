# Tealus の本体と agent-server を、ログオンしたときに立ち上げる (2026-10-31 小野さん判断 8、docs/10 §6 の 1)
#
# 使い方 (Windows / PowerShell 5.1 以上):
#   試すだけ (何も起動しない):
#     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\startup\tealus-autostart.ps1 -DryRun
#   ログオン時に走らせる (タスクスケジューラ。登録は 1 回だけ。docs/10 §6.1):
#     下の「登録」を参照
#
# 1. 本体 (3000) がもう動いていれば何もしない (2 回目のログオン・手で上げたあとに二重に上げない)
# 2. Docker の DB (tealus_postgres) が応えるまで待つ。★ ログオンしないと Docker Desktop が上がらず、DB より先に本体を上げると
#    起動時の拾い直しが空振りする (立ち上げ手順の「順番を間違えたとき」)。待っても来なければ何も上げずに終わる
# 3. Windows Terminal の窓「tealus」に、本体のタブを開いて npm start
# 4. 本体が応える (/api/config が 200) のを待ってから、agent-server のタブを開いて npm start
#    ★ 本体の webhook は 3 回試して諦めるので、agent-server は本体のすぐ後に上げる
# ★ 止め方は今までどおり: そのタブで Ctrl+C (SIGINT が届く。docs/05)
# ★ rtc-server・無線の送り込み・ptt・SP2TXT はまだ手で上げる (判断 8 は「まず本体と agent-server」)
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
  $wtArgs = @('-w', 'tealus', 'new-tab', '--title', $title, '-d', $dir, 'powershell.exe', '-NoExit', '-Command', 'npm start')
  if ($DryRun) { Write-Log ('(試すだけ) wt.exe ' + ($wtArgs -join ' ')); return }
  Start-Process -FilePath 'wt.exe' -ArgumentList $wtArgs
  Write-Log "$title のタブを開きました ($dir)"
}

Write-Log "=== 開始 (Repo=$Repo$(if ($DryRun) { ', 試すだけ' })) ==="

if (Test-Port $ServerPort) {
  Write-Log "本体 ($ServerPort) はもう動いているので、何もしません"
  Write-Log '=== 終了: 何もしない ==='
  exit 0
}

# 2. DB を待つ
$deadline = (Get-Date).AddMinutes($WaitDbMinutes)
$dbReady = $false
while ((Get-Date) -lt $deadline) {
  docker exec $Container pg_isready -q 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $dbReady = $true; break }
  Start-Sleep -Seconds 10
}
if (-not $dbReady) {
  Write-Log "★ DB ($Container) が $WaitDbMinutes 分待っても応えないので、何も上げずに終わります (Docker Desktop を確かめてから、手で上げてください)"
  Write-Log '=== 終了: 失敗 ==='
  exit 1
}
Write-Log "DB ($Container) が応えました"

# 3. 本体
Open-Tab '本体' (Join-Path $Repo 'server')

# 4. 本体が応えるのを待ってから agent-server
if (-not $DryRun) {
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
Write-Log '=== 終了: 成功 ==='
