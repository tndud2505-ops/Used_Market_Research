import { createServer } from './server.js';
import { WEB_BACKEND_CONFIG } from './config.js';

// Start the server
const port = WEB_BACKEND_CONFIG.port;
const server = createServer(port);

console.log(`
====================================
   WEB-BACKEND HTTP Server
====================================
Port: ${port}
Host: http://localhost:${port}
Route(s) count: 9
====================================
`);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[web-backend] Shutting down...');
  server.close(() => {
    console.log('[web-backend] Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n[web-backend] SIGTERM received, shutting down...');
  server.close(() => {
    console.log('[web-backend] Server closed');
    process.exit(0);
  });
});
