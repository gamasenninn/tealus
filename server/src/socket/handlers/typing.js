/**
 * Handle typing:start and typing:stop events
 */
function registerTypingHandler(socket) {
  socket.on('typing:start', (room_id) => {
    socket.to(room_id).emit('typing:start', {
      room_id,
      user_id: socket.user.id,
      display_name: socket.user.display_name,
    });
  });

  socket.on('typing:stop', (room_id) => {
    socket.to(room_id).emit('typing:stop', {
      room_id,
      user_id: socket.user.id,
    });
  });
}

module.exports = { registerTypingHandler };
