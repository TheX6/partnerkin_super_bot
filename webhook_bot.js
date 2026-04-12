// webhook_bot.js - ПРОСТАЯ рабочая версия бота ТОЛЬКО для webhook
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const token = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || 'https://partnerkin-superbot2.onrender.com';

// Создаем бота БЕЗ polling
const bot = new TelegramBot(token, { polling: false });

// Создаем Express сервер
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'partnerkin-bot-webhook'
    });
});

// Webhook endpoint - catch ANY /bot* path
app.post('/bot*', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Главная страница
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Партнеркино Бот</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>🤖 Партнеркино Бот</h1>
            <p>Бот работает в режиме webhook</p>
            <a href="https://t.me/partnerkin_super_bot" style="display: inline-block; background: #0088cc; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px;">Открыть в Telegram</a>
        </body>
        </html>
    `);
});

// Обработчик /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, '👋 Привет! Я работаю на webhook!\n\n✅ Бот полностью функционален.');
});

// Обработчик текстовых сообщений
bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        bot.sendMessage(msg.chat.id, `Вы написали: ${msg.text}`);
    }
});

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`🌐 Server running on port ${PORT}`);
    console.log(`🔗 Webhook URL: ${WEBHOOK_URL}`);

    try {
        // Устанавливаем webhook
        const webhookUrl = `${WEBHOOK_URL}/bot${token}`;
        await bot.setWebHook(webhookUrl);
        console.log(`✅ Webhook set successfully!`);

        const info = await bot.getWebHookInfo();
        console.log(`📡 Webhook info:`, info);
    } catch (error) {
        console.error(`❌ Webhook error:`, error.message);
    }
});

console.log('🚀 Webhook bot starting...');
