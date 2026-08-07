import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';
import { telemetryEmitter } from './mqtt';

let io: Server;

export function initSocket(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // Allow all origins for the MVP
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`🔌 WebSocket client connected: ${socket.id}`);

    // Optional: Allow clients to subscribe to specific drone feeds
    socket.on('subscribe_drone', (droneId: string) => {
      socket.join(`drone:${droneId}`);
      console.log(`Client ${socket.id} subscribed to room: drone:${droneId}`);
    });

    socket.on('unsubscribe_drone', (droneId: string) => {
      socket.leave(`drone:${droneId}`);
      console.log(`Client ${socket.id} unsubscribed from room: drone:${droneId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 WebSocket client disconnected: ${socket.id}`);
    });
  });

  // Subscribe to telemetry emitter from MQTT Ingestor and push updates to WebSocket clients
  telemetryEmitter.on('telemetry', (payload) => {
    if (!io) return;

    // 1. Broadcast telemetry to all clients listening globally
    io.emit('telemetry', payload);

    // 2. Broadcast telemetry specifically to the drone's room
    io.to(`drone:${payload.droneId}`).emit('telemetry_update', payload);
  });

  console.log('✔ Socket.IO server initialized.');
}

/**
 * Helper to emit custom alert notifications over WebSockets
 */
export function broadcastAlert(alert: any) {
  if (io) {
    io.emit('alert', alert);
    console.log(`🔔 Broadcasted alert to clients:`, alert.type);
  }
}
