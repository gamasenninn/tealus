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

function cancel(roomId) {
  const proc = runningProcesses.get(roomId);
  if (!proc) return { success: true, was_running: false };
  const pid = proc.pid;
  // close handler / timeout handler が cancel と知らずに redundant message を出さないよう
  // flag を立てて timer を clear する。
  proc._tealusCancelled = true;
  if (proc._tealusTimer) {
    clearTimeout(proc._tealusTimer);
    proc._tealusTimer = null;
  }
  try {
    proc.kill('SIGTERM');
    if (process.platform === 'win32' && pid) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { shell: true });
    }
    logger.info(`[DeepRegistry] cancelled room=${roomId} pid=${pid}`);
  } catch (err) {
    logger.warn(`[DeepRegistry] cancel error room=${roomId}: ${err.message}`);
  }
  runningProcesses.delete(roomId);
  return { success: true, was_running: true, pid };
}

module.exports = { register, unregister, isRunning, cancel };
