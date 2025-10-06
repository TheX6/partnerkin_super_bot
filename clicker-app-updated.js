// clicker-app.js для тапалки
const express = require('express');
const path = require('path');
require('dotenv').config();

// Подключаем общую базу данных (такую же, как и бот)
const db = require('./database'); // Используем общую базу данных с ботом

const app = express();
const PORT = process.env.CLICKER_PORT || 3001;

// Разрешаем статические файлы (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// === API: обработка тапа ===
app.post('/api/click', async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'userId required' });
    }

    const now = new Date().toISOString();

    try {
        // Получаем пользователя
        const user = await db.get('SELECT id, energy, p_coins FROM users WHERE telegram_id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.energy <= 0) {
            return res.status(400).json({ error: 'No energy left' });
        }

        // Тратим 1% энергии, даём 1 П-коин
        const newEnergy = Math.max(0, user.energy - 1);
        const coinsEarned = 1;

        // Обновляем пользователя
        await db.run(
            'UPDATE users SET energy = ?, p_coins = p_coins + ? WHERE telegram_id = ?',
            [newEnergy, coinsEarned, userId]
        );

        // Обновляем статистику тапов
        await db.run(
            `INSERT INTO clicker_stats (user_id, total_clicks, last_click)
             VALUES ((SELECT id FROM users WHERE telegram_id = ?), 1, ?)
             ON CONFLICT(user_id) DO UPDATE SET
             total_clicks = clicker_stats.total_clicks + 1,
             last_click = ?`,
            [userId, now, now]
        );

        res.json({
            success: true,
            coins: coinsEarned,
            energy: newEnergy
        });
    } catch (err) {
        console.error('Click error:', err);
        res.status(500).json({ error: 'DB update failed' });
    }
});

// === Главная страница Mini App ===
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'clicker.html'));
});

app.listen(PORT, () => {
    console.log(`🎮 Тапалка запущена на http://localhost:${PORT}`);
});

// Обработка завершения процесса
process.on('SIGINT', () => {
    console.log('\n⏹️ Останавливаю тапалку...');
    console.log('💾 Закрываю базу данных...');
    
    // Закрываем PostgreSQL клиент если это подключение к PostgreSQL
    const dbType = require('./config').DATABASE.type;
    if (dbType === 'postgresql') {
        if (typeof db.end === 'function') {
            db.end(() => {
                console.log('✅ База данных закрыта успешно');
                console.log('👋 Тапалка остановлена! До встречи!');
                process.exit(0);
            });
        } else {
            console.log('✅ База данных закрыта успешно');
            console.log('👋 Тапалка остановлена! До встречи!');
            process.exit(0);
        }
    } else {
        console.log('✅ База данных закрыта успешно');
        console.log('👋 Тапалка остановлена! До встречи!');
        process.exit(0);
    }
});