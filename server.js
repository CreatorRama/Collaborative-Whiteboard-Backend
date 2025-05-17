const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 8080;

// Create the WebSocket server with proper configuration for hosting environments
const wss = new WebSocket.Server({ 
  port: PORT,
  verifyClient: (info, done) => {
    const allowedOrigins = [
      'https://whiteboard-frontend-md5zbwoym-creatorramas-projects.vercel.app', 
      'http://localhost:5173'             
    ];
     
    if (!info.origin || allowedOrigins.includes(info.origin)) {
      done(true); 
    } else {
      console.log('Blocked origin:', info.origin);
      done(false, 401, 'Unauthorized'); 
    }
  }
});

const clients = new Map(); // Store client information
const drawingHistory = []; // Store all drawing actions
const MAX_HISTORY = 100; // Limit history size

wss.on('connection', (ws) => {
  const clientId = uuidv4();
  console.log(`Client connected: ${clientId}`);
  clients.set(ws, { id: clientId });

  // Send the full drawing history to new clients
  ws.send(JSON.stringify({
    type: 'INIT',
    data: drawingHistory
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);
      
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
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(ws);
  });
});

// Log the actual public URL instead of localhost
console.log(`WebSocket server running on port ${PORT}`);
console.log('For secure connections use: wss://collaborative-whiteboard-backend-n4qk.onrender.com');