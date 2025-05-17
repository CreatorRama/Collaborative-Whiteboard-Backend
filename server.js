const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const https = require('https');
const http = require('http');
const fs = require('fs');

const PORT = process.env.PORT || 8080;

// Create proper server setup for hosted environments
let server;

// For local development
if (!process.env.PORT) {
  console.log('Starting in local development mode');
  server = http.createServer();
} else {
  // For Render deployment - more robust HTTP server
  server = http.createServer((req, res) => {
    // Basic health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ 
        status: 'ok', 
        connections: wss ? wss.clients.size : 0,
        uptime: process.uptime()
      }));
    }
    
    // Default response
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WebSocket server is running. Connect using a WebSocket client.');
  });
}

// Listen on the specified port
server.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`);
});

// Log any server errors
server.on('error', (error) => {
  console.error('HTTP server error:', error);
});

// More permissive CORS setup for WebSocket server
const wss = new WebSocket.Server({ 
  server: server,
  // More permissive verifyClient function
  verifyClient: (info, done) => {
    console.log('Connection attempt from origin:', info.origin);
    
    // Allow ALL origins in development or if needed
    // You can restrict this in production
    const allowedOrigins = [
      'https://whiteboard-frontend-ikhrz0fz2-creatorramas-projects.vercel.app',
      'http://127.0.0.1:5173'
    ];
     
    // For development/debugging, accept all connections
    // For production, uncomment the origin check
    
    if (!info.origin || allowedOrigins.includes(info.origin)) {
      console.log('Origin accepted:', info.origin);
      done(true); 
    } else {
      console.log('Blocked origin:', info.origin);
      done(false, 401, 'Unauthorized origin'); 
    }
    
    
    // Currently accepting all connections for easier debugging
    console.log('Origin accepted (all allowed for debugging):', info.origin);
    done(true);
  }
});

const clients = new Map(); // Store client information
const drawingHistory = []; // Store all drawing actions
const MAX_HISTORY = 100; // Limit history size

// Enhanced connection handler with better error handling
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected: ${clientId} from IP: ${clientIp}`);
  
  clients.set(ws, { 
    id: clientId,
    ip: clientIp,
    connectedAt: new Date(),
    lastActivity: new Date()
  });

  // Try-catch around initial communication
  try {
    // Send the full drawing history to new clients
    ws.send(JSON.stringify({
      type: 'INIT',
      data: drawingHistory
    }));
    
    // Send a welcome message
    ws.send(JSON.stringify({
      type: 'SYSTEM',
      message: 'Connected to whiteboard server'
    }));
  } catch (error) {
    console.error(`Error sending initial data to client ${clientId}:`, error);
  }

  // Set up a heartbeat to detect broken connections
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.ping();
      } catch (error) {
        console.error(`Error sending ping to client ${clientId}:`, error);
        clearInterval(pingInterval);
        if (ws.readyState !== WebSocket.CLOSED) {
          ws.terminate();
        }
      }
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);

  ws.on('message', (message) => {
    try {
      // Update last activity timestamp
      const clientInfo = clients.get(ws);
      if (clientInfo) {
        clientInfo.lastActivity = new Date();
      }
      
      const data = JSON.parse(message.toString());
      console.log(`Received message type: ${data.type} from client: ${clientId}`);
      
      if (data.type === 'DRAW') {
        // Add to history and broadcast to all clients
        const action = { ...data.data, clientId, timestamp: Date.now() };
        drawingHistory.push(action);
        
        // Keep history size manageable
        if (drawingHistory.length > MAX_HISTORY) {
            drawingHistory.shift();
        }
        
        // Broadcast to all clients except sender
        broadcastMessage({
          type: 'DRAW',
          data: action
        }, ws);
      }

      else if (data.type === "CHAT") {
        console.log(`Chat message from ${data.Name}: ${data.res}`);

        // Broadcast chat message to all clients (including sender)
        broadcastMessage({
          type: 'CHAT',
          Name: data.Name,
          res: data.res
        });
      }
      
      // Add a ping/pong mechanism to keep connections alive
      else if (data.type === "PING") {
        ws.send(JSON.stringify({
          type: 'PONG',
          timestamp: Date.now()
        }));
      }
    } catch (err) {
      console.error(`Error processing message from client ${clientId}:`, err);
    }
  });

  // Handle pong responses to track connection health
  ws.on('pong', () => {
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      clientInfo.lastPong = new Date();
    }
  });

  // Handle disconnections
  ws.on('close', (code, reason) => {
    console.log(`Client disconnected: ${clientId}, Code: ${code}, Reason: ${reason || 'No reason provided'}`);
    clearInterval(pingInterval);
    clients.delete(ws);
    
    // Notify other clients about disconnection
    broadcastMessage({
      type: 'SYSTEM',
      message: `A user has left the whiteboard`
    });
  });
  
  // Handle connection errors
  ws.on('error', (error) => {
    console.error(`WebSocket error for client ${clientId}:`, error);
    clearInterval(pingInterval);
  });
  
  // Notify other clients about new connection
  broadcastMessage({
    type: 'SYSTEM',
    message: `A new user has joined the whiteboard`
  }, ws);
});

// Helper function for broadcasting messages
function broadcastMessage(message, excludeClient = null) {
  const messageStr = JSON.stringify(message);
  
  wss.clients.forEach((client) => {
    if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
      try {
        client.send(messageStr);
      } catch (error) {
        console.error('Error broadcasting message to client:', error);
      }
    }
  });
}

// Server events
wss.on('listening', () => {
  console.log(`WebSocket server is listening on port ${PORT}`);
});

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

// Cleanup inactive connections every 2 minutes
setInterval(() => {
  const now = new Date();
  
  clients.forEach((info, ws) => {
    // If no activity for 5 minutes, terminate the connection
    if (now - info.lastActivity > 5 * 60 * 1000) {
      console.log(`Terminating inactive client: ${info.id}`);
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
      clients.delete(ws);
    }
  });
  
  console.log(`Active connections: ${wss.clients.size}`);
}, 2 * 60 * 1000);

// Log important info
console.log(`HTTP/WebSocket server running on port ${PORT}`);
console.log(`For local connections use: ws://localhost:${PORT}`);
console.log('For production deployment use: wss://collaborative-whiteboard-backend-n4qk.onrender.com');
console.log('Environment:', process.env.NODE_ENV || 'development');
console.log('All origins allowed during debugging phase');

// Graceful shutdown
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function shutdown() {
  console.log('Shutting down server...');
  
  // Close all WebSocket connections gracefully
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'SYSTEM',
        message: 'Server is shutting down...'
      }));
      client.close(1000, 'Server shutdown');
    }
  });
  
  // Close the HTTP server
  server.close(() => {
    console.log('Server shutdown complete');
    process.exit(0);
  });
  
  // Force exit after 5 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 5000);
}