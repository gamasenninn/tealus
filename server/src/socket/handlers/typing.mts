import type { Socket } from 'socket.io';

/**
 * Handle typing:start and typing:stop events
 */
export function registerTypingHandler(socket: Socket): void {
  // ★ 自分がいま入っている部屋にだけ流す (room:join はメンバーだけが入れる。外されたら抜ける)
  socket.on('typing:start', (room_id: unknown) => {
    if (typeof room_id !== 'string' || !socket.rooms.has(room_id)) return;
    socket.to(room_id).emit('typing:start', {
      room_id,
      user_id: socket.user.id,
      display_name: socket.user.display_name,
    });
  });

  socket.on('typing:stop', (room_id: unknown) => {
    if (typeof room_id !== 'string' || !socket.rooms.has(room_id)) return;
    socket.to(room_id).emit('typing:stop', {
      room_id,
      user_id: socket.user.id,
    });
  });
}
