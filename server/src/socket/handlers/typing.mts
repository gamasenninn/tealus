import type { Socket } from 'socket.io';

/**
 * Handle typing:start and typing:stop events
 */
export function registerTypingHandler(socket: Socket): void {
  socket.on('typing:start', (room_id: string) => {
    socket.to(room_id).emit('typing:start', {
      room_id,
      user_id: socket.user.id,
      display_name: socket.user.display_name,
    });
  });

  socket.on('typing:stop', (room_id: string) => {
    socket.to(room_id).emit('typing:stop', {
      room_id,
      user_id: socket.user.id,
    });
  });
}
