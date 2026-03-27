const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');

describe('Socket.IO Connection', () => {
  let io, serverSocket, clientSocket, httpServer;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = new Client(`http://localhost:${port}`);
      io.on('connection', (socket) => {
        serverSocket = socket;
      });
      clientSocket.on('connect', done);
    });
  });

  afterAll(() => {
    io.close();
    clientSocket.close();
    httpServer.close();
  });

  it('should connect successfully', () => {
    expect(clientSocket.connected).toBe(true);
  });

  it('should have a socket id', () => {
    expect(clientSocket.id).toBeDefined();
  });
});
