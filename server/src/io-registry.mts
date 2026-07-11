/**
 * Socket.IO instance registry (#330 TS 移行で導入)
 *
 * routes → app は真の循環依存 (app が全 routes を組み立てる) のため、旧 CJS では
 * handler 内の lazy require('../app') で io を取得していた。ESM のローカル動的 import は
 * Jest (CJS transform) で解決できないため、依存を持たないこの registry で循環を断つ。
 * app.mts が起動時に setIo() し、routes は getIo() で参照する。
 */
import type { Server } from 'socket.io';

let ioInstance: Server | null = null;

export function setIo(io: Server): void {
  ioInstance = io;
}

export function getIo(): Server {
  if (!ioInstance) {
    throw new Error('Socket.IO instance not initialized (app.mts の setIo より前に getIo が呼ばれた)');
  }
  return ioInstance;
}
