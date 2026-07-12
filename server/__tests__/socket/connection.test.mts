import { createServer, type Server as HttpServer } from 'node:http';
import { Server, type Socket as ServerSocket } from 'socket.io';
import { io as Client, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';

describe('Socket.IO Connection', () => {
  let io: Server, serverSocket: ServerSocket, clientSocket: ClientSocket, httpServer: HttpServer;

  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      const port = (httpServer.address() as AddressInfo).port;
      clientSocket = Client(`http://localhost:${port}`);
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
