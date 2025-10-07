// start.js - Production startup script (Webhook Mode)
const { spawn } = require('child_process');

console.log('🚀 Starting Partnerkin Bot in production mode (Webhook)...');

// Start server (includes bot via webhook)
const server = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' }
});

// Handle server crash
server.on('exit', (code) => {
    console.error(`❌ Server exited with code ${code}`);
    if (code !== 0) {
        console.log('🔄 Restarting...');
        process.exit(code);
    }
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Shutting down...');
    server.kill('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('🛑 Shutting down...');
    server.kill('SIGINT');
});