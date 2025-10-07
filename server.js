// server.js - HTTP сервер для Web App API и Telegram Webhook
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'webapp')));

// Import bot from app.js (will NOT start polling, only webhook)
const { bot, db } = require('./app.js');

// Функция для проверки данных Telegram Web App
function verifyTelegramWebApp(initData, botToken) {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    urlParams.delete('hash');

    const dataCheckString = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    return calculatedHash === hash;
}

// API для получения данных пользователя
app.post('/api/user-data', (req, res) => {
    try {
        const { userId, initData } = req.body;

        // Проверяем подлинность данных (в продакшене обязательно!)
        // if (!verifyTelegramWebApp(initData, config.TELEGRAM_TOKEN)) {
        //     return res.status(401).json({ error: 'Invalid init data' });
        // }

        // Получаем данные пользователя
        db.get(`SELECT p_coins FROM users WHERE telegram_id = ?`, [userId], (err, user) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({
                pCoins: user ? user.p_coins : 0
            });
        });
    } catch (error) {
        console.error('User data error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Health check endpoint для мониторинга
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        service: 'partnerkin-bot'
    });
});

// Keep-alive endpoint (для предотвращения засыпания)
app.get('/ping', (req, res) => {
    res.status(200).json({ pong: Date.now() });
});

// Telegram Webhook endpoint
app.post(`/bot${config.TELEGRAM_TOKEN}`, (req, res) => {
    try {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Webhook error:', error);
        res.sendStatus(500);
    }
});

// Статическая раздача веб-приложения
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'webapp', 'index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`🌐 Web App server running on port ${PORT}`);
    console.log(`📱 Access your app at: http://localhost:${PORT}`);

    // Set webhook for production
    if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER === 'true') {
        const webhookUrl = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL;
        if (webhookUrl) {
            try {
                const fullWebhookUrl = `${webhookUrl}/bot${config.TELEGRAM_TOKEN}`;
                await bot.setWebHook(fullWebhookUrl);
                console.log(`✅ Webhook set to: ${fullWebhookUrl}`);

                // Verify webhook
                const webhookInfo = await bot.getWebHookInfo();
                console.log(`📡 Webhook info:`, webhookInfo);
            } catch (error) {
                console.error('❌ Failed to set webhook:', error.message);
                console.log('⚠️  Bot will not receive updates until webhook is set correctly');
            }
        } else {
            console.warn('⚠️  RENDER_EXTERNAL_URL not set - webhook cannot be configured');
        }
    } else {
        console.log('🏠 Running in local mode - no webhook set');
    }
});

module.exports = app;