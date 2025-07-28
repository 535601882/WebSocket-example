const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Simple broadcast function
wss.broadcast = function broadcast(msg, sender) {
  wss.clients.forEach(function each(client) {
    // Send to everyone except the sender
    if (client !== sender && client.readyState === sender.OPEN) {
      client.send(msg);
    }
  });
};

wss.on('connection', (ws, req) => {
  // Extract username from the URL, e.g., /?username=user_123
  const url = new URL(req.url, `http://${req.headers.host}`);
  const username = url.searchParams.get('username') || 'anonymous';
  ws.username = username;

  console.log(`${ws.username} connected`);

  // Notify all clients about the new user
  const joinMsg = JSON.stringify({ type: 'status', message: `${ws.username} has joined the chat.` });
  wss.clients.forEach(client => {
      if (client.readyState === ws.OPEN) {
          client.send(joinMsg);
      }
  });

  ws.on('message', (message) => {
    console.log(`Received message from ${ws.username}: ${message}`);
    // Create a message object to broadcast
    const messageData = {
      type: 'chat',
      username: ws.username,
      message: message.toString(), // Buffer to string
    };
    const broadcastMessage = JSON.stringify(messageData);

    // Broadcast to all clients, including the sender
    wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) {
            client.send(broadcastMessage);
        }
    });
  });

  ws.on('close', () => {
    console.log(`${ws.username} disconnected`);
    // Notify all clients that a user has left
    const leaveMsg = JSON.stringify({ type: 'status', message: `${ws.username} has left the chat.` });
    wss.clients.forEach(client => {
        if (client.readyState === ws.OPEN) {
            client.send(leaveMsg);
        }
    });
  });

  ws.on('error', console.error);
});

server.listen(3000, () => {
  console.log('Server listening on http://localhost:3000');
});