const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 8080;

// This is critical: create proper server setup for hosted environments
let server;

// For local development
if (!process.env.PORT) {
  server = http.createServer();
  server.listen(PORT);
} else {
  // For Render deployment
  server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket server is running');
  });
  server.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });
}

// Create WebSocket server by passing the server instance
const wss = new WebSocket.Server({ 
  server: server,
  verifyClient: (info, done) => {
    console.log('Connection attempt from origin:', info.origin);
    
    const allowedOrigins = [
      'https://whiteboard-frontend-one.vercel.app',
      'https://whiteboard-frontend-ridxbyt24-creatorramas-projects.vercel.app',
      'https://whiteboard-frontend-md5zbwoym-creatorramas-projects.vercel.app', 
      'http://localhost:5173',
      // Allow connections with no origin (like from Postman or direct connections)
      undefined
    ];
     
    if (!info.origin || allowedOrigins.includes(info.origin)) {
      console.log('Origin accepted:', info.origin);
      done(true); 
    } else {
      console.log('Blocked origin:', info.origin);
      done(false, 401, 'Unauthorized origin'); 
    }
  }
});

const clients = new Map(); // Store client information
const drawingHistory = []; // Store all drawing actions
const MAX_HISTORY = 100; // Limit history size

// Handle new connections
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  console.log(`Client connected: ${clientId}`);
  console.log(`Client IP: ${req.socket.remoteAddress}`);
  
  clients.set(ws, { id: clientId });

  // Send the full drawing history to new clients
  ws.send(JSON.stringify({
    type: 'INIT',
    data: drawingHistory
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log('Received message type:', data.type);
      
      if (data.type === 'DRAW') {
        // Add to history and broadcast to all clients
        const action = { ...data.data, clientId, timestamp: Date.now() };
        drawingHistory.push(action);
        
        // Keep history size manageable
        if (drawingHistory.length > MAX_HISTORY) {
            drawingHistory.shift();
        }
        
        // Broadcast to all clients except sender
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'DRAW',
                    data: action
                }));
            }
        });
      }

      if(data.type === "CHAT") {
        console.log(`Chat message from ${data.Name}: ${data.res}`);

        // Broadcast chat message to all clients (including sender)
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'CHAT',
                    Name: data.Name,
                    res: data.res
                }));
            }
        });
      }
      
      // Add a ping/pong mechanism to keep connections alive
      if(data.type === "PING") {
        ws.send(JSON.stringify({
          type: 'PONG',
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // Handle disconnections
  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(ws);
  });
  
  // Send an initial welcome message
  ws.send(JSON.stringify({
    type: 'SYSTEM',
    message: 'Connected to whiteboard server'
  }));
});

// Keep track of server state
wss.on('listening', () => {
  console.log(`WebSocket server is listening on port ${PORT}`);
});

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

// Log important info
console.log(`HTTP/WebSocket server running on port ${PORT}`);
console.log(`For local connections use: ws://localhost:${PORT}`);
console.log('For Render deployment use: wss://collaborative-whiteboard-backend-n4qk.onrender.com');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('Allowed origins include the new Vercel deployment URL');

// Periodically check and log connection count
setInterval(() => {
  console.log(`Active connections: ${wss.clients.size}`);
}, 30000);