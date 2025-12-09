const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;

// roomId -> { host: ws | null, viewers: Set<ws> }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { host: null, viewers: new Set() });
  }
  return rooms.get(roomId);
}

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`Signaling server running on ws://localhost:${PORT}`);
});

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error('Invalid JSON:', message.toString());
      return;
    }

    const { type, roomId } = data;

    if (type === 'join') {
      const role = data.role; // 'host' or 'viewer'
      ws.roomId = roomId;
      ws.role = role;

      const room = getRoom(roomId);
      if (role === 'host') {
        room.host = ws;
        console.log(`Host joined room ${roomId}`);
      } else {
        room.viewers.add(ws);
        console.log(`Viewer joined room ${roomId}, total viewers: ${room.viewers.size}`);
      }

      return;
    }

    if (!ws.roomId) {
      console.warn('Client sent message without joining room first.');
      return;
    }

    const room = getRoom(ws.roomId);

    if (type === 'offer') {
      // from host -> send to all viewers
      room.viewers.forEach((viewer) => {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({
            type: 'offer',
            roomId: ws.roomId,
            sdp: data.sdp,
            sdpType: data.sdpType,
          }));
        }
      });
    } else if (type === 'answer') {
      // from viewer -> send to host
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        room.host.send(JSON.stringify({
          type: 'answer',
          roomId: ws.roomId,
          sdp: data.sdp,
          sdpType: data.sdpType,
        }));
      }
    } else if (type === 'iceCandidate') {
      const candidate = data.candidate;
      if (ws.role === 'host') {
        // host -> forward candidate to all viewers
        room.viewers.forEach((viewer) => {
          if (viewer.readyState === WebSocket.OPEN) {
            viewer.send(JSON.stringify({
              type: 'iceCandidate',
              roomId: ws.roomId,
              candidate,
            }));
          }
        });
      } else {
        // viewer -> forward to host
        if (room.host && room.host.readyState === WebSocket.OPEN) {
          room.host.send(JSON.stringify({
            type: 'iceCandidate',
            roomId: ws.roomId,
            candidate,
          }));
        }
      }
    }
  });

  ws.on('close', () => {
    const { roomId, role } = ws;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === 'host') {
      room.host = null;
      console.log(`Host left room ${roomId}`);
      // Optionally: notify viewers that host left
    } else {
      room.viewers.delete(ws);
      console.log(`Viewer left room ${roomId}, remaining: ${room.viewers.size}`);
    }

    if (!room.host && room.viewers.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty).`);
    }
  });
});

