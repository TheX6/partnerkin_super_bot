// local.js - Local development startup script (Polling Mode)
require('dotenv').config();

console.log('🚀 Starting Partnerkin Bot in LOCAL mode (Polling)...');
console.log('📝 Token:', process.env.TELEGRAM_TOKEN?.slice(0, 10) + '...');
console.log('🔄 Mode:', process.env.BOT_MODE || 'polling');
console.log('');

// Ensure we're in polling mode
process.env.BOT_MODE = 'polling';
process.env.NODE_ENV = 'development';

// Start the bot
require('./app.js');

console.log('✅ Bot started successfully!');
console.log('💡 Press Ctrl+C to stop the bot');
