/**
 * Deep agent process registry — in-memory Map<roomId, ChildProcess>
 *
 * agent-server restart で消失するが、その時点で全 child process も
 * 共に終了するため registry/process の整合は保たれる。
 */
const { spawn } = require('child_process');
const logger = require('../lib/logger');

const runningProcesses = new Map();

function register(roomId, proc) {
  runningProcesses.set(roomId, proc);
  logger.debug(`[DeepRegistry] register room=${roomId} pid=${proc.pid} (total: ${runningProcesses.size})`);
}

function unregister(roomId) {
  if (runningProcesses.delete(roomId)) {
    logger.debug(`[DeepRegistry] unregister room=${roomId} (total: ${runningProcesses.size})`);
  }
}

function isRunning(roomId) {
  return runningProcesses.has(roomId);
}

/**
 * Windows で workspace path を CommandLine に含む process を全 kill する。
 *
 * 背景: spawn(claude.cmd, { shell: true }) で起動した process tree は:
 *   cmd.exe (Node の proc.pid) → claude.cmd → claude.exe → MCP children
 * cmd.exe / claude.cmd は短命で、taskkill /T /F /pid <cmd.exe> 時には
 * 既に exit 済の事が多い。その瞬間 claude.exe は System に reparent され
 * /T の tree walk から外れるため、結果として workload を続行する。
 *
 * workspace path は room-unique かつ claude.exe の --mcp-config 引数に
 * 含まれるため、CommandLine LIKE で確実に sweep できる。
 */
function sweepByWorkspacePath(workspacePath, roomId) {
  if (process.platform !== 'win32' || !workspacePath) return;
  // WQL LIKE escape:
  //   '  → ''  (SQL string escape)
  //   \  → \\  (default escape char in LIKE)
  //   [, _, %  → bracket char class (literal match)
  // Name filter で claude.exe / cmd.exe に限定 — sweep を実行する powershell.exe 自身は
  // workspace path を含んでも別 Name なので self-kill しない
  const safe = workspacePath
    .replace(/'/g, "''")
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '[[]')
    .replace(/_/g, '[_]')
    .replace(/%/g, '[%]');
  const filter = `(Name='claude.exe' OR Name='cmd.exe') AND CommandLine LIKE '%${safe}%'`;
  const script = `Get-CimInstance Win32_Process -Filter "${filter}" -ErrorAction SilentlyContinue | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }`;
  try {
    const sweep = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: 'ignore',
      windowsHide: true,
    });
    sweep.unref();
    logger.info(`[DeepRegistry] sweep launched: room=${roomId} workspace=${workspacePath}`);
  } catch (err) {
    logger.warn(`[DeepRegistry] sweep error room=${roomId}: ${err.message}`);
  }
}

function cancel(roomId) {
  const proc = runningProcesses.get(roomId);
  if (!proc) return { success: true, was_running: false };
  const pid = proc.pid;
  const workspacePath = proc._tealusWorkspacePath;
  // close handler / timeout handler が cancel と知らずに redundant message を出さないよう
  // flag を立てて timer を clear する。
  proc._tealusCancelled = true;
  if (proc._tealusTimer) {
    clearTimeout(proc._tealusTimer);
    proc._tealusTimer = null;
  }
  try {
    proc.kill('SIGTERM');
    if (process.platform === 'win32') {
      if (pid) {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
      }
      // 親 cmd.exe が既に exit していて /T で届かない claude.exe / MCP 子 process を
      // workspace path 一致で sweep kill (室 unique なので他 room に影響なし)
      sweepByWorkspacePath(workspacePath, roomId);
    }
    logger.info(`[DeepRegistry] cancelled room=${roomId} pid=${pid} workspace=${workspacePath || '?'}`);
  } catch (err) {
    logger.warn(`[DeepRegistry] cancel error room=${roomId}: ${err.message}`);
  }
  runningProcesses.delete(roomId);
  return { success: true, was_running: true, pid };
}

module.exports = { register, unregister, isRunning, cancel, sweepByWorkspacePath };
