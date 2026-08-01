import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

export let io: Server;

// In-memory map of userId -> Set of socket IDs
const userSockets = new Map<string, Set<string>>();

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: [
        'http://localhost:3000',
        'http://localhost:3001',
        process.env.FRONTEND_URL || '',
      ].filter(Boolean),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    // Accept userId from query param (simple, no auth for now)
    const userId = socket.handshake.query.userId as string;

    if (!userId) {
      console.warn('[Socket] Connection without userId, disconnecting');
      socket.disconnect(true);
      return;
    }

    // Join a room by userId
    socket.join(userId);

    // Track connected sockets
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);

    console.log(`[Socket] Connected: ${socket.id} | userId: ${userId}`);

    socket.on('disconnect', () => {
      const sids = userSockets.get(userId);
      if (sids) {
        sids.delete(socket.id);
        if (sids.size === 0) userSockets.delete(userId);
      }
      console.log(`[Socket] Disconnected: ${socket.id} | userId: ${userId}`);
    });
  });

  console.log('[Socket] Socket.io initialized');
}

/**
 * Emit an event to all sockets of a specific user
 */
export function emitToUser(userId: string, event: string, data: any) {
  if (!io) return;
  io.to(userId).emit(event, data);
}
