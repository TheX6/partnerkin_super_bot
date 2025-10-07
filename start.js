// start.js - Production startup script
const { spawn } = require('child_process');

console.log('🚀 Starting Partnerkin Bot in production mode...');

// Check if running on Render (free tier - single process)
const isRenderFreeTier = process.env.RENDER === 'true' || process.env.IS_RENDER === 'true';

if (isRenderFreeTier) {
    console.log('🌐 Detected Render free tier - running in single process mode');

    // Start server (which will also start the bot)
    const server = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });

    // Also start bot in same process
    const bot = spawn('node', ['app.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });

    // Handle crashes
    server.on('exit', (code) => {
        console.error(`❌ Server exited with code ${code}`);
        process.exit(code);
    });

    bot.on('exit', (code) => {
        console.error(`❌ Bot exited with code ${code}`);
        process.exit(code);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down...');
        server.kill('SIGTERM');
        bot.kill('SIGTERM');
    });

    process.on('SIGINT', () => {
        console.log('🛑 Shutting down...');
        server.kill('SIGINT');
        bot.kill('SIGINT');
    });
} else {
    // Local development - start web server and bot separately
    const server = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });

    const bot = spawn('node', ['app.js'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'production' }
    });

    // Handle server crash
    server.on('exit', (code) => {
        console.error(`❌ Server exited with code ${code}`);
        if (code !== 0) {
            console.log('🔄 Restarting server...');
        }
    });

    // Handle bot crash
    bot.on('exit', (code) => {
        console.error(`❌ Bot exited with code ${code}`);
        if (code !== 0) {
            console.log('🔄 Restarting bot...');
        }
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
        console.log('🛑 Shutting down...');
        server.kill('SIGTERM');
        bot.kill('SIGTERM');
    });

    process.on('SIGINT', () => {
        console.log('🛑 Shutting down...');
        server.kill('SIGINT');
        bot.kill('SIGINT');
    });
}