// app.js - Бот "Жизнь в Партнеркино" - ПРОДАКШН ВЕРСИЯ 🚀
require('dotenv').config();

// Production error handling
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    console.error('Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    if (bot) {
        bot.stopPolling();
    }
    if (db) {
        db.close();
    }
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully');
    if (bot) {
        bot.stopPolling();
    }
    if (db) {
        db.close();
    }
    process.exit(0);
});
const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const cron = require('node-cron');
const chrono = require('chrono-node');
const { parse } = require('csv-parse/sync');
const qrcode = require('qrcode');
const axios = require('axios');

// Получаем токен из конфигурации
const token = config.TELEGRAM_TOKEN;

// Determine bot mode based on environment
// Use webhook mode for production (when RENDER_EXTERNAL_URL is present)
// Use polling mode for local development
// Or use BOT_MODE environment variable if set explicitly
const isProduction = process.env.RENDER_EXTERNAL_URL ? true : false;
const botMode = process.env.BOT_MODE || (isProduction ? 'webhook' : 'polling');
const usePolling = botMode === 'polling';

// Initialize bot with appropriate mode
const bot = new TelegramBot(token, {
    polling: usePolling,
    filepath: false,
    webHook: !usePolling
});

console.log(`🤖 Bot initialized in ${botMode} mode (polling: ${usePolling})`);

// Wrap bot methods to use axios instead of request for problematic calls
const originalSendMessage = bot.sendMessage.bind(bot);
const originalSendPhoto = bot.sendPhoto.bind(bot);
const originalEditMessageText = bot.editMessageText.bind(bot);
const originalAnswerCallbackQuery = bot.answerCallbackQuery.bind(bot);

bot.sendMessage = async function(chatId, text, options = {}) {
    try {
        return await originalSendMessage(chatId, text, options);
    } catch (error) {
        if (error.code === 'EFATAL' || error.message.includes('UNESCAPED_CHARACTERS')) {
            console.log('⚠️  Using axios fallback for sendMessage');
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            const response = await axios.post(url, {
                chat_id: chatId,
                text: text,
                ...options
            });
            return response.data.result;
        }
        throw error;
    }
};

bot.sendPhoto = async function(chatId, photo, options = {}) {
    try {
        return await originalSendPhoto(chatId, photo, options);
    } catch (error) {
        if (error.code === 'EFATAL' || error.message.includes('UNESCAPED_CHARACTERS')) {
            console.log('⚠️  Using axios fallback for sendPhoto');
            const FormData = require('form-data');
            const form = new FormData();
            form.append('chat_id', chatId);
            form.append('photo', photo, { filename: 'photo.jpg' });
            if (options.caption) form.append('caption', options.caption);
            if (options.parse_mode) form.append('parse_mode', options.parse_mode);

            const url = `https://api.telegram.org/bot${token}/sendPhoto`;
            const response = await axios.post(url, form, {
                headers: form.getHeaders()
            });
            return response.data.result;
        }
        throw error;
    }
};

bot.editMessageText = async function(text, options = {}) {
    try {
        return await originalEditMessageText(text, options);
    } catch (error) {
        if (error.code === 'EFATAL' || error.message.includes('UNESCAPED_CHARACTERS')) {
            console.log('⚠️  Using axios fallback for editMessageText');
            const url = `https://api.telegram.org/bot${token}/editMessageText`;
            const response = await axios.post(url, {
                text: text,
                ...options
            });
            return response.data.result;
        }
        throw error;
    }
};

bot.answerCallbackQuery = async function(callbackQueryId, options = {}) {
    try {
        return await originalAnswerCallbackQuery(callbackQueryId, options);
    } catch (error) {
        if (error.code === 'EFATAL' || error.message.includes('UNESCAPED_CHARACTERS')) {
            console.log('⚠️  Using axios fallback for answerCallbackQuery');
            const url = `https://api.telegram.org/bot${token}/answerCallbackQuery`;
            const response = await axios.post(url, {
                callback_query_id: callbackQueryId,
                ...options
            });
            return response.data.result;
        }
        throw error;
    }
};

// Глобальные переменные для состояний
global.userScreenshots = {};
global.waitingForPoints = {};
global.adminStates = {};
global.userMenuContext = {};
global.vacationStates = {};
global.taskReminders = {};

function scheduleTaskReminder(taskId, intervalMinutes, assigneeId, taskTitle) {
    if (global.taskReminders[taskId]) {
        console.log(`[SCHEDULER] Reminder for task ${taskId} already exists. Skipping.`);
        return;
    }

    const cronPattern = `*/${intervalMinutes} * * * *`;
    try {
        const job = cron.schedule(cronPattern, () => {
            db.get("SELECT telegram_id FROM users WHERE id = ?", [assigneeId], (err, user) => {
                if (user) {
                    bot.sendMessage(user.telegram_id, `⏰ Напоминание по задаче:\n**${taskTitle}**`, { parse_mode: 'Markdown' }).catch(err => {
                        console.error('[REMINDER] Error sending message:', err.message);
                    });
                }
            });
        });
        global.taskReminders[taskId] = job;
        console.log(`[SCHEDULER] Scheduled reminder for task ${taskId} every ${intervalMinutes} minutes.`);
    } catch (e) {
        console.error(`[SCHEDULER] Error scheduling task ${taskId}:`, e);
    }
}

function cancelTaskReminder(taskId) {
    if (global.taskReminders[taskId]) {
        global.taskReminders[taskId].stop();
        delete global.taskReminders[taskId];
        console.log(`[SCHEDULER] Cancelled reminder for task ${taskId}.`);
    }
}

function initializeSchedules() {
    console.log('[SCHEDULER] Initializing schedules for active tasks...');
    db.all("SELECT id, reminder_interval_minutes, assignee_id, title FROM tasks WHERE status = 'in_progress' AND reminder_interval_minutes IS NOT NULL", (err, tasks) => {
        if (err) {
            console.error('[SCHEDULER] Error fetching tasks for schedule initialization:', err);
            return;
        }

        if (tasks && tasks.length > 0) {
            tasks.forEach(task => {
                scheduleTaskReminder(task.id, task.reminder_interval_minutes, task.assignee_id, task.title);
            });
            console.log(`[SCHEDULER] Initialized ${tasks.length} task reminders.`);
        } else {
            console.log('[SCHEDULER] No active tasks with reminders to initialize.');
        }
    });
}

// База данных
const db = require('./database');

// Создание таблиц
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        username TEXT,
        full_name TEXT,
        role TEXT DEFAULT 'новичок',
        p_coins INTEGER DEFAULT 0,
        company_points INTEGER DEFAULT 0,
        energy INTEGER DEFAULT 100,
        qr_code_token TEXT,
        registration_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        contacts TEXT,
        is_registered INTEGER DEFAULT 0,
        position_level TEXT
    )`);


    db.run(`CREATE TABLE IF NOT EXISTS intern_progress (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        test_name TEXT,
        completed INTEGER DEFAULT 0,
        points_earned INTEGER DEFAULT 0,
        completed_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS test_submissions (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        telegram_id INTEGER,
        username TEXT,
        test_name TEXT,
        points_claimed INTEGER,
        photo_file_id TEXT,
        status TEXT DEFAULT 'pending',
        submitted_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        admin_id INTEGER,
        reviewed_date DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        telegram_id INTEGER,
        granted_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS battles (
        id INTEGER PRIMARY KEY,
        attacker_id INTEGER,
        defender_id INTEGER,
        winner_id INTEGER,
        points_won INTEGER,
        battle_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(attacker_id) REFERENCES users(id),
        FOREIGN KEY(defender_id) REFERENCES users(id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        item_name TEXT,
        price INTEGER,
        purchase_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);


    // Тайм-слоты для мероприятий
    db.run(`CREATE TABLE IF NOT EXISTS event_slots (
        id INTEGER PRIMARY KEY,
        event_name TEXT,
        category TEXT,
        date TEXT,
        time TEXT,
        location TEXT,
        max_participants INTEGER DEFAULT 10,
        current_participants INTEGER DEFAULT 0,
        points_reward INTEGER DEFAULT 5,
        status TEXT DEFAULT 'active',
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Записи на мероприятия
    db.run(`CREATE TABLE IF NOT EXISTS event_bookings (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        slot_id INTEGER,
        booking_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(slot_id) REFERENCES event_slots(id)
    )`);

    // Подарки П-коинов
    db.run(`CREATE TABLE IF NOT EXISTS gifts (
        id INTEGER PRIMARY KEY,
        sender_id INTEGER,
        receiver_id INTEGER,
        amount INTEGER,
        message TEXT,
        gift_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id) REFERENCES users(id),
        FOREIGN KEY(receiver_id) REFERENCES users(id)
    )`);

    // Таблица заявок на отпуск
    db.run(`CREATE TABLE IF NOT EXISTS vacation_requests (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        telegram_id INTEGER,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        vacation_type TEXT DEFAULT 'основной',
        reason TEXT,
        days_count INTEGER,
        status TEXT DEFAULT 'pending',
        requested_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_date DATETIME,
        reviewer_id INTEGER,
        reviewer_comment TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(reviewer_id) REFERENCES users(id)
    )`);

    // Таблица баланса отпусков пользователей
    db.run(`CREATE TABLE IF NOT EXISTS vacation_balances (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        telegram_id INTEGER,
        year INTEGER,
        total_days INTEGER DEFAULT 28,
        used_days INTEGER DEFAULT 0,
        pending_days INTEGER DEFAULT 0,
        remaining_days INTEGER DEFAULT 28,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(user_id, year)
    )`);

    // Система задач
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY,
        creator_id INTEGER,
        assignee_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        reward_coins INTEGER DEFAULT 0,
        reminder_interval_minutes INTEGER,
        due_date DATETIME,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_date DATETIME,
        cancelled_reason TEXT,
        postponed_until DATETIME,
        last_action_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(creator_id) REFERENCES users(id),
        FOREIGN KEY(assignee_id) REFERENCES users(id)
    )`);

    columnExists('tasks', 'started_at', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE tasks ADD COLUMN started_at TIMESTAMP", (err) => {
                if (err) console.log("ALTER tasks.started_at error:", err.message);
            });
        }
    });

    columnExists('tasks', 'reminder_interval_minutes', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE tasks ADD COLUMN reminder_interval_minutes INTEGER", (err) => {
                if (err) console.log("ALTER tasks.reminder_interval_minutes error:", err.message);
            });
        }
    });

    // Инвойсы для продажников
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY,
        creator_id INTEGER,
        company_name TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        quantity INTEGER DEFAULT 1,
        description TEXT,
        file_path TEXT,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(creator_id) REFERENCES users(id)
    )`);

    // Контакты компаний
    db.run(`CREATE TABLE IF NOT EXISTS company_contacts (
        id INTEGER PRIMARY KEY,
        company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        position TEXT,
        email TEXT,
        phone TEXT,
        telegram TEXT,
        notes TEXT,
        added_by INTEGER,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(added_by) REFERENCES users(id)
    )`);

    // Контакты с конференций
    db.run(`CREATE TABLE IF NOT EXISTS conference_contacts (
        id INTEGER PRIMARY KEY,
        scanner_id INTEGER NOT NULL,
        manager_id INTEGER NOT NULL,
        scanner_contact TEXT NOT NULL,
        manager_contact TEXT NOT NULL,
        exchange_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(scanner_id) REFERENCES users(id),
        FOREIGN KEY(manager_id) REFERENCES users(id)
    )`);

    // Helper function to check if column exists
    function columnExists(table, column, callback) {
        db.all(`PRAGMA table_info(${table})`, (err, rows) => {
            if (err) {
                console.error(`Error checking column ${column} in table ${table}:`, err);
                callback(false);
                return;
            }
            const exists = rows && rows.some(row => row.name === column);
            callback(exists);
        });
    }

    // Safe ALTERs for new fields
    columnExists('invoices', 'work_type', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE invoices ADD COLUMN work_type TEXT", (err) => {
                if (err) console.log("ALTER work_type error:", err.message);
            });
        }
    });
    columnExists('invoices', 'org_address', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE invoices ADD COLUMN org_address TEXT", (err) => {
                if (err) console.log("ALTER org_address error:", err.message);
            });
        }
    });

    // Add company info columns to conference_contacts table
    columnExists('conference_contacts', 'company_name', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE conference_contacts ADD COLUMN company_name TEXT", (err) => {
                if (err) console.log("ALTER company_name error:", err.message);
            });
        }
    });

    columnExists('conference_contacts', 'position', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE conference_contacts ADD COLUMN position TEXT", (err) => {
                if (err) console.log("ALTER position error:", err.message);
            });
        }
    });

    columnExists('conference_contacts', 'comment', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE conference_contacts ADD COLUMN comment TEXT", (err) => {
                if (err) console.log("ALTER comment error:", err.message);
            });
        }
    });
    columnExists('invoices', 'invoice_number', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE invoices ADD COLUMN invoice_number INTEGER", (err) => {
                if (err) console.log("ALTER invoice_number error:", err.message);
            });
        }
    });
    columnExists('invoices', 'invoice_date', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE invoices ADD COLUMN invoice_date DATE DEFAULT CURRENT_DATE", (err) => {
                if (err) console.log("ALTER invoice_date error:", err.message);
            });
        }
    });

    // Добавляем поля для статуса сотрудников
    columnExists('users', 'status', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'offline'", (err) => {
                if (err) console.log("ALTER status error:", err.message);
            });
        }
    });
    columnExists('users', 'status_message', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN status_message TEXT", (err) => {
                if (err) console.log("ALTER status_message error:", err.message);
            });
        }
    });
    columnExists('users', 'last_activity', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN last_activity TIMESTAMP", (err) => {
                if (err) {
                    console.log("ALTER last_activity error:", err.message);
                } else {
                    // Устанавливаем текущее время для всех существующих пользователей
                    db.run("UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE last_activity IS NULL");
                }
            });
        }
    });

    columnExists('users', 'position', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN position TEXT", (err) => {
                if (err) console.log("ALTER position error:", err.message);
            });
        }
    });

    columnExists('users', 'graduated_at', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN graduated_at TIMESTAMP", (err) => {
                if (err) console.log("ALTER graduated_at error:", err.message);
            });
        }
    });

    columnExists('users', 'wallet_address', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN wallet_address TEXT", (err) => {
                if (err) console.log("ALTER wallet_address error:", err.message);
            });
        }
    });

    columnExists('users', 'position_level', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN position_level TEXT", (err) => {
                if (err) console.log("ALTER position_level error:", err.message);
            });
        }
    });

    columnExists('users', 'company_points', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN company_points INTEGER DEFAULT 0", (err) => {
                if (err) console.log("ALTER company_points error:", err.message);
            });
        }
    });

    columnExists('users', 'qr_code_token', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN qr_code_token TEXT", (err) => {
                if (err) console.log("ALTER qr_code_token error:", err.message);
            });
        }
    });

    columnExists('users', 'is_external', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN is_external INTEGER DEFAULT 0", (err) => {
                if (err) console.log("ALTER users.is_external error:", err.message);
            });
        }
    });

    columnExists('users', 'mentor_id', (exists) => {
        if (!exists) {
            db.run("ALTER TABLE users ADD COLUMN mentor_id INTEGER REFERENCES users(id)", (err) => {
                if (err) console.log("ALTER users.mentor_id error:", err.message);
            });
        }
    });

    // Комментарии к задачам
    db.run(`CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY,
        task_id INTEGER,
        user_id INTEGER,
        comment TEXT NOT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(task_id) REFERENCES tasks(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Система "Похвастаться"
    db.run(`CREATE TABLE IF NOT EXISTS achievements (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        title TEXT NOT NULL,
        description TEXT,
        photo_file_id TEXT,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // Лайки к достижениям
    db.run(`CREATE TABLE IF NOT EXISTS achievement_likes (
        id INTEGER PRIMARY KEY,
        achievement_id INTEGER,
        user_id INTEGER,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(achievement_id) REFERENCES achievements(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(achievement_id, user_id)
    )`);

    // Комментарии к достижениям
    db.run(`CREATE TABLE IF NOT EXISTS achievement_comments (
        id INTEGER PRIMARY KEY,
        achievement_id INTEGER,
        user_id INTEGER,
        comment TEXT NOT NULL,
        created_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(achievement_id) REFERENCES achievements(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bug_reports (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        description TEXT NOT NULL,
        media_file_id TEXT,
        media_type TEXT,
        status TEXT DEFAULT 'pending',
        submitted_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS exchange_history (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        p_coins_exchanged INTEGER,
        company_points_received INTEGER,
        exchange_rate REAL DEFAULT 10,
        exchange_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS pcoin_requests (
        id INTEGER PRIMARY KEY,
        requester_id INTEGER,
        target_id INTEGER,
        amount INTEGER,
        reason TEXT,
        status TEXT DEFAULT 'pending', -- pending, approved, declined
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME,
        FOREIGN KEY(requester_id) REFERENCES users(id),
        FOREIGN KEY(target_id) REFERENCES users(id)
    )`);

    console.log('🚀 База данных готова к работе!');
});

// ========== КЛАВИАТУРЫ ==========

const startKeyboard = {
    reply_markup: {
        keyboard: [['👶 Я стажер', '🧓 Я старичок']],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

const internMenuKeyboard = {
    reply_markup: {
        keyboard: [
            ['📚 Пройти тестирование'],
            ['💰 Мой баланс', '📊 Мой прогресс'],
            ['🔄 Главное меню']
        ],
        resize_keyboard: true
    }
};

const mainMenuKeyboard = {
    reply_markup: {
        keyboard: [
            ['💰 Личное', '🎓 Обучение'],
            ['📋 Работа', '🎮 Развлечения'],
            ['👤 Мой профиль', '🐞 Сообщить о баге']
        ],
        resize_keyboard: true
    }
};

// Sub-menus for main menu categories
const personalKeyboard = {
    reply_markup: {
        keyboard: [
            ['💰 Мой баланс', '🏆 Рейтинг'],
            ['🏖️ Отпуски'],
            ['🔙 В главное меню']
        ],
        resize_keyboard: true
    }
};

const learningKeyboard = {
    reply_markup: {
        keyboard: [
            ['🎓 Курсы', '📊 Мой прогресс'],
            ['🔙 В главное меню']
        ],
        resize_keyboard: true
    }
};

const workKeyboard = {
    reply_markup: {
        keyboard: [
            ['📋 Задачи', '🎯 Мероприятия'],
            ['📄 Создать инвойс', '📇 Поиск контактов'],
            ['👥 Команда', '📱 Я на конфе'],
            ['🔙 В главное меню']
        ],
        resize_keyboard: true
    }
};

const funKeyboard = {
    reply_markup: {
        keyboard: [
            ['⚔️ PVP Сражения', '🛒 Магазин'],
            ['👛 Мой кошелек', '🎉 Похвастаться'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const walletKeyboard = {
    reply_markup: {
        keyboard: [
            ['💸 Отправить П-коины', '🔄 Обмен на баллы'],
            ['⛏ Майнинг ферма', '📜 История операций'],
            ['🔙 Назад в развлечения']
        ],
        resize_keyboard: true
    }
};

const teamKeyboard = {
    reply_markup: {
        keyboard: [
            ['👥 Сотрудники онлайн', '⚡ Мой статус'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

function showTeamMenu(chatId) {
    bot.sendMessage(chatId, '👥 Раздел команды', teamKeyboard).catch(console.error);
}

function showFunMenu(chatId) {
    global.userMenuContext[chatId] = 'main';
    bot.sendMessage(chatId, '🎮 Здесь вы можете развлечься и потратить свои П-коины.', funKeyboard).catch(console.error);
}

function showWallet(chatId, telegramId) {
    db.get("SELECT p_coins, company_points FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Не удалось найти ваш кошелек. Попробуйте /start');
            return;
        }
        const message = `👛 *Мой кошелек*\n\n` +
                        `💰 *Баланс П-коинов:* ${user.p_coins || 0}\n` +
                        `⭐ *Баллы компании:* ${user.company_points || 0}\n\n` +
                        `Что вы хотите сделать?`;

        global.userMenuContext[chatId] = 'fun';
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: walletKeyboard.reply_markup });
    });
}

function startGiftPcoins(chatId, telegramId) {
    db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Вы не зарегистрированы. Пожалуйста, используйте /start.');
            return;
        }
        global.userScreenshots[telegramId] = {
            type: 'gift_pcoins',
            step: 'enter_recipient',
            data: { sender_id: user.id }
        };
        bot.sendMessage(chatId, '💸 *Отправка П-коинов*\n\nКому вы хотите отправить П-коины? Введите @username получателя.', {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: [['❌ Отмена']],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        });
    });
}

function handleGiftPcoins(chatId, telegramId, text, currentState) {
    const step = currentState.step;

    if (text === '❌ Отмена') {
        delete global.userScreenshots[telegramId];
        showWallet(chatId, telegramId);
        return;
    }

    if (step === 'enter_recipient') {
        if (!text.startsWith('@')) {
            bot.sendMessage(chatId, '❌ Неверный формат. Пожалуйста, введите @username получателя.');
            return;
        }
        const recipientUsername = text.substring(1);

        db.get("SELECT id, telegram_id, full_name FROM users WHERE username = ? AND telegram_id != ?", [recipientUsername, telegramId], (err, recipient) => {
            if (err || !recipient) {
                bot.sendMessage(chatId, '❌ Пользователь с таким @username не найден. Попробуйте еще раз.');
                return;
            }

            currentState.data.recipient_id = recipient.id;
            currentState.data.recipient_telegram_id = recipient.telegram_id;
            currentState.data.recipient_name = recipient.full_name;
            currentState.step = 'enter_amount';

            db.get("SELECT p_coins FROM users WHERE telegram_id = ?", [telegramId], (err, sender) => {
                bot.sendMessage(chatId, `✅ Получатель: ${recipient.full_name}.\n\nТеперь введите сумму П-коинов для отправки.\nВаш баланс: ${sender.p_coins} 💰`);
            });
        });
    } else if (step === 'enter_amount') {
        const amount = parseInt(text, 10);

        if (isNaN(amount) || amount <= 0) {
            bot.sendMessage(chatId, '❌ Пожалуйста, введите положительное число.');
            return;
        }

        db.get("SELECT p_coins FROM users WHERE telegram_id = ?", [telegramId], (err, sender) => {
            if (sender.p_coins < amount) {
                bot.sendMessage(chatId, `❌ Недостаточно средств. Ваш баланс: ${sender.p_coins} 💰`);
                return;
            }

            currentState.data.amount = amount;
            currentState.step = 'enter_message';
            bot.sendMessage(chatId, `✅ Сумма: ${amount} П-коинов.\n\nНапишите короткое сообщение получателю (или нажмите 'Пропустить').`, {
                reply_markup: {
                    keyboard: [['Пропустить'], ['❌ Отмена']],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            });
        });
    } else if (step === 'enter_message') {
        currentState.data.message = (text === 'Пропустить') ? '' : text;
        currentState.step = 'confirm';

        const { recipient_name, amount, message } = currentState.data;
        const confirmationText = `*Подтвердите перевод:*\n\n` +
                                 `👥 *Получатель:* ${recipient_name}\n` +
                                 `💰 *Сумма:* ${amount} П-коинов\n` +
                                 `💬 *Сообщение:* ${message || '_нет_'}\n\n` +
                                 `Все верно?`;

        bot.sendMessage(chatId, confirmationText, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Подтвердить', callback_data: 'gift_confirm' }],
                    [{ text: '❌ Отмена', callback_data: 'gift_cancel' }]
                ]
            }
        });
    }
}

function startExchange(chatId, telegramId) {
    bot.sendMessage(chatId, '🔄 *Обмен на баллы*\n\nЭта функция скоро будет доступна! Вы сможете обменивать П-коины на баллы компании.', { parse_mode: 'Markdown' });
}

function showMiningFarm(chatId, telegramId) {
    bot.sendMessage(chatId, '⛏ *Майнинг ферма*\n\nЭта функция находится в разработке. Здесь вы сможете зарабатывать П-коины пассивно!', { parse_mode: 'Markdown' });
}

function showTransactionHistory(chatId, telegramId) {
    bot.sendMessage(chatId, '📜 *История операций*\n\nЭта функция скоро будет доступна! Вы сможете просматривать историю ваших транзакций.', { parse_mode: 'Markdown' });
}

const qrContactsKeyboard = {
    reply_markup: {
        keyboard: [
            ['📱 Мой QR-код', '🔍 Скан коллеги'],
            ['➕ Добавить контакт', '📇 Контакты с конфы'],
            ['🔙 Назад в работу']
        ],
        resize_keyboard: true
    }
};

function showQrContactsMenu(chatId, telegramId) {
    bot.sendMessage(chatId,
        '📱 Я НА КОНФЕ 🤝\n\n' +
        '✨ Быстрый обмен контактами на конференциях\n' +
        '📋 Управляй своими рабочими контактами\n\n' +
        '👇 Выбери действие:', qrContactsKeyboard).catch(console.error);
}

// Show user's conference contacts
function showMyContacts(chatId, telegramId) {
    // Get user's ID
    db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err) {
            console.error('Error getting user ID:', err);
            bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте еще раз.');
            return;
        }
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
            return;
        }
        
        // Get contacts where user is either scanner or manager
        db.all(`SELECT cc.*,
                scanner.username as scanner_username, scanner.telegram_id as scanner_telegram_id,
                manager.username as manager_username, manager.telegram_id as manager_telegram_id
                FROM conference_contacts cc
                LEFT JOIN users scanner ON cc.scanner_id = scanner.id
                LEFT JOIN users manager ON cc.manager_id = manager.id
                WHERE cc.scanner_id = ? OR cc.manager_id = ?
                ORDER BY cc.exchange_date DESC`,
                [user.id, user.id], (err, contacts) => {
            if (err) {
                console.error('Error getting conference contacts:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке контактов.');
                return;
            }
            
            if (contacts.length === 0) {
                bot.sendMessage(chatId,
                    '📇 *Контакты с конфы*\n\n' +
                    'У вас пока нет контактов с конференций.\n\n' +
                    'Отсканируйте QR-коды коллег на конференции, чтобы добавить их в этот список!',
                    { parse_mode: 'Markdown' }
                );
                return;
            }
            
            // Send introduction message
            bot.sendMessage(chatId,
                '📇 *Ваши контакты с конференций*\n\n' +
                'Нажмите на кнопку "💬 Написать", чтобы перейти в чат с контактом:',
                { parse_mode: 'Markdown' }
            );
            
            // Send each contact as a separate message with button
            contacts.forEach((contact, index) => {
                const isScanner = contact.scanner_id === user.id;
                const contactInfo = isScanner ? contact.manager_contact : contact.scanner_contact;
                const exchangeDate = new Date(contact.exchange_date).toLocaleDateString('ru-RU');
                
                // Get the other person's username and telegram_id
                const otherUsername = isScanner ? contact.manager_username : contact.scanner_username;
                const otherTelegramId = isScanner ? contact.manager_telegram_id : contact.scanner_telegram_id;
                
                // Format contact message
                let message = `${index + 1}. *${exchangeDate}*\n`;
                message += `${contactInfo}\n`;
                
                // Add company info if available
                if (contact.company_name) {
                    message += `🏢 Компания: ${contact.company_name}\n`;
                }
                if (contact.position) {
                    message += `💼 Должность: ${contact.position}\n`;
                }
                if (contact.comment) {
                    message += `💬 Комментарий: ${contact.comment}\n`;
                }
                
                // Create inline keyboard with "Write" button
                const keyboard = {
                    inline_keyboard: [[
                        { text: '💬 Написать', url: `https://t.me/${otherUsername || `user${otherTelegramId}`}` }
                    ]]
                };
                
                // Send message with button
                bot.sendMessage(chatId, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            });
            
            // Send footer message
            bot.sendMessage(chatId,
                '_Используйте QR-коды для быстрого обмена контактами на конференциях_',
                { parse_mode: 'Markdown' }
            );
        });
    });
}

// Generate and send user's QR code
function generateUserQrCode(chatId, telegramId) {
    // First, get user information
    db.get("SELECT id, full_name, qr_code_token FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err) {
            console.error('Error fetching user for QR code:', err);
            bot.sendMessage(chatId, '❌ Произошла ошибка при生成 QR-кода. Попробуйте еще раз.');
            return;
        }
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Пожалуйста, зарегистрируйтесь сначала.');
            return;
        }
        
        console.log(`User found for QR: ${user.full_name}, existing token: ${user.qr_code_token}`);
        
        // Generate or retrieve QR code token
        let qrToken = user.qr_code_token;
        
        if (!qrToken) {
            // Generate a new unique token
            qrToken = require('crypto').randomBytes(16).toString('hex');
            console.log(`Generated new QR token: ${qrToken} for user: ${user.id}`);
            
            // Save the token to database
            db.run("UPDATE users SET qr_code_token = ? WHERE id = ?", [qrToken, user.id], (err) => {
                if (err) {
                    console.error('Error saving QR token:', err);
                    bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении QR-кода. Попробуйте еще раз.');
                    return;
                }
                
                console.log(`QR token saved successfully for user: ${user.id}`);
                // Now generate the QR code with the token
                generateAndSendQrCode(chatId, qrToken, user.full_name);
            });
        } else {
            console.log(`Using existing QR token: ${qrToken} for user: ${user.id}`);
            // Use existing token
            generateAndSendQrCode(chatId, qrToken, user.full_name);
        }
    });
}

// Helper function to generate QR code and send it
function generateAndSendQrCode(chatId, token, fullName) {
    // Get the bot info to ensure we have the correct username
    bot.getMe().then(botInfo => {
        const botUsername = botInfo.username;
        const deepLinkUrl = `https://t.me/${botUsername}?start=${token}`;
        
        console.log(`Generating QR code with URL: ${deepLinkUrl}`);
        
        // Generate QR code with the URL as text
        qrcode.toBuffer(deepLinkUrl, {
            width: 300,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        }, (err, buffer) => {
            if (err) {
                console.error('Error generating QR code:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка при生成 QR-кода. Попробуйте еще раз.');
                return;
            }
            
            // Send the QR code image with the URL in the caption
            bot.sendPhoto(chatId, buffer, {
                caption: `🤝 *QR-код для обмена контактами*\n\n👤 *${fullName}*\n\n📷 *Другие пользователи могут отсканировать этот QR-код, чтобы добавить вас в контакты*\n\n🔗 *Ваша ссылка:*\n\`${deepLinkUrl}\`\n\n_Этот QR-код содержит вашу уникальную ссылку для быстрого обмена контактами на конференциях_`,
                parse_mode: 'Markdown'
            }).catch(error => {
                console.error('Error sending QR code photo:', error);
                bot.sendMessage(chatId, '❌ Произошла ошибка при отправке QR-кода. Попробуйте еще раз.');
            });
        });
    }).catch(err => {
        console.error('Error getting bot info:', err);
        // Fallback to environment variable
        const botUsername = process.env.BOT_USERNAME || 'partnerkin_super_bot';
        const deepLinkUrl = `https://t.me/${botUsername}?start=${token}`;
        
        bot.sendMessage(chatId, `⚠️ Не удалось получить имя бота. Используется запасной вариант.\n\n🔗 Ваша ссылка: ${deepLinkUrl}`);
    });
}

const testKeyboard = {
    reply_markup: {
        keyboard: [
            ['Онбординг в Партнеркин', 'Основы эффективной коммуникации'],
            ['Эффективная работа в режиме многозадачности', '📊 Мой прогресс'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const pvpKeyboard = {
    reply_markup: {
        keyboard: [
            ['🎯 Найти противника', '🏆 Мой рейтинг'],
            ['⚡ Восстановить энергию', '🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const shopKeyboard = {
    reply_markup: {
        keyboard: [
            ['🏖️ Выходной день (100 баллов)', '👕 Мерч компании (50 баллов)'],
            ['🎁 Секретный сюрприз (200 баллов)', '☕ Кофе в офис (25 баллов)'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const coursesKeyboard = {
    reply_markup: {
        keyboard: [
            ['Информационный стиль и редактура текста (+100 💰)'],
            ['Тайм-менеджмент (+100 💰)'],
            ['Стресс-менеджмент (+100 💰)'],
            ['Work-Life balance: профилактика эмоционального выгорания (+100 💰)'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const eventsKeyboard = {
    reply_markup: {
        keyboard: [
            ['🏃‍♂️ Зарядка', '🎰 Покер'],
            ['🎉 Корпоратив', '📚 Тренинги'],
            ['📅 Все мероприятия', '🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const adminKeyboard = {
    reply_markup: {
        keyboard: [
            ['🗓️ Мероприятия', '📢 Рассылка'],
            ['👥 Пользователи', '📊 Статистика'],
            ['💰 Управление балансом', '🎉 Достижения'],
            ['📇 Контакты', '🐞 Баги'],
            ['🔙 Выйти из админки']
        ],
        resize_keyboard: true
    }
};

// Sub-menus for admin
const adminEventsKeyboard = {
    reply_markup: {
        keyboard: [
            ['🗓️ Создать мероприятие', '📅 Все мероприятия'],
            ['✏️ Редактировать слот', '🗑️ Удалить слот'],
            ['🔙 В админку']
        ],
        resize_keyboard: true
    }
};

const adminUsersKeyboard = {
    reply_markup: {
        keyboard: [
            ['👥 Пользователи', '📋 Заявки на проверку'],
            ['🎓 Назначить наставника', '🏖️ Управление отпусками'],
            ['🗑️ Удалить пользователя', '🔙 В админку']
        ],
        resize_keyboard: true
    }
};

// Клавиатуры для системы отпусков
const vacationKeyboard = {
    reply_markup: {
        keyboard: [
            ['📝 Подать заявку', '📋 Мои заявки'],
            ['📊 Остаток дней'],
            ['🔙 В личное меню']
        ],
        resize_keyboard: true
    }
};

const adminVacationKeyboard = {
    reply_markup: {
        keyboard: [
            ['✅ Одобрить заявку', '❌ Отклонить заявку'],
            ['📋 Все заявки', '📅 Календарь команды'],
            ['👥 Балансы сотрудников', '📊 Статистика отпусков'],
            ['🔙 В управление пользователями']
        ],
        resize_keyboard: true
    }
};

const vacationDurationKeyboard = {
    reply_markup: {
        keyboard: [
            ['7️⃣ 7 дней', '📅 14 дней', '🗓️ 28 дней'],
            ['✏️ Другое (указать дату окончания)'],
            ['❌ Отмена']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};

const taskCreationTypeKeyboard = {
    reply_markup: {
        keyboard: [
            ['📝 Создать свою задачу'],
            ['📁 Выбрать из шаблонов'],
            ['🔙 Назад к задачам']
        ],
        resize_keyboard: true
    }
};

const taskTemplatesKeyboard = {
    reply_markup: {
        keyboard: [
            ['Отправить пост редактору'],
            ['🔙 Назад']
        ],
        resize_keyboard: true
    }
};

const positionLevelKeyboard = {
    reply_markup: {
        keyboard: [
            ['Middle', 'Head'],
            ['Senior', 'C-Level'],
            ['🔙 Назад']
        ],
        resize_keyboard: true,
        one_time_keyboard: true
    }
};


const tasksKeyboard = {
    reply_markup: {
        keyboard: [
            ['📝 Мои задачи', '✅ Завершенные'],
            ['🎯 Создать задачу', '👥 Задачи команды'],
            ['📦 Отложенные', '❌ Отмененные'],
            ['🔙 Назад в меню']
        ],
        resize_keyboard: true
    }
};

const broadcastKeyboard = {
    reply_markup: {
        keyboard: [
            ['👥 Всем пользователям', '🧓 Только старичкам'],
            ['👶 Только стажерам', '📊 Выборочно'],
            ['🔙 Назад в админку']
        ],
        resize_keyboard: true
    }
};

const balanceKeyboard = {
    reply_markup: {
        keyboard: [
            ['➕ Начислить баллы', '➖ Списать баллы'],
            ['👥 Список пользователей', '📊 Балансы'],
            ['🔙 Назад в админку']
        ],
        resize_keyboard: true
    }
};

const taskPriorityKeyboard = {
    reply_markup: {
        keyboard: [
            ['🔴 Высокий', '🟡 Средний', '🟢 Низкий'],
            ['❌ Отмена']
        ],
        resize_keyboard: true
    }
};

const taskRewardKeyboard = {
    reply_markup: {
        keyboard: [
            ['0 коинов', '50 коинов', '100 коинов'],
            ['150 коинов', '200 коинов', '250 коинов'],
            ['❌ Отмена']
        ],
        resize_keyboard: true
    }
};

// Клавиатура для действий с задачей (исполнитель)
const taskActionKeyboard = {
    reply_markup: {
        keyboard: [
            ['✅ Принять', '💬 Комментировать'],
            ['📦 Отложить', '❌ Отменить'],
            ['🔙 Назад к задачам']
        ],
        resize_keyboard: true
    }
};

// Клавиатура для действий создателя задачи после комментария
const taskCreatorActionKeyboard = {
    reply_markup: {
        keyboard: [
            ['🔄 Отправить дальше', '📦 Оставить как есть'],
            ['❌ Отменить задачу', '🔙 Назад']
        ],
        resize_keyboard: true
    }
};

// Клавиатуры для создания мероприятий
const eventCategoryKeyboard = {
    reply_markup: {
        keyboard: [
            ['🏃‍♂️ Зарядка', '🎰 Покер'],
            ['🎉 Корпоратив', '📚 Тренинги'],
            ['❌ Отмена']
        ],
        resize_keyboard: true
    }
};

// ========== ОСНОВНЫЕ КОМАНДЫ ==========

bot.onText(/\/start(?: (.+))?/, (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || 'user';
    const startPayload = match ? match[1] : null; // Get the payload

    // [START LOG] Логирование команды /start
    const currentTime = new Date().toLocaleString('ru-RU');
    db.get("SELECT full_name, role, is_registered FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        const userInfo = user ? `${user.full_name} (${user.role})` : `@${username}`;
        const status = user && user.is_registered ? 'returning user' : 'new user';
        console.log(`\n🚀 [${currentTime}] START COMMAND:`);
        console.log(`👤 User: ${userInfo} (ID: ${telegramId})`);
        console.log(`🏷️ Status: ${status}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    });

    // [DEBUG LOG] Clear any active state on /start
    if (global.userScreenshots[telegramId]) {
        console.log(`[START DEBUG] Clearing state for user ${telegramId}: ${JSON.stringify({type: global.userScreenshots[telegramId].type, step: global.userScreenshots[telegramId].step})}`);
        delete global.userScreenshots[telegramId];
    }
    
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err) {
                console.log('❌ DB Error:', err);
                return;
            }

            if (user && user.is_external === 1) {
                bot.sendMessage(chatId, "У вас нет доступа к функциям бота.");
                return;
            }

            if (startPayload) { // If there's a payload, it's a deep link
                // Check if it's a QR code token
                console.log(`Looking for user with QR token: ${startPayload}`);
                db.get("SELECT id, telegram_id, full_name FROM users WHERE qr_code_token = ?", [startPayload], (err, manager) => {
                    if (err) {
                        console.error('Error looking up QR token:', err);
                        bot.sendMessage(chatId, '❌ Ошибка при поиске QR-кода. Попробуйте еще раз.');
                        return;
                    }
                    
                    if (!manager) {
                        console.log(`No user found with QR token: ${startPayload}`);
                        bot.sendMessage(chatId, '❌ Неверный QR-код или коллега не найден.');
                        return;
                    }
                    
                    console.log(`Found user with QR token: ${manager.full_name} (ID: ${manager.telegram_id})`);

                    // If the scanner is the manager themselves, just show their QR again
                    if (manager.telegram_id === telegramId) {
                        bot.sendMessage(chatId, 'Вы отсканировали свой собственный QR-код. Покажите его коллегам:', {
                            reply_markup: {
                                inline_keyboard: [[{ text: '🤝 Мой QR-код', callback_data: 'generate_my_qr' }]]
                            }
                        });
                        return;
                    }

                    // Set state for the new contact (scanner)
                    global.userScreenshots[telegramId] = {
                        type: 'contact_exchange',
                        step: 'awaiting_contact_share',
                        managerId: manager.id,
                        managerTelegramId: manager.telegram_id,
                        managerFullName: manager.full_name
                    };

                    const message = `Здравствуйте! Вы хотите связаться с **${manager.full_name}** из "Partnerkin.com".\n\n` +
                                    `Нажмите кнопку ниже, чтобы поделиться вашими контактными данными и начать общение.`;

                    const keyboard = {
                        keyboard: [[{ text: '📲 Отправить мой контакт', request_contact: true }]],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    };

                    bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
                });
            } else if (user && user.is_registered === 1) {
                showMainMenu(chatId, user);
            } else {
                bot.sendMessage(chatId,
                    'Привет! Я — корпоративный бот «Жизнь в Партнеркине». 🚀\n\n' +
                    'Я был создан, чтобы сделать нашу рабочую жизнь интереснее и проще. Здесь ты сможешь выполнять задачи, записываться на мероприятия, соревноваться с коллегами в рейтинге, зарабатывать П-коины и обменивать их на реальные «баллы» для получения бонусов!\n\n' +
                    'Для начала, давай познакомимся. Кто ты в нашей команде? 👇',
                    startKeyboard).catch(console.error);
            }
        });
    } catch (error) {
        console.error('❌ Start command error:', error);
    }
});

bot.onText(/\/cleanup/, (msg) => {
    const chatId = msg.chat.id;
    const requesterId = msg.from.id;

    // Authorize any admin
    db.get("SELECT * FROM admins WHERE telegram_id = ?", [requesterId], (err, admin) => {
        if (err || !admin) {
            bot.sendMessage(chatId, "❌ У вас нет прав на выполнение этой команды. Сначала войдите в админку.");
            return;
        }

        bot.sendMessage(chatId, "⚠️ **НАЧАТА ПОЛНАЯ ОЧИСТКА БАЗЫ ДАННЫХ!** ⚠️\n\nБот будет недоступен в течение нескольких секунд.", { parse_mode: 'Markdown' });

        const tablesToTruncate = [
            'admins', 'achievement_comments', 'achievement_likes', 'achievements', 'battles', 
            'bug_reports', 'company_contacts', 'conference_contacts', 'event_bookings', 
            'event_slots', 'exchange_history', 'gifts', 'intern_progress', 'invoices', 
            'pcoin_requests', 'purchases', 'task_comments', 'tasks', 'test_submissions', 
            'vacation_balances', 'vacation_requests', 'users'
        ];

        const query = `TRUNCATE TABLE ${tablesToTruncate.join(', ')} RESTART IDENTITY CASCADE;`;

        // Use the existing, working db connection object
        db.run(query, [], (err) => {
            if (err) {
                console.error('❌❌❌ DATABASE CLEANUP FAILED ❌❌❌', err);
                bot.sendMessage(chatId, `❌ Произошла ошибка во время очистки: ${err.message}`);
            } else {
                console.log('✅✅✅ DATABASE CLEANUP SUCCESSFUL ✅✅✅');
                bot.sendMessage(chatId, "✅ База данных успешно очищена. Перезапускаю бота...").then(() => {
                    // Exit to allow process manager to restart
                    process.exit(1);
                });
            }
        });
    });
});

// ========== ОБРАБОТКА СООБЩЕНИЙ ==========

bot.on('message', (msg) => {
    try {
        const chatId = msg.chat.id;
        const text = msg.text;
        const telegramId = msg.from.id;
        const username = msg.from.username || 'user';

        // DUPLICATE PREVENTION: Check if this button action was recently processed
        if (text && (text.startsWith('📋') || text.startsWith('🔙') || text.startsWith('🎓') || text.startsWith('📊') || text.startsWith('🔄'))) {
            const actionKey = `${telegramId}_${text}`;
            const now = Date.now();
            if (global.lastActionTimes && global.lastActionTimes[actionKey] && (now - global.lastActionTimes[actionKey] < 1000)) {
                console.log(`[DUPLICATE PREVENTION] Ignoring duplicate message action: ${actionKey} (${now - global.lastActionTimes[actionKey]}ms ago)`);
                return;
            }
            
            // Initialize global action tracking if not exists
            if (!global.lastActionTimes) {
                global.lastActionTimes = {};
            }
            global.lastActionTimes[actionKey] = now;
        }

        // [USER ACTION LOG] Подробное логирование действий пользователя
        const currentState = global.userScreenshots[telegramId];
        const currentTime = new Date().toLocaleString('ru-RU');

        if (msg.document && currentState && currentState.type === 'import_contacts' && currentState.step === 'awaiting_file') {
            const fileId = msg.document.file_id;
            const mimeType = msg.document.mime_type;

            if (mimeType !== 'text/csv' && mimeType !== 'text/plain' && mimeType !== 'application/vnd.ms-excel') {
                bot.sendMessage(chatId, '❌ Неверный формат файла. Пожалуйста, загрузите файл в формате CSV.');
                return;
            }

            bot.sendMessage(chatId, '⏳ Файл получен. Начинаю обработку...');

            bot.getFile(fileId).then((fileInfo) => {
                const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
                
                require('request')(fileUrl, (error, response, body) => {
                    if (error || response.statusCode !== 200) {
                        bot.sendMessage(chatId, '❌ Ошибка загрузки файла с серверов Telegram.');
                        console.error('File download error:', error);
                        return;
                    }

                    try {
                        const records = parse(body, {
                            skip_empty_lines: true
                        });

                        if (records.length === 0) {
                            bot.sendMessage(chatId, '⚠️ Файл пуст или имеет неверный формат.');
                            return;
                        }

                        const stmt = db.prepare(`INSERT INTO company_contacts 
                            (company_name, contact_name, position, email, phone, telegram, notes, added_by) 
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                        
                        let successCount = 0;
                        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, adminUser) => {
                            if (err || !adminUser) {
                                bot.sendMessage(chatId, '❌ Ошибка идентификации администратора.');
                                return;
                            }

                            records.forEach(record => {
                                const [
                                    company_name = null, 
                                    contact_name = null, 
                                    position = null, 
                                    email = null, 
                                    phone = null, 
                                    telegram = null, 
                                    notes = null
                                ] = record;

                                if (company_name && contact_name) { // Basic validation
                                    stmt.run(company_name, contact_name, position, email, phone, telegram, notes, adminUser.id);
                                    successCount++;
                                }
                            });

                            stmt.finalize((err) => {
                                if (err) {
                                    bot.sendMessage(chatId, `❌ Произошла ошибка при записи в базу данных: ${err.message}`);
                                } else {
                                    bot.sendMessage(chatId, `✅ Импорт завершен!\n\n- Обработано строк: ${records.length}\n- Успешно добавлено контактов: ${successCount}`);
                                }
                                delete global.userScreenshots[telegramId];
                            });
                        });

                    } catch (e) {
                        bot.sendMessage(chatId, `❌ Ошибка обработки CSV файла: ${e.message}`);
                        console.error('CSV parsing error:', e);
                        delete global.userScreenshots[telegramId];
                    }
                });
            });
            return;
        }


        db.get("SELECT full_name, role FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            const userInfo = user ? `${user.full_name} (${user.role})` : `@${username}`;
            console.log(`\n🔔 [${currentTime}] USER ACTION:`);
            console.log(`👤 User: ${userInfo} (ID: ${telegramId})`);
            console.log(`💬 Message: "${text}"`);
            console.log(`📍 State: ${currentState ? JSON.stringify({type: currentState.type, step: currentState.step}) : 'none'}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        });

        // Автоматическое обновление активности пользователя
        updateUserActivity(telegramId);



        if (text && text.startsWith('/')) return;
        
        // Обработка фото для рассылки (если админ в режиме broadcast и ожидает медиа)
        if (msg.photo && global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'broadcast' && global.userScreenshots[telegramId].step === 'media') {
            const fileId = msg.photo[msg.photo.length - 1].file_id;
            global.userScreenshots[telegramId].media.push({ type: 'photo', media: fileId });
            console.log(`[BROADCAST LOG] Admin ${telegramId} added photo to broadcast media. Total media: ${global.userScreenshots[telegramId].media.length}`);
            bot.sendMessage(chatId, `📸 Фото добавлено! (${global.userScreenshots[telegramId].media.length} шт.)\nОтправь еще или напиши "готово".`).catch(console.error);
            return;
        }

        if (msg.photo || msg.video) {
            const state = global.userScreenshots[telegramId];
            if (state && state.type === 'bug_report' && state.step === 'send_media') {
                const media_file_id = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.video.file_id;
                const media_type = msg.photo ? 'photo' : 'video';

                db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                    if (err || !user) {
                        bot.sendMessage(chatId, '❌ Ошибка пользователя!');
                        return;
                    }

                    db.run(`INSERT INTO bug_reports (user_id, description, media_file_id, media_type)
                            VALUES (?, ?, ?, ?)`,
                           [user.id, state.description, media_file_id, media_type], function() {
                        
                        bot.sendMessage(chatId, '✅ Спасибо! Ваш отчет о баге отправлен на рассмотрение.');
                        
                        notifyAdminsOfBugReport(user, state.description, this.lastID);

                        delete global.userScreenshots[telegramId];
                    });
                });
                return;
            }

            if (state && state.type === 'task_from_template' && state.step === 'send_post') {
                state.taskData.description = msg.caption || '';
                if (msg.photo) {
                    state.taskData.media = msg.photo[msg.photo.length - 1].file_id;
                    state.taskData.media_type = 'photo';
                } else if (msg.video) {
                    state.taskData.media = msg.video.file_id;
                    state.taskData.media_type = 'video';
                }
                state.step = 'enter_due_date';
                bot.sendMessage(chatId, '✅ Пост получен. Укажите дату и, если нужно, время выполнения задачи (например, 25.12.2024 15:00). Для отмены напишите "отмена".');
                return;
            }

            if (msg.photo) {
                const currentTime = new Date().toLocaleString('ru-RU');
                db.get("SELECT full_name, role FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                    const userInfo = user ? `${user.full_name} (${user.role})` : `@${username}`;
                    console.log(`\n📸 [${currentTime}] PHOTO UPLOADED:`);
                    console.log(`👤 User: ${userInfo} (ID: ${telegramId})`);
                    console.log(`🏷️ Context: ${state ? state.type : 'none'}`);
                    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                });
                handleScreenshot(chatId, telegramId, msg.photo[msg.photo.length - 1].file_id, username);
            }
            return;
        }
        
        // Handle contact sharing for QR code exchange
        if (msg.contact && currentState && currentState.type === 'contact_exchange' && currentState.step === 'awaiting_contact_share') {
            handleContactExchange(chatId, telegramId, msg.contact, currentState, username);
            return;
        }
        
        if (!text) return;

        // DEBUG LOG FOR MAIN MENU BUTTON
        if (text && text.includes('Главное меню')) {
            console.log(`[BUTTON DEBUG] Main menu button pressed by user ${telegramId}: exact text="${text}"`);
        }
        
        // РЕГИСТРАЦИЯ
        if (text === '👶 Я стажер') {
            registerUser(chatId, telegramId, username, 'стажер');
            return;
        } 
        if (text === '🧓 Я старичок') {
            registerUser(chatId, telegramId, username, 'старичок');
            return;
        }

        if (text === '🔙 Назад к выбору роли') {
            const currentState = global.userScreenshots[telegramId];
            if (currentState && currentState.type === 'registration' && currentState.step === 'enter_name') {
                delete global.userScreenshots[telegramId];
                db.run("DELETE FROM users WHERE telegram_id = ?", [telegramId], (err) => {
                    if (err) {
                        console.error('Error deleting user on registration back:', err);
                        bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте /start');
                        return;
                    }
                    bot.sendMessage(chatId,
                        '🎉 Добро пожаловать в "Жизнь в Партнеркине"! 🚀\n\n' +
                        '💫 Кто ты в нашей команде? 👇',
                        startKeyboard).catch(console.error);
                });
            }
            return;
        }
        
        // ВХОД В АДМИНКУ
        if (text === config.ADMIN.password) {
            handleAdminLogin(chatId, telegramId);
        }
        
// ========== ФУНКЦИИ МЕРОПРИЯТИЙ ==========

function showAvailableEvents(chatId, telegramId) {
    try {
        db.all("SELECT * FROM event_slots WHERE status = 'active' ORDER BY date, time", (err, slots) => {
            if (!slots || slots.length === 0) {
                bot.sendMessage(chatId,
                    '📅 МЕРОПРИЯТИЯ 📋\n\n' +
                    '📋 Мероприятий пока нет!\n\n' +
                    '🎯 Следи за обновлениями!').catch(console.error);
                return;
            }

            let eventsText = '📅 ДОСТУПНЫЕ МЕРОПРИЯТИЯ 📋\n\n';

            slots.forEach((slot, index) => {
                eventsText += `${index + 1}. ${slot.event_name}\n`;
                eventsText += `   📅 ${slot.date} в ${slot.time}\n`;
                eventsText += `   📍 ${slot.location}\n`;
                eventsText += `   👥 ${slot.current_participants}/${slot.max_participants}\n`;
                eventsText += `   💰 ${slot.points_reward} коинов\n\n`;
            });

            eventsText += '👇 Выбери мероприятие по номеру или используй кнопки категорий:';

            global.userScreenshots[telegramId] = {
                type: 'event_selection',
                events: slots
            };

            const categoryKeyboard = {
                keyboard: [
                    ['Зарядка', 'Покер'],
                    ['Корпоратив', 'Тренинги'],
                    ['🔙 Назад в меню']
                ],
                resize_keyboard: true
            };

            bot.sendMessage(chatId, eventsText, categoryKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show available events error:', error);
    }
}

function handleEventSelection(chatId, telegramId, text) {
    try {
        const eventData = global.userScreenshots[telegramId];
        const eventIndex = parseInt(text) - 1;

        if (isNaN(eventIndex) || eventIndex < 0 || eventIndex >= eventData.events.length) {
            bot.sendMessage(chatId, '❌ Неверный номер мероприятия!').catch(console.error);
            return;
        }

        const selectedEvent = eventData.events[eventIndex];
        showEventDetails(chatId, telegramId, selectedEvent);
        delete global.userScreenshots[telegramId];
    } catch (error) {
        console.error('❌ Handle event selection error:', error);
    }
}

function showEventDetails(chatId, telegramId, event) {
    try {
        const signupKeyboard = {
            keyboard: [
                ['📅 Записаться на ' + event.event_name],
                ['🔙 Назад к мероприятиям']
            ],
            resize_keyboard: true
        };

        bot.sendMessage(chatId,
            `🎯 МЕРОПРИЯТИЕ: ${event.event_name}\n\n` +
            `📅 Дата: ${event.date}\n` +
            `⏰ Время: ${event.time}\n` +
            `📍 Место: ${event.location}\n` +
            `👥 Участников: ${event.current_participants}/${event.max_participants}\n` +
            `💰 Награда: ${event.points_reward} П-коинов\n\n` +
            '👇 Хочешь записаться?', signupKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Show event details error:', error);
    }
         }

         if (text === '📅 Мероприятия') {
             showAvailableEvents(chatId, telegramId);
         }
         if (text === '🔙 Назад к мероприятиям') {
             showAvailableEvents(chatId, telegramId);
         }
         if (text.startsWith('📅 Записаться на ')) {
             const eventName = text.replace('📅 Записаться на ', '');
             handleEventSignup(chatId, telegramId, eventName);
             delete global.userScreenshots[telegramId];
         }

         // ========== МЕРОПРИЯТИЯ (CONSOLIDATED HANDLER) ==========
         if (text === '📅 Все мероприятия') {
             console.log(`[DEBUG FIRST HANDLER] All events triggered for user ${telegramId}, admin check starting`);
             // Clear event booking state if active
             if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'event_booking') {
                 delete global.userScreenshots[telegramId];
             }
             // Branch based on admin status
             db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                 console.log(`[DEBUG FIRST HANDLER] Admin check result for ${telegramId}: ${admin ? 'Admin' : 'Non-admin'}`);
                 if (admin) {
                     console.log(`[DEBUG FIRST HANDLER] Calling showAllEventSlotsAdmin for ${telegramId}`);
                     showAllEventSlotsAdmin(chatId, telegramId);
                 } else {
                     console.log(`[DEBUG FIRST HANDLER] Calling showAllEventSlots for ${telegramId}`);
                     showAllEventSlots(chatId);
                 }
             });
         }

         // ========== АДМИНСКИЕ ФУНКЦИИ ==========
         if (text === '🗓️ Создать мероприятие') {
             startEventCreation(chatId, telegramId);
         }
         if (text === '✏️ Редактировать слот') {
             startSlotEdit(chatId, telegramId);
         }
         if (text === '🗑️ Удалить слот') {
             startSlotDelete(chatId, telegramId);
         }
         if (text === '📢 Рассылка') {
             startBroadcast(chatId, telegramId);
         }
         if (text === '📋 Заявки на проверку') {
             showTestSubmissions(chatId, telegramId);
         }
         if (text === '👥 Пользователи') {
             showUsersList(chatId, telegramId);
         }
         if (text === '📊 Статистика') {
             showAdminStats(chatId, telegramId);
         }
         if (text === '💰 Управление балансом') {
             showBalanceManagement(chatId, telegramId);
         }
         if (text === '🎉 Достижения') {
             showAchievementsAdmin(chatId, telegramId);
         }
         if (text === '📇 Контакты') {
             showContactsAdmin(chatId, telegramId);
         } else if (text === '📥 Импорт CSV') {
             startCsvImport(chatId, telegramId);
             return;
         } else if (text === '🐞 Баги') {
             showBugReports(chatId, telegramId);
         }
         if (text === '🔙 Назад в админку') {
             backToAdminMenu(chatId, telegramId);
         }

         // ========== УПРАВЛЕНИЕ БАЛАНСОМ ==========
         else if (text === '➕ Начислить баллы') {
             startAddCoins(chatId, telegramId);
         }
         else if (text === '➖ Списать баллы') {
             startDeductCoins(chatId, telegramId);
         }
         else if (text === '👥 Список пользователей') {
             showUsersList(chatId, telegramId);
         }
         else if (text === '📊 Балансы') {
             showBalances(chatId, telegramId);
         }
        // ========== КОНТАКТЫ АДМИН ==========
        else if (text === '➕ Добавить контакт') {
            startAddContact(chatId, telegramId);
            return;
        }
        else if (text === '📋 Все контакты') {
            showAllContacts(chatId, telegramId);
        }
        else if (text === '✏️ Редактировать контакт') {
            startEditContact(chatId, telegramId);
            return;
        }
        else if (text === '🗑️ Удалить контакт') {
            startDeleteContact(chatId, telegramId);
            return;
        }
        // ========== СТАТУСЫ СОТРУДНИКОВ ==========
        else if (text === '🟢 Онлайн') {
            changeUserStatus(chatId, telegramId, 'online');
            return;
        }
        else if (text === '🟡 Не на месте') {
            changeUserStatus(chatId, telegramId, 'away');
            return;
        }
        else if (text === '🔴 Не беспокоить') {
            changeUserStatus(chatId, telegramId, 'busy');
            return;
        }
        else if (text === '⚫ Оффлайн') {
            changeUserStatus(chatId, telegramId, 'offline');
            return;
        }
        else if (text === '✏️ Изменить сообщение') {
            startStatusMessage(chatId, telegramId);
            return;
        }
        else if (text === '📊 Мой текущий статус') {
            showCurrentStatus(chatId, telegramId);
        }
        else if (text === '🔙 Выйти из админки') {
            exitAdminMode(chatId, telegramId);
        }

        // ========== NEW CATEGORY HANDLERS ==========
        // Main menu categories
        if (text === '💰 Личное') {
            showPersonalMenu(chatId);
        } else if (text === '🎓 Обучение') {
            showLearningMenu(chatId);
        } else if (text === '📋 Работа') {
            showWorkMenu(chatId, telegramId);
        } else if (text === '📄 Создать инвойс') {
            db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                if (err || !user) {
                    bot.sendMessage(chatId, '❌ Ошибка!').catch(console.error);
                    return;
                }
                // Assume for all users, or check role if needed
                global.userScreenshots[telegramId] = {
                    type: 'invoice_creation',
                    step: 'org_name',
                    data: {}
                };
                bot.sendMessage(chatId, "📄 Создание инвойса. Шаг 1: Название организации? (Введите на английском для PDF)").catch(console.error);
            });
        } else if (text === '📇 Поиск контактов') {
            startContactSearch(chatId, telegramId);
            return;
        } else if (text === '👥 Команда') {
            showTeamMenu(chatId);
            return;
        } else if (text === '📱 Я на конфе') {
            showQrContactsMenu(chatId, telegramId);
            return;
        } else if (text === '➕ Добавить контакт') {
            startAddContact(chatId, telegramId);
            return;
        } else if (text === '👥 Сотрудники онлайн') {
            showEmployeesOnline(chatId, telegramId);
            return;
        } else if (text === '⚡ Мой статус') {
            showStatusMenu(chatId, telegramId);
            return;
        } else if (text === '📱 Мой QR-код') {
            generateUserQrCode(chatId, telegramId);
            return;
        } else if (text === '🔍 Скан коллеги') {
            bot.sendMessage(chatId, '📷 Отправьте QR-код коллеги для сканирования', qrContactsKeyboard);
            return;
        } else if (text === '📇 Контакты с конфы') {
            showMyContacts(chatId, telegramId);
            return;
        } else if (text === '🔙 Назад в работу') {
            showWorkMenu(chatId, telegramId);
            return;
        } else if (text === '🎮 Развлечения') {
            showFunMenu(chatId);
        }

        // Admin categories
        if (text === '🗓️ Мероприятия') {
            showAdminEventsMenu(chatId);
        } else if (text === '📢 Рассылка') {
            startBroadcast(chatId, telegramId);
        } else if (text === '👥 Пользователи') {
            showAdminUsersMenu(chatId);
        } else if (text === '🎓 Назначить наставника') {
            startMentorAssignment(chatId, telegramId);
            return;
        } else if (text === '🗑️ Удалить пользователя') {
            startUserDeletion(chatId, telegramId);
            return;
        } else if (text === '📊 Статистика') {
            showAdminStats(chatId, telegramId);
        } else if (text === '🏖️ Управление отпусками') {
            showAdminVacationMenu(chatId, telegramId);
        } else if (text === '✅ Одобрить заявку') {
            showPendingVacationRequestsForApproval(chatId);
        } else if (text === '❌ Отклонить заявку') {
            showPendingVacationRequestsForRejection(chatId);
        } else if (text === '📋 Все заявки') {
            showAdminVacationRequests(chatId, telegramId);
        } else if (text === '📅 Календарь команды') {
            showTeamVacationCalendar(chatId, telegramId);
        } else if (text === '👥 Балансы сотрудников') {
            showEmployeeBalances(chatId, telegramId);
        } else if (text === '📊 Статистика отпусков') {
            showVacationStats(chatId, telegramId);
        } else if (text === '🔙 В управление пользователями') {
            showAdminUsersMenu(chatId);
        } else if (text === '🔙 В админку') {
            backToAdminMenu(chatId, telegramId);
        } else if (text === '🔙 В личное меню') {
            showPersonalMenu(chatId);
        }
        
        // ========== ОСНОВНОЕ МЕНЮ ==========
        if (text === '💰 Мой баланс') {
            showBalance(chatId, telegramId);
        }
        if (text === '🏖️ Отпуски') {
            showVacationMenu(chatId, telegramId);
        }
        if (text === '📚 Пройти тестирование') {
            showTestMenu(chatId);
        }
        if (text === '📊 Мой прогресс') {
            showInternProgress(chatId, telegramId);
        }
        if (text === '🔄 Главное меню' || text === '🔙 В главное меню' || text === '🔙 Главное меню') {
            console.log(`[NAV DEBUG] Direct main menu trigger for user ${telegramId} (text: "${text}")`);
            backToMainMenu(chatId, telegramId);
            return;
        }
        if (text === '👤 Мой профиль') {
            console.log(`[NAV DEBUG] Profile button pressed for user ${telegramId}`);
            backToMainMenu(chatId, telegramId);
            return;
        } else if (text === '🐞 Сообщить о баге') {
            startBugReport(chatId, telegramId);
            return;
        } else if (text === '🔙 Назад в меню') {
            console.log(`[NAV DEBUG] Back to menu button pressed for user ${telegramId}, context: ${JSON.stringify(global.userMenuContext[chatId] || 'none')}`);
            handleBackNavigation(chatId, telegramId);
            return;
        }
        
        // ========== ТЕСТЫ ДЛЯ СТАЖЕРОВ ==========
        if (text === 'Онбординг в Партнеркин' || text === 'Онбординг в Партнеркин (+100 💰)') {
            selectTest(chatId, telegramId, 'Онбординг в Партнеркин', 100, 'https://partnerkin.com/courses/onboarding');
        }
        if (text === 'Основы эффективной коммуникации' || text === 'Основы эффективной коммуникации (+100 💰)') {
            selectTest(chatId, telegramId, 'Основы эффективной коммуникации', 100, 'https://partnerkin.com/courses/communication');
        }
        if (text === 'Эффективная работа в режиме многозадачности' || text === 'Эффективная работа в режиме многозадачности (+100 💰)') {
            selectTest(chatId, telegramId, 'Эффективная работа в режиме многозадачности', 100, 'https://partnerkin.com/courses/multitasking');
        }

        // ========== ТЕСТЫ ДЛЯ СТАРИЧКОВ ==========
        if (text === 'Информационный стиль и редактура текста' || text === 'Информационный стиль и редактура текста (+100 💰)') {
            selectCourse(chatId, telegramId, 'Информационный стиль и редактура текста', 100, 'https://partnerkin.com/courses/info-style');
        }
        if (text === 'Тайм-менеджмент' || text === 'Тайм-менеджмент (+100 💰)') {
            selectCourse(chatId, telegramId, 'Тайм-менеджмент', 100, 'https://partnerkin.com/courses/time-management');
        }
        if (text === 'Стресс-менеджмент' || text === 'Стресс-менеджмент (+100 💰)') {
            selectCourse(chatId, telegramId, 'Стресс-менеджмент', 100, 'https://partnerkin.com/courses/stress-management');
        }
        if (text === 'Work-Life balance: профилактика эмоционального выгорания' || text === 'Work-Life balance: профилактика эмоционального выгорания (+100 💰)') {
            selectCourse(chatId, telegramId, 'Work-Life balance: профилактика эмоционального выгорания', 100, 'https://partnerkin.com/courses/work-life-balance');
        }

        // ========== ФУНКЦИИ ДЛЯ СТАРИЧКОВ ==========
        if (text === '⚔️ PVP Сражения') {
            showPVPMenu(chatId, telegramId);
        }
        if (text === '🛒 Магазин') {
            showShop(chatId, telegramId);
        }
        if (text === '🎓 Курсы') {
            showCoursesMenu(chatId);
        }
        if (text === '🎯 Мероприятия') {
            showEventsMenu(chatId);
        }
        if (text === '📋 Задачи') {
            showTasksMenu(chatId, telegramId);
        }

        if (text === '👛 Мой кошелек') {
            showWallet(chatId, telegramId);
            return;
        }
        if (text === '💸 Отправить П-коины') {
            startGiftPcoins(chatId, telegramId);
            return;
        }
        if (text === '🔄 Обмен на баллы') {
            startExchange(chatId, telegramId);
            return;
        }
        if (text === '⛏ Майнинг ферма') {
            showMiningFarm(chatId, telegramId);
            return;
        }
        if (text === '📜 История операций') {
            showTransactionHistory(chatId, telegramId);
            return;
        }
        if (text === '🔙 Назад в развлечения') {
            showFunMenu(chatId);
            return;
        }
        if (text === '🏆 Рейтинг') {
            showRating(chatId, telegramId);
        }

        // ========== СИСТЕМА ОТПУСКОВ ==========
        if (text === '📝 Подать заявку') {
            startVacationRequest(chatId, telegramId);
            return;
        }
        if (text === '📋 Мои заявки') {
            showUserVacationRequests(chatId, telegramId);
            return;
        }
        if (text === '📊 Остаток дней') {
            showVacationMenu(chatId, telegramId);
            return;
        }
        if (text === '🎉 Похвастаться') {
            startAchievementCreation(chatId, telegramId);
            return;
        }

        // ========== PVP МЕНЮ ==========
        if (text === '🎯 Найти противника') {
            findOpponent(chatId, telegramId);
        }
        if (text === '🏆 Мой рейтинг') {
            showRating(chatId, telegramId);
        }
        if (text === '⚡ Восстановить энергию') {
            restoreEnergy(chatId, telegramId);
        }
        
        // ========== КУРСЫ ==========
        // Note: Course handlers are now consolidated in the "ТЕСТЫ ДЛЯ СТАРИЧКОВ" section above to prevent duplicates
        
        // ========== МАГАЗИН ==========
        else if (text.includes('🏖️ Выходной день')) {
            buyItem(chatId, telegramId, 'Выходной день', 100);
        }
        else if (text.includes('👕 Мерч компании')) {
            buyItem(chatId, telegramId, 'Мерч компании', 50);
        }
        else if (text.includes('🎁 Секретный сюрприз')) {
            buyItem(chatId, telegramId, 'Секретный сюрприз', 200);
        }
        else if (text.includes('☕ Кофе в офис')) {
            buyItem(chatId, telegramId, 'Кофе в офис', 25);
        }
        
        // ========== МЕРОПРИЯТИЯ ==========
        else if (text === '🏃‍♂️ Зарядка' || text === 'Зарядка') {
            // Проверяем, не в админке ли пользователь
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                if (admin && global.adminStates[telegramId]) {
                    // Админ в процессе создания мероприятия
                    handleAdminEventCreation(chatId, telegramId, text);
                } else {
                    // Обычный пользователь смотрит мероприятия
                    showEventSlots(chatId, telegramId, 'Зарядка');
                }
            });
            return;
        }
        else if (text === '🎰 Покер' || text === 'Покер') {
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                if (admin && global.adminStates[telegramId]) {
                    handleAdminEventCreation(chatId, telegramId, text);
                } else {
                    showEventSlots(chatId, telegramId, 'Покер');
                }
            });
            return;
        }
        else if (text === '🎉 Корпоратив' || text === 'Корпоратив') {
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                if (admin && global.adminStates[telegramId]) {
                    handleAdminEventCreation(chatId, telegramId, text);
                } else {
                    showEventSlots(chatId, telegramId, 'Корпоратив');
                }
            });
            return;
        }
        else if (text === '📚 Тренинги' || text === 'Тренинги') {
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                if (admin && global.adminStates[telegramId]) {
                    handleAdminEventCreation(chatId, telegramId, text);
                } else {
                    showEventSlots(chatId, telegramId, 'Тренинги');
                }
            });
            return;
        }
        // REMOVED DUPLICATE HANDLER FOR '📅 Все мероприятия' - handled in first block to prevent duplicates

        // ========== РАССЫЛКИ (АДМИН) ==========
        if (text === '👥 Всем пользователям') {
            setBroadcastTarget(chatId, telegramId, 'all');
        }
        if (text === '🧓 Только старичкам') {
            setBroadcastTarget(chatId, telegramId, 'seniors');
        }
        if (text === '👶 Только стажерам') {
            setBroadcastTarget(chatId, telegramId, 'interns');
        }
        if (text === '📊 Выборочно') {
            setBroadcastTarget(chatId, telegramId, 'selective');
        }

        // ========== МЕНЮ ЗАДАЧ ==========
        if (text === '📝 Мои задачи') {
            showMyTasks(chatId, telegramId);
        }
        if (text === '✅ Завершенные') {
            showCompletedTasks(chatId, telegramId);
        }
        if (text === '🎯 Создать задачу') {
            bot.sendMessage(chatId, 'Как вы хотите создать задачу?', taskCreationTypeKeyboard).catch(console.error);
        }
        if (text === '📝 Создать свою задачу') {
            startTaskCreation(chatId, telegramId);
        }
        if (text === '📁 Выбрать из шаблонов') {
            global.userScreenshots[telegramId] = {
                type: 'task_from_template',
                step: 'select_template'
            };
            bot.sendMessage(chatId, 'Выберите шаблон задачи:', taskTemplatesKeyboard).catch(console.error);
        }
        if (text === '🔙 Назад к задачам') {
            showTasksMenu(chatId, telegramId);
        }
        if (text === '👥 Задачи команды') {
            showTeamTasks(chatId, telegramId);
        }
        if (text === '📦 Отложенные') {
            showPostponedTasks(chatId, telegramId);
        }
        if (text === '❌ Отмененные') {
            showCancelledTasks(chatId, telegramId);
        }

        // ========== ДЕЙСТВИЯ С ЗАДАЧАМИ ==========
        if (text === '✅ Принять') {
            acceptTask(chatId, telegramId);
        }
        if (text === '💬 Комментировать') {
            startTaskComment(chatId, telegramId);
        }
        if (text === '📦 Отложить') {
            postponeTask(chatId, telegramId);
        }
        if (text === '❌ Отменить') {
            cancelTask(chatId, telegramId);
        }
        else if (text === '🔄 Отправить дальше') {
            redirectTask(chatId, telegramId);
        }
        else if (text === '📦 Оставить как есть') {
            keepTaskAsIs(chatId, telegramId);
        }

        // ========== ДЕЙСТВИЯ С ДОСТИЖЕНИЯМИ ==========
        else if (text === '✅ Опубликовать') {
            publishAchievement(chatId, telegramId);
        }

        // ========== СОЗДАНИЕ ЗАДАЧ (КНОПКИ) ==========
        else if (text === '🔴 Высокий' || text === '🟡 Средний' || text === '🟢 Низкий') {
            setTaskPriority(chatId, telegramId, text);
            return;
        }
        else if (text.includes('коинов') && text !== '🔙 Назад в меню') {
            setTaskReward(chatId, telegramId, text);
            return;
        }

        // /cancel handler
        if (text === '/cancel') {
            if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'invoice_creation') {
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, "❌ Создание инвойса отменено. Возврат в меню.").catch(console.error);
                backToMainMenu(chatId, telegramId);
                return;
            }
        }

        // Handle company info collection
        else if (currentState && currentState.type === 'collect_company_info') {
            handleCompanyInfoCollection(chatId, telegramId, text, currentState);
        }
        // Обработка текстового ввода и состояний админа
        else {
            handleTextInput(chatId, telegramId, text, username);
        }
        
    } catch (error) {
        console.error('❌ Message handler error:', error);
        bot.sendMessage(msg.chat.id, '🚨 Произошла ошибка! Попробуйте еще раз 🔄').catch(console.error);
    }
});

// ========== ОСНОВНЫЕ ФУНКЦИИ ==========

function registerUser(chatId, telegramId, username, role) {
    try {
        const initialCoins = role === 'стажер' ? 0 : 400;

        db.run(`INSERT OR REPLACE INTO users (telegram_id, username, role, p_coins, energy, is_registered)
                VALUES (?, ?, ?, ?, 100, 0)`,
               [telegramId, username, role, initialCoins], () => {

            global.userScreenshots[telegramId] = {
                type: 'registration',
                step: 'enter_name',
                role: role,
                data: {}
            };

            const backToRoleKeyboard = {
                reply_markup: {
                    keyboard: [['🔙 Назад к выбору роли']],
                    resize_keyboard: true,
                    one_time_keyboard: true
                }
            };

            bot.sendMessage(chatId, '🎉 Добро пожаловать в команду! 👋\n\n📝 Давай познакомимся поближе. Как тебя зовут?', backToRoleKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Register user error:', error);
    }
}

function startBugReport(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'bug_report',
        step: 'enter_description'
    };
    bot.sendMessage(chatId, 
        'Если вы нашли баг, мы проверим и исправим его, а вы получите баллы. 🐞\n\n' +
        'Пожалуйста, подробно опишите баг:'
    );
}

function handleTextInput(chatId, telegramId, text, username) {
    // [DEBUG LOG] Entry to handleTextInput
    const currentState = global.userScreenshots[telegramId];
    console.log(`[TEXTINPUT DEBUG] User ${telegramId} text "${text}" | State on entry: ${currentState ? JSON.stringify({type: currentState.type, step: currentState.step}) : 'none'}`);
    
    // Escape mechanism: Check for keywords to reset state
    const lowerText = text.toLowerCase();
    const escapeKeywords = ['exit', 'menu', 'back', '/menu'];
    if (lowerText.includes('exit') || lowerText.includes('menu') || lowerText.includes('back') || text === '/menu') {
        console.log(`[ESCAPE DEBUG] Escape keyword detected: "${text}" for user ${telegramId}`);
        if (currentState) {
            delete global.userScreenshots[telegramId];
            console.log(`[ESCAPE DEBUG] Cleared state for user ${telegramId}`);
        }
        backToMainMenu(chatId, telegramId);
        return;
    }
    
    try {
        if (currentState && currentState.type === 'pcoin_transfer') {
            switch (currentState.step) {
                case 'enter_wallet_address': {
                    const address = text.trim();
                    db.get("SELECT * FROM users WHERE wallet_address = ?", [address], (err, recipient) => {
                        if (err || !recipient) {
                            bot.sendMessage(chatId, '❌ Кошелек не найден. Проверьте адрес и попробуйте еще раз.');
                            return;
                        }
                        if (recipient.telegram_id === telegramId) {
                            bot.sendMessage(chatId, '❌ Нельзя отправить П-коины самому себе.');
                            return;
                        }

                        currentState.recipient = recipient;
                        currentState.step = 'enter_amount';
                        bot.sendMessage(chatId, `✅ Получатель найден: ${getUserDisplayName(recipient)}\n\nВведите сумму для перевода:`);
                    });
                    break;
                }
                case 'enter_amount': {
                    const amount = parseInt(text);
                    if (isNaN(amount) || amount <= 0) {
                        bot.sendMessage(chatId, '❌ Введите корректную сумму (положительное число).');
                        return;
                    }

                    db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, sender) => {
                        if (err || !sender || sender.p_coins < amount) {
                            bot.sendMessage(chatId, '❌ Недостаточно П-коинов для перевода.');
                            return;
                        }

                        const recipient = currentState.recipient;

                        // Perform transfer
                        db.run("UPDATE users SET p_coins = p_coins - ? WHERE id = ?", [amount, sender.id]);
                        db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [amount, recipient.id]);

                        // Notify sender and receiver
                        bot.sendMessage(chatId, `✅ Вы успешно отправили ${amount} П-коинов пользователю ${getUserDisplayName(recipient)}.`);
                        bot.sendMessage(recipient.telegram_id, `🎉 Вы получили ${amount} П-коинов от пользователя ${getUserDisplayName(sender)}!`);

                        delete global.userScreenshots[telegramId];
                    });
                    break;
                }
            }
            return;
        }

        if (currentState && currentState.type === 'bug_report' && currentState.step === 'enter_description') {
            currentState.description = text;
            currentState.step = 'send_media';
            bot.sendMessage(chatId, 'Спасибо! Теперь, пожалуйста, отправьте фото или видео, демонстрирующее баг.');
            return;
        }

        if (currentState && currentState.type === 'graduation' && currentState.step === 'welcome_message') {
            const welcomeMessage = text;

            // 1. Broadcast the welcome message
            broadcastWelcomeMessage(telegramId, username, welcomeMessage);

            // 2. Update user graduation date, change role to 'старичок', and set position_level to 'Junior'
            db.run("UPDATE users SET graduated_at = CURRENT_TIMESTAMP, role = 'старичок', position_level = 'Junior' WHERE telegram_id = ?", [telegramId], (err) => {
                if (err) {
                    console.error('Error updating user graduation date:', err);
                }
            });

            // 3. Notify admins
            notifyAdminsOfGraduation(telegramId, username);

            // 4. Show main menu and success message
            bot.sendMessage(chatId, '✅ Твое приветствие отправлено! Добро пожаловать в команду!').then(() => {
                db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                    if (user) {
                        showMainMenu(chatId, user);
                    }
                });
            });

            // 5. Clear the state
            delete global.userScreenshots[telegramId];
            return;
        }

        if (currentState && currentState.type === 'task_from_template') {
            if (text.toLowerCase() === 'отмена') {
                delete global.userScreenshots[telegramId];
                showTasksMenu(chatId, telegramId);
                return;
            }

            switch (currentState.step) {
                case 'select_template':
                    if (text === 'Отправить пост редактору') {
                        currentState.step = 'send_post';
                        currentState.taskData = {
                            title: 'Отправить пост редактору'
                        };
                        bot.sendMessage(chatId, 'Отправьте пост (фото и/или видео) с текстом в одном сообщении.');
                    }
                    break;
                case 'enter_due_date':
                    currentState.taskData.due_date = text;
                    currentState.step = 'select_assignee';
                    
                    db.all(`SELECT id, username, full_name, telegram_id, role, position, position_level, registration_date, graduated_at FROM users WHERE is_registered = 1 ORDER BY full_name`, (err, users) => {
                        if (!users || users.length === 0) {
                            bot.sendMessage(chatId, '👻 Нет пользователей для назначения задач!').catch(console.error);
                            delete global.userScreenshots[telegramId];
                            return;
                        }

                        currentState.users = users;
                        let usersList = '👥 Выбери исполнителя:\n\n';
                        users.forEach((u, index) => {
                            const name = getUserDisplayName(u);
                            usersList += `${index + 1}. ${name} (@${u.username})\n`;
                        });
                        usersList += '\n✏️ Напиши номер пользователя:';
                        bot.sendMessage(chatId, usersList);
                    });
                    break;
                case 'select_assignee':
                    const userIndex = parseInt(text) - 1;

                    if (isNaN(userIndex) || userIndex < 0 || userIndex >= currentState.users.length) {
                        bot.sendMessage(chatId, '❌ Неверный номер пользователя! Попробуй еще раз 🔢').catch(console.error);
                        return;
                    }

                    currentState.taskData.assignee_id = currentState.users[userIndex].id;
                    currentState.taskData.assignee_name = getUserDisplayName(currentState.users[userIndex]);
                    currentState.step = 'confirm_task';

                    const escapeMarkdown = (text) => {
                        if (text === null || text === undefined) return '';
                        return text.replace(/([_*`\[\]\(\)])/g, '\\$1');
                    };

                    const confirmationText = `Вы уверены, что хотите создать следующую задачу?\n\n` +
                                           `**Название:** ${escapeMarkdown(currentState.taskData.title)}\n` +
                                           `**Описание:** ${escapeMarkdown(currentState.taskData.description)}\n` +
                                           `**Срок:** ${escapeMarkdown(currentState.taskData.due_date)}\n` +
                                           `**Исполнитель:** ${escapeMarkdown(currentState.taskData.assignee_name)}\n` +
                                           `**Приоритет:** Высокий`;

                    bot.sendMessage(chatId, confirmationText, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '✅ Да', callback_data: 'confirm_template_task_final' }],
                                [{ text: '❌ Нет', callback_data: 'cancel_template_task_final' }]
                            ]
                        }
                    });
                    break;
            }
            return;
        }

        // Vacation request handling
        if (handleVacationInput(chatId, telegramId, text)) {
            return;
        }

        if (currentState && currentState.type === 'registration') {
            switch (currentState.step) {
                case 'enter_name':
                    currentState.data.full_name = text;
                    currentState.step = 'enter_position';
                    if (currentState.role === 'старичок') {
                        bot.sendMessage(chatId, `Приятно познакомиться, ${text}! Какую должность уже занимаешь?`).catch(console.error);
                    } else { // стажер
                        bot.sendMessage(chatId, `Приятно познакомиться, ${text}! На какую должность ты претендуешь?`).catch(console.error);
                    }
                    break;
                case 'enter_position':
                    currentState.data.position = text;
                    if (currentState.role === 'старичок') {
                        currentState.step = 'select_level';
                        bot.sendMessage(chatId, `Отлично, ${text}! Теперь выбери свой уровень:`, positionLevelKeyboard).catch(console.error);
                    } else { // стажер
                        currentState.step = 'enter_bio';
                        bot.sendMessage(chatId, 'Отлично! И последний вопрос: расскажи немного о себе.').catch(console.error);
                    }
                    break;
                case 'select_level': // Only for старичок
                    const level = text.trim();
                    const validLevels = ['Middle', 'Senior', 'C-Level', 'Head'];
                    if (!validLevels.includes(level)) {
                        bot.sendMessage(chatId, '❌ Неверный уровень! Выбери из предложенных вариантов.').catch(console.error);
                        return;
                    }
                    currentState.data.position_level = level; // Save the level
                    
                    // Complete registration for старичок
                    db.run("UPDATE users SET full_name = ?, position = ?, position_level = ?, is_registered = 1 WHERE telegram_id = ?",
                           [currentState.data.full_name, currentState.data.position, currentState.data.position_level, telegramId], () => {
                        
                        bot.sendMessage(chatId, '🎊 Регистрация завершена! 🎉\n\n💰 Получено 400 стартовых П-коинов!\n🚀 Добро пожаловать в игру!', mainMenuKeyboard).catch(console.error);
                        delete global.userScreenshots[telegramId];
                    });
                    break;
                case 'enter_bio': // Only for стажер
                    currentState.data.contacts = text;
                    
                    // Complete registration for стажер
                    db.run("UPDATE users SET full_name = ?, position = ?, contacts = ?, is_registered = 1 WHERE telegram_id = ?",
                           [currentState.data.full_name, currentState.data.position, currentState.data.contacts, telegramId], () => {
                        
                        bot.sendMessage(chatId, '🎊 Регистрация завершена! 🎉\n\n📚 Теперь проходи тесты и зарабатывай баллы! 💪\n🔥 Удачи, стажер!', internMenuKeyboard).catch(console.error);
                        delete global.userScreenshots[telegramId];
                    });
                    break;
            }
            return;
        }

        // Invoice creation state
        if (currentState && currentState.type === 'invoice_creation') {
            const state = currentState;
            const data = state.data;
            let valid = true;
            let nextStep = '';
            let prompt = '';

            switch (state.step) {
                case 'org_name':
                    if (text.trim() === '') {
                        valid = false;
                        prompt = "❌ Введите корректное название!";
                    } else {
                        data.org_name = text.trim();
                        nextStep = 'org_address';
                        prompt = `✅ Организация: ${data.org_name}. Шаг 2: Адрес организации? (Введите на английском для PDF)`;
                    }
                    break;
                case 'org_address':
                    if (text.trim() === '') {
                        valid = false;
                        prompt = "❌ Введите корректный адрес!";
                    } else {
                        data.org_address = text.trim();
                        nextStep = 'work_type';
                        prompt = `✅ Адрес: ${data.org_address}. Шаг 3: Тип работы (e.g., 'website branding')? (Введите на английском для PDF)`;
                    }
                    break;
                case 'work_type':
                    if (text.trim() === '') {
                        valid = false;
                        prompt = "❌ Введите корректный тип работы!";
                    } else {
                        data.work_type = text.trim();
                        nextStep = 'quantity';
                        prompt = `✅ Тип: ${data.work_type}. Шаг 4: Количество?`;
                    }
                    break;
                case 'quantity':
                    const qty = parseInt(text);
                    if (isNaN(qty) || qty <= 0) {
                        valid = false;
                        prompt = "❌ Введите положительное число!";
                    } else {
                        data.quantity = qty;
                        nextStep = 'amount';
                        prompt = `✅ Кол-во: ${data.quantity}. Шаг 5: Сумма за единицу (USDT)?`;
                    }
                    break;
                case 'amount':
                    const amt = parseFloat(text);
                    if (isNaN(amt) || amt <= 0) {
                        valid = false;
                        prompt = "❌ Введите положительное число!";
                    } else {
                        data.amount = amt;
                        data.total = data.quantity * data.amount;
                        data.start_date = new Date().toLocaleDateString('ru-RU');
                        data.end_date = data.start_date;
                        data.description = null;
                        db.get("SELECT COALESCE(MAX(invoice_number), 0) + 1 AS next FROM invoices", (err, row) => {
                            if (err) {
                                console.error('Error getting next invoice number:', err);
                                bot.sendMessage(chatId, "Error preparing preview.").catch(console.error);
                                return;
                            }
                            const next_seq = row.next;
                            state.step = 'preview';
                            global.userScreenshots[telegramId] = state;
                            const previewText = `📋 Предпросмотр: Организация: ${data.org_name}, Адрес: ${data.org_address}, Тип: ${data.work_type}, Кол-во: ${data.quantity}, Сумма/ед: ${data.amount}, Итого: ${data.total} USDT. Invoice #: ${next_seq}. Подтвердить?`;
                            bot.sendMessage(chatId, previewText, {
                                reply_markup: {
                                    inline_keyboard: [
                                        [{text: '✅ Да', callback_data: 'confirm_invoice'}],
                                        [{text: '❌ Нет', callback_data: 'cancel_invoice'}]
                                    ]
                                }
                            }).catch(console.error);
                        });
                        return;
                    }
                    break;
                default:
                    valid = false;
            }

            if (valid && nextStep !== 'preview') {
                state.step = nextStep;
                global.userScreenshots[telegramId] = state;
                bot.sendMessage(chatId, prompt).catch(console.error);
            } else if (!valid) {
                bot.sendMessage(chatId, prompt).catch(console.error);
            }
            return;
        }

        // Обработка состояний админа
        if (global.adminStates[telegramId]) {
            if (global.adminStates[telegramId].step.startsWith('mentor_')) {
                handleMentorAssignment(chatId, telegramId, text, global.adminStates[telegramId]);
            } else if (global.adminStates[telegramId].step.startsWith('delete_user_')) {
                handleUserDeletion(chatId, telegramId, text, global.adminStates[telegramId]);
            } else {
                handleAdminEventCreation(chatId, telegramId, text);
            }
            return;
        }

        // Обработка создания задач
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'task_creation') {
            handleTaskCreation(chatId, telegramId, text);
            return;
        }

        // Обработка создания достижений
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'achievement_creation') {
            handleAchievementCreation(chatId, telegramId, text);
            return;
        }

        // Обработка комментариев к достижениям
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'achievement_comment') {
            handleAchievementComment(chatId, telegramId, text);
            return;
        }

        // Обработка выбора мероприятия
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'event_selection') {
            handleEventSelection(chatId, telegramId, text);
            return;
        }

        // Обработка начисления баллов админом
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'balance_add') {
            handleBalanceAdd(chatId, telegramId, text);
            return;
        }

        // Обработка списания баллов админом
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'balance_deduct') {
            handleBalanceDeduct(chatId, telegramId, text);
            return;
        }

        // Обработка рассылок админом
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'broadcast') {
            handleBroadcastMessage(chatId, telegramId, text);
            return;
        }
        
        if (global.waitingForPoints[telegramId]) {
            const testData = global.waitingForPoints[telegramId];
            const score = parseInt(text);

            if (isNaN(score) || score < 0 || score > 100) {
                bot.sendMessage(chatId, '🤔 Ммм, что-то не так! Напиши число от 0 до 100 📊').catch(console.error);
                return;
            }

            if (score < 90) {
                bot.sendMessage(chatId, 
                    `😔 К сожалению, ты набрал ${score} баллов. Для прохождения нужно набрать 90 или больше.\n\n` +
                    'Попробуй еще раз! У тебя все получится! 💪'
                ).catch(console.error);
            } else {
                const rewards = {
                    'Онбординг в Партнеркин': 15,
                    'Основы эффективной коммуникации': 15,
                    'Эффективная работа в режиме многозадачности': 10,
                    'Информационный стиль и редактура текста': 10,
                    'Тайм-менеджмент': 10,
                    'Стресс-менеджмент': 10,
                    'Work-Life balance: профилактика эмоционального выгорания': 10
                };
                const pCoins = rewards[testData.testName] || 0;

                createTestSubmission(chatId, telegramId, testData.testName, score, testData.photoFileId, username);
            }

            delete global.waitingForPoints[telegramId];
            return;
        }
        
        // Обработка записи на мероприятие по номеру слота
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'event_booking') {
            console.log(`[DEBUG TEXT INPUT] User ${telegramId} text "${text}", state: event_booking, slots count: ${global.userScreenshots[telegramId].slots.length}`);
            const slotNumber = parseInt(text);
            const eventData = global.userScreenshots[telegramId];
 
            if (isNaN(slotNumber)) {
                // Add counter for event booking if needed, but since it clears silently, keep as is
                console.log(`[DEBUG SLOT ERROR] Non-numeric text "${text}", clearing state silently for user ${telegramId}`);
                delete global.userScreenshots[telegramId];
                // Allow fall-through to other handlers if needed, but since end, just clear
            } else if (slotNumber < 1 || slotNumber > eventData.slots.length) {
                console.log(`[DEBUG SLOT ERROR] Invalid slot number ${slotNumber} for user ${telegramId}`);
                bot.sendMessage(chatId, '🤷‍♂️ Такого номера слота нет! Попробуй еще раз 🔢').catch(console.error);
                return;
            } else {
                bookEventSlot(chatId, telegramId, eventData.slots[slotNumber - 1]);
                delete global.userScreenshots[telegramId];
                console.log(`[DEBUG EVENT BOOKING] Cleared state for user ${telegramId} after booking slot ${slotNumber}`);
                return;
            }
        }

        // Обработка процесса подарков
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'gift') {
            handleGiftProcess(chatId, telegramId, text);
            return;
        }

        // Обработка поиска контактов
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'contact_search') {
            handleContactSearch(chatId, telegramId, text);
            return;
        }

        // Обработка создания контактов
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'contact_creation') {
            handleContactCreation(chatId, telegramId, text);
            return;
        }
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'contact_editing') {
            handleContactEditing(chatId, telegramId, text);
            return;
        }
        if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'contact_deletion') {
            handleContactDeletion(chatId, telegramId, text);
            return;
        }

        if (currentState && currentState.type === 'task_cancel' && currentState.step === 'enter_reason') {
            const reason = text;
            const { taskId } = currentState; // Assuming taskId is in the state

            db.run("UPDATE tasks SET status = 'cancelled', cancelled_reason = ? WHERE id = ?", [reason, taskId], function(err) {
                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка отмены задачи.');
                    console.error('Error cancelling task:', err);
                } else {
                    bot.sendMessage(chatId, `✅ Задача #${taskId} была отменена.`);
                    cancelTaskReminder(taskId);
                }
                delete global.userScreenshots[telegramId];
            });
            return;
        }

        // Обработка отмены задачи
        if (currentState && currentState.type === 'task_cancel' && currentState.step === 'enter_reason') {
            const reason = text;
            const { taskId } = currentState;

            db.run("UPDATE tasks SET status = 'cancelled', cancelled_reason = ? WHERE id = ?", [reason, taskId], function(err) {
                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка отмены задачи.');
                    console.error('Error cancelling task:', err);
                } else {
                    bot.sendMessage(chatId, `✅ Задача #${taskId} была отменена.`);
                    // Stop reminders for the cancelled task
                    cancelTaskReminder(taskId);
                }
                delete global.userScreenshots[telegramId];
            });
            return;
        }

        // Обработка сообщения статуса
        if (currentState && currentState.type === 'status_message') {
            handleStatusMessage(chatId, telegramId, text);
            return;
        }

        if (currentState && currentState.type === 'pcoin_exchange') {
            switch (currentState.step) {
                case 'enter_amount': {
                    const amount = parseInt(text);
                    if (isNaN(amount) || amount <= 0 || amount % 10 !== 0) {
                        bot.sendMessage(chatId, '❌ Неверная сумма. Введите положительное число, кратное 10.');
                        return;
                    }

                    db.get("SELECT p_coins FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                        if (err || !user || user.p_coins < amount) {
                            bot.sendMessage(chatId, '❌ У вас недостаточно П-коинов для обмена.');
                            return;
                        }

                        const pointsToReceive = amount / 10;
                        currentState.amountToExchange = amount;
                        currentState.pointsToReceive = pointsToReceive;
                        currentState.step = 'confirm_exchange';

                        const confirmationKeyboard = {
                            reply_markup: {
                                keyboard: [['✅ Да, подтверждаю', '❌ Нет, отменить']],
                                resize_keyboard: true,
                                one_time_keyboard: true
                            }
                        };

                        bot.sendMessage(chatId, `Вы уверены, что хотите обменять ${amount} П-коинов на ${pointsToReceive} баллов?`, confirmationKeyboard);
                    });
                    break;
                }

                case 'confirm_exchange': {
                    if (text === '✅ Да, подтверждаю') {
                        const { amountToExchange, pointsToReceive } = currentState;
                        db.get("SELECT id, p_coins FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                            if (err || !user || user.p_coins < amountToExchange) {
                                bot.sendMessage(chatId, '❌ Недостаточно П-коинов. Операция отменена.', mainMenuKeyboard);
                                delete global.userScreenshots[telegramId];
                                return;
                            }

                            db.serialize(() => {
                                db.run("UPDATE users SET p_coins = p_coins - ?, company_points = company_points + ? WHERE telegram_id = ?", [amountToExchange, pointsToReceive, telegramId]);
                                db.run("INSERT INTO exchange_history (user_id, p_coins_exchanged, company_points_received) VALUES (?, ?, ?)", [user.id, amountToExchange, pointsToReceive]);
                            });

                            bot.sendMessage(chatId, `✅ Обмен успешно выполнен!\n\nВы получили: ${pointsToReceive} баллов.\nСписано: ${amountToExchange} П-коинов.`, mainMenuKeyboard);
                            console.log(`[EXCHANGE] User ${telegramId} exchanged ${amountToExchange} p-coins for ${pointsToReceive} company points.`);
                            delete global.userScreenshots[telegramId];
                        });
                    } else {
                        bot.sendMessage(chatId, 'Обмен отменен.', mainMenuKeyboard);
                        delete global.userScreenshots[telegramId];
                    }
                    break;
                }
            }
            return;
        }

        if (currentState && currentState.type === 'pcoin_request') {
            switch (currentState.step) {
                case 'select_target': {
                    const userIndex = parseInt(text) - 1;
                    if (isNaN(userIndex) || userIndex < 0 || userIndex >= currentState.users.length) {
                        bot.sendMessage(chatId, '❌ Неверный номер пользователя. Попробуйте еще раз.');
                        return;
                    }
                    currentState.targetUser = currentState.users[userIndex];
                    currentState.step = 'enter_amount';
                    bot.sendMessage(chatId, `Выбран пользователь: ${getUserDisplayName(currentState.targetUser)}.\n\nСколько П-коинов вы хотите попросить?`);
                    break;
                }

                case 'enter_amount': {
                    const amount = parseInt(text);
                    if (isNaN(amount) || amount <= 0) {
                        bot.sendMessage(chatId, '❌ Введите положительное число.');
                        return;
                    }
                    currentState.amount = amount;
                    currentState.step = 'enter_reason';
                    bot.sendMessage(chatId, `Сумма: ${amount} П-коинов.\n\nНапишите причину/сообщение для вашего запроса:`);
                    break;
                }

                case 'enter_reason': {
                    currentState.reason = text;
                    const { requester_id } = currentState; // This needs to be set at the start
                    const { targetUser, amount, reason } = currentState;

                    db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, requester) => {
                        if (err || !requester) {
                            bot.sendMessage(chatId, '❌ Ошибка: не удалось найти ваш профиль.');
                            return;
                        }

                        db.run(`INSERT INTO pcoin_requests (requester_id, target_id, amount, reason) VALUES (?, ?, ?, ?)`,
                            [requester.id, targetUser.id, amount, reason], function(err) {
                                if (err) {
                                    bot.sendMessage(chatId, '❌ Не удалось создать запрос.');
                                    console.error('P-coin request insert error:', err);
                                    delete global.userScreenshots[telegramId];
                                    return;
                                }

                                const requestId = this.lastID;
                                const requesterName = getUserDisplayName(requester);

                                const notificationText = `🙏 **Запрос на П-коины**\n\n` +
                                                       `**От:** ${requesterName}\n` +
                                                       `**Сумма:** ${amount} П-коинов\n` +
                                                       `**Причина:** ${reason}`;

                                const keyboard = {
                                    inline_keyboard: [[
                                        { text: '✅ Одобрить', callback_data: `approve_pcoin_request_${requestId}` },
                                        { text: '❌ Отклонить', callback_data: `decline_pcoin_request_${requestId}` }
                                    ]]
                                };

                                bot.sendMessage(targetUser.telegram_id, notificationText, { parse_mode: 'Markdown', reply_markup: keyboard });
                                bot.sendMessage(chatId, '✅ Ваш запрос успешно отправлен!', mainMenuKeyboard);
                                delete global.userScreenshots[telegramId];
                            });
                    });
                    break;
                }
            }
            return;
        }


        
    } catch (error) {
        console.error('❌ Handle text input error:', error);
    }
}

function showDetailedProfile(chatId, user) {
    db.get(`SELECT 
            COUNT(*) as total_active_tasks,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_tasks,
            SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_tasks
        FROM tasks WHERE assignee_id = ? AND status IN ('pending', 'in_progress')`, [user.id], (err, taskStats) => {
    const totalActiveTasks = taskStats ? taskStats.total_active_tasks : 0;
    const pendingTasks = taskStats ? taskStats.pending_tasks : 0;
    const inProgressTasks = taskStats ? taskStats.in_progress_tasks : 0;

        let menuText = `👤 ${getUserDisplayName(user)}\n`;
        
        if (user.role === 'стажер' && user.graduated_at) {
            menuText += `🎭 Статус: стажер-Junior\n\n`;
        } else {
            const position = user.role === 'старичок' ? 'Опытный сотрудник' : 'Сотрудник';
            menuText += `🏢 ${position}\n\n`;
        }

        menuText += `📊 Ваш Баланс:\n`;
        menuText += `💰 П-коины: ${user.p_coins}\n`;
        menuText += `🏆 Баллы: ${user.company_points}\n\n`;
        menuText += `⚡ Энергия: ${user.energy}%\n\n`;
        menuText += `📈 Курс обмена: 10 П-коинов = 1 балл\n\n`;

        if (totalActiveTasks > 0) {
            menuText += `📋 Активные задачи: ${totalActiveTasks}\n`;
            if (inProgressTasks > 0) {
                menuText += `   ▶️ В работе: ${inProgressTasks}\n`;
            }
            if (pendingTasks > 0) {
                menuText += `   ⏳ Ожидают: ${pendingTasks}\n`;
            }
        } else {
            menuText += `✅ Нет активных задач\n`;
        }

        menuText += `🎓 Рекомендуемые курсы: Доступны в разделе "Курсы"\n\n`;

        const greetings = [
            '🌟 Желаю продуктивного дня!',
            '🚀 Пусть день будет полон успехов!',
            '💪 Удачи в новых свершениях!',
            '🔥 Покоряй новые вершины!',
            '⭐ Пусть день принесет радость!'
        ];
        const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
        menuText += randomGreeting;

        bot.sendMessage(chatId, menuText, mainMenuKeyboard);

        if (user.role === 'стажер' && user.mentor_id) {
            db.get("SELECT * FROM users WHERE id = ?", [user.mentor_id], (err, mentor) => {
                if (mentor) {
                    const mentorText = `🎓 **Ваш наставник:** ${getUserDisplayName(mentor)}`;
                    const keyboard = {
                        inline_keyboard: [[
                            { text: '💬 Написать наставнику', url: mentor.username ? `https://t.me/${mentor.username}` : `tg://user?id=${mentor.telegram_id}` }
                        ]]
                    };
                    bot.sendMessage(chatId, mentorText, { parse_mode: 'Markdown', reply_markup: keyboard });
                }
            });
        }
    });
}

function showMainMenu(chatId, user) {
    console.log(`[MENU DEBUG] showMainMenu called for user ${user.id} (role: ${user.role}), chatId: ${chatId}`);
    try {
        if (user.role === 'стажер') {
            if (user.graduated_at) {
                showDetailedProfile(chatId, user);
            } else {
                // Проверяем, не пора ли выпускаться
                db.get("SELECT COUNT(*) as count FROM intern_progress WHERE user_id = ? AND completed = 1", [user.id], (err, row) => {
                    if (!err && row && parseInt(row.count) === 3) {
                        // У стажера 3 завершенных теста, но он еще не выпустился - запускаем процесс выпуска
                        console.log(`[GRADUATION] User ${user.id} has 3 completed tests, starting graduation process`);

                        // Проверяем что у стажера 0 П-коинов (значит бонус еще не начислен)
                        const graduationBonus = 400;
                        if (user.p_coins < graduationBonus) {
                            db.run("UPDATE users SET p_coins = ? WHERE id = ?", [graduationBonus, user.id], (err) => {
                                if (err) {
                                    console.error('Error adding graduation bonus:', err);
                                } else {
                                    console.log(`✅ Set ${graduationBonus} graduation bonus for user ${user.id}`);
                                }
                            });
                        } else {
                            console.log(`ℹ️ User ${user.id} already has ${user.p_coins} coins, skipping bonus`);
                        }

                        global.userScreenshots[user.telegram_id] = {
                            type: 'graduation',
                            step: 'welcome_message'
                        };

                        bot.sendMessage(user.telegram_id,
                            `🎉 Поздравляем! Ты прошел стажировку и теперь становишься полноправным членом команды! 🥳\n\n` +
                            `💰 В качестве бонуса тебе начислено ${graduationBonus} стартовых П-коинов!\n\n` +
                            'Тебе открыт весь функционал нашего бота. Можешь поздороваться с коллегами и написать приветственное сообщение, которое увидят все! 📣\n\n' +
                            'Напиши свое приветствие:'
                        ).catch(console.error);
                        return;
                    }

                    // Обычное меню стажера
                    console.log(`[MENU DEBUG] Sending active intern menu message`);
                    let message = '👋 Привет, стажер! 📚\n\n' +
                        `💰 Баланс: ${user.p_coins} П-коинов\n` +
                        '🎯 Продолжай проходить тесты!\n' +
                        '💪 Каждый тест приближает к цели!';

                    bot.sendMessage(chatId, message, internMenuKeyboard);

                    if (user.mentor_id) {
                        db.get("SELECT * FROM users WHERE id = ?", [user.mentor_id], (err, mentor) => {
                            if (mentor) {
                                const mentorText = `🎓 **Ваш наставник:** ${getUserDisplayName(mentor)}`;
                                const keyboard = {
                                    inline_keyboard: [[
                                        { text: '💬 Написать наставнику', url: mentor.username ? `https://t.me/${mentor.username}` : `tg://user?id=${mentor.telegram_id}` }
                                    ]]
                                };
                                bot.sendMessage(chatId, mentorText, { parse_mode: 'Markdown', reply_markup: keyboard });
                            }
                        });
                    }
                });
            }
        } else { // старичок
            showDetailedProfile(chatId, user);
        }
    } catch (error) {
        console.error('❌ Show main menu error:', error);
    }
}

// New category menu functions
function showPersonalMenu(chatId) {
    bot.sendMessage(chatId,
        '💰 ЛИЧНЫЙ КАБИНЕТ 👤\n\n' +
        'Здесь ты можешь проверить свой баланс и позицию в рейтинге.\n\n' +
        '👇 Выбери действие:', personalKeyboard).catch(console.error);
}

function showLearningMenu(chatId) {
    let context = global.userMenuContext[chatId];
    if (!context) {
        context = { path: ['main'], menuFn: 'main' };
    }
    if (context.path[context.path.length - 1] === 'main') {
        context.path.push('learning');
        context.menuFn = 'learning';
    } else {
        context.path = ['main', 'learning'];
        context.menuFn = 'learning';
    }
    global.userMenuContext[chatId] = context;
    console.log(`[NAV LOG] Entering learning menu for user ${chatId}, context: ${JSON.stringify(context)}`);
    bot.sendMessage(chatId,
        '🎓 ОБУЧЕНИЕ И РАЗВИТИЕ 📚\n\n' +
        'Прокачивай навыки через курсы и отслеживай прогресс.\n\n' +
        '👇 Выбери раздел:', learningKeyboard).catch(console.error);
}

function showWorkMenu(chatId, telegramId) {
    // Get active tasks count for message
    db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (!user) return;
        db.get(`SELECT COUNT(*) as active_tasks FROM tasks WHERE assignee_id = ? AND status = 'pending'`, [user.id], (err, taskCount) => {
            const activeTasksCount = taskCount ? taskCount.active_tasks : 0;
            bot.sendMessage(chatId,
                '📋 РАБОТА И ЗАДАЧИ 💼\n\n' +
                `📝 Активных задач: ${activeTasksCount}\n` +
                'Управляй задачами и записывайся на мероприятия.\n\n' +
                '👇 Выбери раздел:', workKeyboard).catch(console.error);
        });
    });
}

function showFunMenu(chatId) {
    bot.sendMessage(chatId,
        '🎮 РАЗВЛЕЧЕНИЯ И НАГРАДЫ 🎁\n\n' +
        'Сражайся в PVP, покупай в магазине, дари баллы и хвастайся достижениями!\n\n' +
        '👇 Выбери развлечение:', funKeyboard).catch(console.error);
}

// Admin sub-menus
function showAdminEventsMenu(chatId) {
    bot.sendMessage(chatId,
        '🗓️ УПРАВЛЕНИЕ МЕРОПРИЯТИЯМИ 📅\n\n' +
        'Создавай, редактируй и удаляй слоты мероприятий.\n\n' +
        '👇 Выбери действие:', adminEventsKeyboard).catch(console.error);
}

function showAdminUsersMenu(chatId) {
    bot.sendMessage(chatId,
        '👥 УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ 📊\n\n' +
        'Просматривай пользователей и проверяй заявки на тесты.\n\n' +
        '👇 Выбери раздел:', adminUsersKeyboard).catch(console.error);
}

function startMentorAssignment(chatId, telegramId) {
    db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
        if (!admin) {
            bot.sendMessage(chatId, '❌ Нет прав администратора!');
            return;
        }

        db.all("SELECT * FROM users WHERE role = 'стажер' AND is_registered = 1 ORDER BY full_name", (err, juniors) => {
            if (err || !juniors || juniors.length === 0) {
                bot.sendMessage(chatId, '❌ Нет стажеров для назначения наставника.');
                return;
            }

            let message = '🎓 **Назначение наставника**\n\nВыберите стажера из списка:\n\n';
            juniors.forEach((j, index) => {
                message += `${index + 1}. ${getUserDisplayName(j)}\n`;
            });
            message += '\nВведите номер стажера:';

            global.adminStates[telegramId] = {
                step: 'mentor_select_junior',
                juniors: juniors
            };

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        });
    });
}

function handleMentorAssignment(chatId, telegramId, text, state) {
    if (text.toLowerCase() === 'отмена') {
        delete global.adminStates[telegramId];
        showAdminUsersMenu(chatId);
        return;
    }

    switch (state.step) {
        case 'mentor_select_junior':
            const juniorIndex = parseInt(text) - 1;
            if (isNaN(juniorIndex) || juniorIndex < 0 || juniorIndex >= state.juniors.length) {
                bot.sendMessage(chatId, '❌ Неверный номер стажера. Попробуйте еще раз.');
                return;
            }
            state.selectedJunior = state.juniors[juniorIndex];
            
            db.all("SELECT * FROM users WHERE role = 'старичок' AND is_registered = 1 ORDER BY full_name", (err, mentors) => {
                if (err || !mentors || mentors.length === 0) {
                    bot.sendMessage(chatId, '❌ Нет доступных наставников.');
                    delete global.adminStates[telegramId];
                    return;
                }

                let message = `✅ Выбран стажер: ${getUserDisplayName(state.selectedJunior)}\n\n`;
                message += 'Теперь выберите наставника из списка:\n\n';
                mentors.forEach((m, index) => {
                    message += `${index + 1}. ${getUserDisplayName(m)}\n`;
                });
                message += '\nВведите номер наставника:';

                state.step = 'mentor_select_mentor';
                state.mentors = mentors;
                bot.sendMessage(chatId, message);
            });
            break;

        case 'mentor_select_mentor':
            const mentorIndex = parseInt(text) - 1;
            if (isNaN(mentorIndex) || mentorIndex < 0 || mentorIndex >= state.mentors.length) {
                bot.sendMessage(chatId, '❌ Неверный номер наставника. Попробуйте еще раз.');
                return;
            }
            const selectedMentor = state.mentors[mentorIndex];

            db.run("UPDATE users SET mentor_id = ? WHERE id = ?", [selectedMentor.id, state.selectedJunior.id], (err) => {
                if (err) {
                    console.error('Error assigning mentor:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при назначении наставника.');
                    delete global.adminStates[telegramId];
                    return;
                }

                bot.sendMessage(chatId, `✅ Наставник ${getUserDisplayName(selectedMentor)} назначен стажеру ${getUserDisplayName(state.selectedJunior)}.`);

                // Notify junior
                bot.sendMessage(state.selectedJunior.telegram_id, `🎓 Вам назначен наставник: ${getUserDisplayName(selectedMentor)}. Вы можете связаться с ним через ваш профиль.`);

                // Notify mentor
                bot.sendMessage(selectedMentor.telegram_id, `🎓 Вы были назначены наставником для стажера: ${getUserDisplayName(state.selectedJunior)}.`);

                delete global.adminStates[telegramId];
            });
            break;
    }
}

function startUserDeletion(chatId, telegramId, page = 0) {
    db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
        if (!admin) {
            bot.sendMessage(chatId, '❌ Нет прав администратора!');
            return;
        }

        const PAGE_SIZE = 5;
        db.all("SELECT * FROM users WHERE is_registered = 1 ORDER BY full_name", (err, users) => {
            if (err || !users || users.length === 0) {
                bot.sendMessage(chatId, '❌ Нет пользователей для удаления.');
                return;
            }

            const totalPages = Math.ceil(users.length / PAGE_SIZE);
            const pageSafe = Math.min(Math.max(page, 0), totalPages - 1);
            const start = pageSafe * PAGE_SIZE;
            const end = start + PAGE_SIZE;
            const usersOnPage = users.slice(start, end);

            const keyboard = usersOnPage.map(user => ([
                { text: `${getUserDisplayName(user)}`, callback_data: `delete_user_select_${user.id}` }
            ]));

            const navKeyboard = [];
            if (pageSafe > 0) navKeyboard.push({ text: '⬅️ Назад', callback_data: `delete_user_page_${pageSafe - 1}` });
            if (pageSafe < totalPages - 1) navKeyboard.push({ text: 'Вперед ➡️', callback_data: `delete_user_page_${pageSafe + 1}` });
            
            if (navKeyboard.length > 0) keyboard.push(navKeyboard);
            keyboard.push([{ text: '❌ Отмена', callback_data: 'delete_user_cancel' }]);

            const message = `🗑️ **Удаление пользователя** (Страница ${pageSafe + 1}/${totalPages})\n\nВыберите пользователя для удаления:`;
            
            bot.sendMessage(chatId, message, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        });
    });
}

// handleUserDeletion is now obsolete and replaced by handleUserDeletionCallback

// ========== ФУНКЦИИ ТЕСТИРОВАНИЯ ==========

function showTestMenu(chatId) {
    global.userMenuContext[chatId] = { path: ['main', 'learning', 'tests'], menuFn: 'tests' };
    console.log(`[NAV LOG] Entering test menu for user ${chatId}, context: ${JSON.stringify(global.userMenuContext[chatId])}`);
    try {
        bot.sendMessage(chatId,
            '📚 ЦЕНТР ОБУЧЕНИЯ 🎓\n\n' +
            'Онбординг в Партнеркин - 150 П-коинов 💎\n' +
            'Основы эффективной коммуникации - 150 П-коинов 💎\n' +
            'Эффективная работа в режиме многозадачности - 100 П-коинов 💎\n\n' +
            '💡 Каждый тест - это новые знания и баллы!\n' +
            '🎯 Выбери тест для прохождения:', testKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Show test menu error:', error);
    }
}

function selectTest(chatId, telegramId, testName, reward, link) {
    try {
        db.get(`SELECT ip.* FROM intern_progress ip 
                JOIN users u ON u.id = ip.user_id 
                WHERE u.telegram_id = ? AND ip.test_name = ? AND ip.completed = 1`, 
               [telegramId, testName], (err, completed) => {
            
            if (completed) {
                bot.sendMessage(chatId, 
                    `✅ Тест "${testName}" уже пройден! 🎉\n\n` +
                    `💰 Получено: ${completed.points_earned} коинов\n` +
                    '🔥 Попробуй другие тесты!').catch(console.error);
                return;
            }
            
            db.get("SELECT * FROM test_submissions WHERE telegram_id = ? AND test_name = ? AND status = 'pending'", 
                   [telegramId, testName], (err, pending) => {
                
                if (pending) {
                    bot.sendMessage(chatId, 
                        `⏳ Заявка на тест "${testName}" уже на проверке! 📋\n\n` +
                        '🕐 Скоро придет результат, жди!')
                        .catch(console.error);
                    return;
                }
                
                global.userScreenshots[telegramId] = { testName, reward };
                
                bot.sendMessage(chatId, 
                    `🎯 Выбран тест: "${testName}" 📖\n\n` +
                    `🏆 Награда: ${reward} П-коинов (при результате 90-100 баллов)\n` +
                    `⏰ Время: ~15 минут\n` +
                    `🔗 Формат: Онлайн тестирование\n\n` +
                    `🌐 Ссылка на тест:\n${link}\n\n` +
                    '📸 После прохождения отправь скриншот результата!\n' +
                    '🎯 Укажи итоговые баллы за тест.\n' +
                    '💪 Удачи в тестировании! 💪').catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Select test error:', error);
    }
}

function handleScreenshot(chatId, telegramId, photoFileId, username) {
    try {
        if (!global.userScreenshots[telegramId]) {
            bot.sendMessage(chatId,
                '🤔 Хм, сначала выбери тест из меню! 📚\n' +
                '👆 Используй кнопки выше').catch(console.error);
            return;
        }

        const userData = global.userScreenshots[telegramId];

        // Проверяем тип обработки
        if (userData.type === 'achievement_creation') {
            // Обработка фото для достижения
            userData.photoFileId = photoFileId;
            userData.step = 'confirm_achievement';

            bot.sendMessage(chatId,
                '📸 Фото получено! ✅\n\n' +
                `🏆 Название: ${userData.title}\n` +
                `📝 Описание: ${userData.description || 'Без описания'}\n\n` +
                '✅ Все готово! Опубликовать достижение?\n' +
                '📢 Оно будет отправлено всем пользователям!', {
                    reply_markup: {
                        keyboard: [
                            ['✅ Опубликовать', '❌ Отменить'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }).catch(console.error);
        } else {
            // Обработка фото для теста (старая логика)
            global.waitingForPoints[telegramId] = {
                testName: userData.testName,
                reward: userData.reward,
                photoFileId: photoFileId
            };

            delete global.userScreenshots[telegramId];

            bot.sendMessage(chatId,
                `📸 Скриншот получен! ✅\n\n` +
                `📝 Тест: ${userData.testName}\n` +
                `🏆 Максимум: ${userData.reward} баллов\n\n` +
                '🎯 Сколько баллов ты набрал?\n' +
                '🔢 Напиши число (например: 85)').catch(console.error);
        }
    } catch (error) {
        console.error('❌ Handle screenshot error:', error);
    }
}

function createTestSubmission(chatId, telegramId, testName, points, photoFileId, username) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            // Store the points as entered by the user without any conversion
            db.run(`INSERT INTO test_submissions
                    (user_id, telegram_id, username, test_name, points_claimed, photo_file_id, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
                   [user.id, telegramId, username, testName, points, photoFileId], function() {
                
                bot.sendMessage(chatId, 
                    `🚀 Заявка отправлена! 📋\n\n` +
                    `📝 Тест: ${testName}\n` +
                    `🎯 Баллы: ${points}\n` +
                    `📸 Скриншот прикреплен\n\n` +
                    '⏳ Жди решения администратора!\n' +
                    '📱 Уведомление придет автоматически! 🔔').catch(console.error);

                if (user.role === 'стажер') {
                    db.get("SELECT COUNT(*) as count FROM test_submissions WHERE user_id = ?", [user.id], (err, row) => {
                        if (err) {
                            console.error('Error counting submissions:', err);
                            return;
                        }

                        if (row.count === 3) {
                            notifyAdminsOfInternCompletion(user);
                        }
                    });
                }
            });
        });
    } catch (error) {
        console.error('❌ Create test submission error:', error);
    }
}

// ========== ФУНКЦИИ БАЛАНСА И ПРОГРЕССА ==========

function showBalance(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (user) {
                bot.sendMessage(chatId,
                    `📊 Ваш Баланс:\n` +
                    `💰 П-коины: ${user.p_coins}\n` +
                    `🏆 Баллы: ${user.company_points}\n\n` +
                    `⚡ Энергия: ${user.energy}%\n` +
                    `👤 Статус: ${user.role}\n\n` +
                    '🔥 Продолжай в том же духе!').catch(console.error);
            }
        });
    } catch (error) {
        console.error('❌ Show balance error:', error);
    }
}

function showInternProgress(chatId, telegramId) {
    try {
        db.get("SELECT id, role FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT * FROM intern_progress WHERE user_id = ? ORDER BY completed_date DESC`,
                   [user.id], (err, tests) => {

                // Разные тесты для стажеров и старичков
                let allTests;
                if (user.role === 'стажер') {
                    // Тесты для стажеров (3 теста)
                    allTests = [
                        { name: 'Онбординг в Партнеркин', reward: 100, emoji: '👋' },
                        { name: 'Основы эффективной коммуникации', reward: 100, emoji: '💬' },
                        { name: 'Эффективная работа в режиме многозадачности', reward: 100, emoji: '🎯' }
                    ];
                } else {
                    // Тесты для старичков (4 теста)
                    allTests = [
                        { name: 'Информационный стиль и редактура текста', reward: 100, emoji: '📝' },
                        { name: 'Тайм-менеджмент', reward: 100, emoji: '⏰' },
                        { name: 'Стресс-менеджмент', reward: 100, emoji: '🧘' },
                        { name: 'Work-Life balance: профилактика эмоционального выгорания', reward: 100, emoji: '⚖️' }
                    ];
                }

                let progressText = '📊 ПРОГРЕСС ОБУЧЕНИЯ 🎓\n\n';
                let completed = 0;
                let totalEarned = 0;

                allTests.forEach(testInfo => {
                    const test = tests.find(t => t.test_name === testInfo.name && t.completed === 1);
                    if (test) {
                        // Отображаем те же значения баллов, которые ввел пользователь
                        progressText += `✅ ${testInfo.emoji} ${testInfo.name} - ${test.points_earned} баллов\n`;
                        completed++;
                        totalEarned += test.points_earned;
                    } else {
                        progressText += `⏳ ${testInfo.emoji} ${testInfo.name} - ${testInfo.reward} баллов\n`;
                    }
                });

                progressText += `\n📈 Завершено: ${completed}/${allTests.length}\n`;
                progressText += `💰 Заработано: ${totalEarned} баллов\n`;

                if (completed >= allTests.length) {
                    progressText += '\n🎉 ОБУЧЕНИЕ ЗАВЕРШЕНО! 🏆\n🚀 Ты молодец!';
                } else {
                    progressText += '\n💪 Продолжай! Ты на верном пути!';
                }

                bot.sendMessage(chatId, progressText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show intern progress error:', error);
    }
}

function backToMainMenu(chatId, telegramId) {
    // [DEBUG LOG] Clear states on navigation to main menu
    if (global.userScreenshots[telegramId]) {
        console.log(`[NAV DEBUG] Clearing userScreenshots state for user ${telegramId}: ${JSON.stringify({type: global.userScreenshots[telegramId].type, step: global.userScreenshots[telegramId].step})}`);
        delete global.userScreenshots[telegramId];
    }
    delete global.userMenuContext[chatId];
    console.log(`[NAV DEBUG] backToMainMenu invoked for user ${telegramId}, context cleared`);
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err) {
                console.error('[NAV DEBUG] DB error in backToMainMenu:', err);
                return;
            }
            if (user) {
                console.log(`[NAV DEBUG] Fetching user ${user.id} for main menu display`);
                showMainMenu(chatId, user);
            } else {
                console.log(`[NAV DEBUG] No user found for ${telegramId} in backToMainMenu`);
            }
        });
    } catch (error) {
        console.error('❌ Back to main menu error:', error);
    }
}

function handleBackNavigation(chatId, telegramId) {
    // Clear event booking state if active
    if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'event_booking') {
        delete global.userScreenshots[telegramId];
    }
    let context = global.userMenuContext[chatId];
    if (!context || context.path.length <= 1) {
        console.log(`[NAV LOG] No context or root level, going to main for user ${telegramId}`);
        backToMainMenu(chatId, telegramId);
        return;
    }

    // Pop the last menu level
    context.path.pop();
    const newPath = context.path;
    console.log(`[NAV LOG] Back navigation for user ${telegramId}, popped to path: ${newPath.join(' -> ')}`);

    // Show previous menu based on new path
    const lastMenu = newPath[newPath.length - 1];
    switch (lastMenu) {
        case 'learning':
            showLearningMenu(chatId);
            break;
        case 'tests':
            showTestMenu(chatId);
            break;
        case 'personal':
            showPersonalMenu(chatId);
            break;
        case 'work':
            showWorkMenu(chatId, telegramId);
            break;
        case 'fun':
            showFunMenu(chatId);
            break;
        default:
            // Fallback to main
            console.log(`[NAV LOG] Unknown previous menu ${lastMenu}, fallback to main for ${telegramId}`);
            backToMainMenu(chatId, telegramId);
    }
}

// Helper function if needed (since chatId == telegramId in 1:1 bot chats)
function getTelegramIdFromChat(chatId) {
    return chatId; // Assuming direct chat
}

// ========== ФУНКЦИИ КУРСОВ ==========

function showCoursesMenu(chatId) {
    let context = global.userMenuContext[chatId] || { path: ['main'], menuFn: 'main' };
    if (context.path[context.path.length - 1] === 'learning') {
        context.path.push('courses');
        context.menuFn = 'courses';
    } else {
        context.path = ['main', 'learning', 'courses'];
        context.menuFn = 'courses';
    }
    global.userMenuContext[chatId] = context;
    console.log(`[NAV LOG] Entering courses menu for user ${chatId}, context: ${JSON.stringify(context)}`);

    // Get telegramId from chatId
    const telegramId = getTelegramIdFromChat(chatId);

    try {
        // Get user role first
        db.get("SELECT role FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err || !user) {
                console.error('❌ Error getting user role:', err);
                return;
            }

            // Define courses based on role
            let allCourses, coursesText, coursesKeyboardLayout;

            if (user.role === 'стажер') {
                // Курсы для стажеров (3 теста)
                allCourses = [
                    'Онбординг в Партнеркин',
                    'Основы эффективной коммуникации',
                    'Эффективная работа в режиме многозадачности'
                ];
                coursesText = '🎓 КУРСЫ ДЛЯ СТАЖЕРОВ 📚\n\n' +
                    'Онбординг в Партнеркин - 100 💰\n' +
                    'Основы эффективной коммуникации - 100 💰\n' +
                    'Эффективная работа в режиме многозадачности - 100 💰\n\n' +
                    '🚀 Прокачивай навыки и получай награды!\n' +
                    '💡 Выбери курс для изучения:';
                coursesKeyboardLayout = [
                    ['Онбординг в Партнеркин (+100 💰)'],
                    ['Основы эффективной коммуникации (+100 💰)'],
                    ['Эффективная работа в режиме многозадачности (+100 💰)'],
                    ['🔙 Назад в меню']
                ];
            } else {
                // Курсы для старичков (4 теста)
                allCourses = [
                    'Информационный стиль и редактура текста',
                    'Тайм-менеджмент',
                    'Стресс-менеджмент',
                    'Work-Life balance: профилактика эмоционального выгорания'
                ];
                coursesText = '🎓 ПРОФЕССИОНАЛЬНЫЕ КУРСЫ 📚\n\n' +
                    'Информационный стиль и редактура текста - 100 💰\n' +
                    'Тайм-менеджмент - 100 💰\n' +
                    'Стресс-менеджмент - 100 💰\n' +
                    'Work-Life balance: профилактика эмоционального выгорания - 100 💰\n\n' +
                    '🚀 Прокачивай навыки и получай награды!\n' +
                    '💡 Выбери курс для изучения:';
                coursesKeyboardLayout = [
                    ['Информационный стиль и редактура текста (+100 💰)'],
                    ['Тайм-менеджмент (+100 💰)'],
                    ['Стресс-менеджмент (+100 💰)'],
                    ['Work-Life balance: профилактика эмоционального выгорания (+100 💰)'],
                    ['🔙 Назад в меню']
                ];
            }

            const coursesKeyboard = {
                reply_markup: {
                    keyboard: coursesKeyboardLayout,
                    resize_keyboard: true
                }
            };

            // Check if user has completed all courses
            db.all(`SELECT DISTINCT test_name FROM test_submissions WHERE telegram_id = ? AND status = 'approved'`, [telegramId], (err, completedCourses) => {
                if (err) {
                    console.error('❌ Error checking completed courses:', err);
                    bot.sendMessage(chatId, coursesText, coursesKeyboard).catch(console.error);
                    return;
                }

                // Extract completed course names
                const completedCourseNames = completedCourses.map(course => course.test_name);

                // Check if all courses are completed
                const allCoursesCompleted = allCourses.every(course => completedCourseNames.includes(course));

                if (allCoursesCompleted) {
                    // Show congratulatory message
                    bot.sendMessage(chatId,
                        '🎉 Поздравляем! Ты прошел все доступные курсы! Ты большой молодец и настоящий эксперт! Продолжай в том же духе! 🚀',
                        { reply_markup: {
                            keyboard: mainMenuKeyboard.keyboard,
                            resize_keyboard: true
                        }}
                    ).catch(console.error);
                } else {
                    // Show courses menu
                    bot.sendMessage(chatId, coursesText, coursesKeyboard).catch(console.error);
                }
            });
        });
    } catch (error) {
        console.error('❌ Show courses menu error:', error);
    }
}

function selectCourse(chatId, telegramId, courseName, reward, link) {
    try {
        // Add duplicate prevention at the function level
        const courseActionKey = `${telegramId}_course_${courseName}`;
        const now = Date.now();
        if (global.lastActionTimes && global.lastActionTimes[courseActionKey] && (now - global.lastActionTimes[courseActionKey] < 1000)) {
            console.log(`[DUPLICATE PREVENTION] Ignoring duplicate course selection: ${courseActionKey} (${now - global.lastActionTimes[courseActionKey]}ms ago)`);
            return;
        }

        // Initialize global action tracking if not exists
        if (!global.lastActionTimes) {
            global.lastActionTimes = {};
        }
        global.lastActionTimes[courseActionKey] = now;
        bot.sendMessage(chatId, 
            `🎓 Курс: "${courseName}" 📖\n\n` +
            `🏆 Награда за прохождение: ${reward} П-коинов (при результате 90-100 баллов)\n` +
            `⏰ Длительность: ~2-3 часа\n` +
            `🖥️ Формат: Онлайн обучение\n` +
            `🎯 Сложность: Средний уровень\n\n` +
            `🌐 Ссылка на курс:\n${link}\n\n` +
            '📸 После завершения курса отправь скриншот сертификата!\n' +
            '🎯 Укажи итоговые баллы за курс.\n' +
            '💪 Удачи в обучении!').catch(console.error);
            
        // Сохраняем состояние для обработки скриншота курса
        global.userScreenshots[telegramId] = { 
            testName: courseName, 
            reward: reward, 
            type: 'course' 
        };
    } catch (error) {
        console.error('❌ Select course error:', error);
    }
}

// ========== ФУНКЦИИ PVP ==========

function showPVPMenu(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            bot.sendMessage(chatId, 
                `⚔️ PVP АРЕНА 🏟️\n\n` +
                `⚡ Твоя энергия: ${user.energy}%\n` +
                `💰 П-коинов: ${user.p_coins}\n\n` +
                '🎮 За сражение тратится 20% энергии\n' +
                '🎯 Можно выиграть или проиграть 10 П-коинов\n' +
                '🏆 Побеждает сильнейший!\n\n' +
                '🔥 Готов к бою?', pvpKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show PVP menu error:', error);
    }
}

function findOpponent(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            if (user.energy < 20) {
                bot.sendMessage(chatId, 
                    `😴 Недостаточно энергии! ⚡\n\n` +
                    `🔋 У тебя: ${user.energy}%\n` +
                    '⚡ Нужно: 20%\n\n' +
                    '💤 Восстанови силы и возвращайся! 🔄').catch(console.error);
                return;
            }
            
            if (user.p_coins < 50) {
                bot.sendMessage(chatId, 
                    '💸 Недостаточно П-коинов! 😢\n\n' +
                    '💰 Нужно минимум 50 коинов для сражения\n' +
                    '📚 Пройди тесты или курсы!').catch(console.error);
                return;
            }
            
            db.get(`SELECT * FROM users 
                    WHERE telegram_id != ? 
                    AND p_coins >= 50 
                    AND is_registered = 1 
                    ORDER BY RANDOM() LIMIT 1`, [telegramId], (err, opponent) => {
                
                if (!opponent) {
                    bot.sendMessage(chatId, 
                        '👻 Нет доступных противников 😔\n\n' +
                        '⏰ Попробуй чуть позже!').catch(console.error);
                    return;
                }
                
                const playerWins = Math.random() > 0.5;
                const pointsWon = 50;
                
                // Обновляем энергию игрока
                db.run("UPDATE users SET energy = energy - 20 WHERE telegram_id = ?", [telegramId]);
                
                if (playerWins) {
                    // Игрок победил
                    db.run("UPDATE users SET p_coins = p_coins + ? WHERE telegram_id = ?", [pointsWon, telegramId]);
                    db.run("UPDATE users SET p_coins = p_coins - ? WHERE telegram_id = ?", [pointsWon, opponent.telegram_id]);
                    
                    // Записываем битву в историю
                    db.run("INSERT INTO battles (attacker_id, defender_id, winner_id, points_won) VALUES (?, ?, ?, ?)",
                           [user.id, opponent.id, user.id, pointsWon]);
                    
                    bot.sendMessage(chatId, 
                        `🏆 ПОБЕДА! 🎉\n\n` +
                        `⚔️ Противник: @${opponent.username}\n` +
                        `💰 Получено: +${pointsWon} П-коинов\n` +
                        `⚡ Энергия: ${user.energy - 20}%\n\n` +
                        '🔥 Отлично сражался! 💪').catch(console.error);
                    
                    // Уведомляем побежденного
                    bot.sendMessage(opponent.telegram_id, 
                        `⚔️ НА ТЕБЯ НАПАЛИ! 😱\n\n` +
                        `🥊 Противник: @${user.username}\n` +
                        `💸 Проиграл ${pointsWon} П-коинов\n\n` +
                        '😤 В следующий раз отыграешься!').catch(console.error);
                } else {
                    // Игрок проиграл
                    db.run("UPDATE users SET p_coins = p_coins - ? WHERE telegram_id = ?", [pointsWon, telegramId]);
                    db.run("UPDATE users SET p_coins = p_coins + ? WHERE telegram_id = ?", [pointsWon, opponent.telegram_id]);
                    
                    // Записываем битву в историю
                    db.run("INSERT INTO battles (attacker_id, defender_id, winner_id, points_won) VALUES (?, ?, ?, ?)",
                           [user.id, opponent.id, opponent.id, pointsWon]);
                    
                    bot.sendMessage(chatId, 
                        `💀 ПОРАЖЕНИЕ 😔\n\n` +
                        `⚔️ Противник: @${opponent.username}\n` +
                        `💸 Потеряно: -${pointsWon} П-коинов\n` +
                        `⚡ Энергия: ${user.energy - 20}%\n\n` +
                        '💪 В следующий раз повезет больше!').catch(console.error);
                    
                    // Уведомляем победителя
                    bot.sendMessage(opponent.telegram_id, 
                        `⚔️ НА ТЕБЯ НАПАЛИ! 🥊\n\n` +
                        `🏆 Противник: @${user.username}\n` +
                        `💰 Победил! +${pointsWon} П-коинов!\n\n` +
                        '🎉 Отличная защита!').catch(console.error);
                }
            });
        });
    } catch (error) {
        console.error('❌ Find opponent error:', error);
    }
}

function showRating(chatId, telegramId) {
    try {
        db.all(`SELECT username, full_name, p_coins, role, position, position_level, registration_date, graduated_at
                FROM users
                WHERE is_registered = 1 
                ORDER BY p_coins DESC 
                LIMIT 10`, (err, users) => {
            
            if (!users || users.length === 0) {
                bot.sendMessage(chatId, 
                    '📊 Нет данных для рейтинга 🤷‍♂️\n' +
                    '⏰ Попробуй позже!').catch(console.error);
                return;
            }
            
            let ratingText = '🏆 ТОП-10 ПО П-КОИНАМ 💰\n\n';
            
            users.forEach((user, index) => {
                const name = getUserDisplayName(user);
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}. 🏅`;
                ratingText += `${medal} ${name} - ${user.p_coins} коинов\n`;
            });
            
            ratingText += '\n🔥 Кто следующий в топе?';
            
            bot.sendMessage(chatId, ratingText).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show rating error:', error);
    }
}

function restoreEnergy(chatId, telegramId) {
    try {
        db.run("UPDATE users SET energy = 100 WHERE telegram_id = ?", [telegramId], () => {
            bot.sendMessage(chatId, 
                '⚡ ЭНЕРГИЯ ВОССТАНОВЛЕНА! 🔋\n\n' +
                '💪 Энергия: 100%\n' +
                '🎯 Готов к 5 сражениям подряд!\n\n' +
                '🔥 Время показать всем кто тут босс! 👑').catch(console.error);
        });
    } catch (error) {
        console.error('❌ Restore energy error:', error);
    }
}

// ========== ФУНКЦИИ МАГАЗИНА ==========

function showShop(chatId, telegramId) {
    try {
        db.get("SELECT p_coins, company_points FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            bot.sendMessage(chatId, 
                `🛒 МАГАЗИН НАГРАД 🎁\n\n` +
                `Ваш баланс:\n` +
                `- ${user.company_points} баллов\n` +
                `- ${user.p_coins} П-коинов\n\n` +
                `Курс обмена: 10 П-коинов = 1 балл\n\n` +
                'Все товары покупаются за баллы. Обменять П-коины на баллы можно в кошельке.\n\n' +
                '🛍️ Что выберешь?', shopKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show shop error:', error);
    }
}

function buyItem(chatId, telegramId, itemName, price) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            if (user.company_points < price) {
                bot.sendMessage(chatId, 
                    `💸 Недостаточно баллов! 😢\n\n` +
                    `💰 У тебя: ${user.company_points} баллов\n` +
                    `🎯 Нужно: ${price} баллов\n` +
                    `📊 Не хватает: ${price - user.company_points} баллов\n\n` +
                    '💪 Обменяй П-коины на баллы в кошельке!').catch(console.error);
                return;
            }
            
            db.run("UPDATE users SET company_points = company_points - ? WHERE telegram_id = ?", [price, telegramId], () => {
                db.run("INSERT INTO purchases (user_id, item_name, price) VALUES (?, ?, ?)",
                       [user.id, itemName, price]);
                
                bot.sendMessage(chatId, 
                    `🎉 ПОКУПКА УСПЕШНА! 🛍️\n\n` +
                    `🎁 Товар: ${itemName}\n` +
                    `💸 Потрачено: ${price} баллов\n` +
                    `💰 Остаток: ${user.company_points - price} баллов\n\n` +
                    '👤 Обратись к HR для получения товара!\n' +
                    '🎊 Наслаждайся покупкой!').catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Buy item error:', error);
    }
}

// ========== ФУНКЦИИ МЕРОПРИЯТИЙ ==========

function showEventsMenu(chatId) {
    try {
        bot.sendMessage(chatId, 
            '🎯 КОРПОРАТИВНЫЕ МЕРОПРИЯТИЯ 🎉\n\n' +
            '🏃‍♂️ Зарядка - 50 П-коинов ⚡\n' +
            '🎰 Турнир по покеру - 100 П-коинов 🃏\n' +
            '🎉 Корпоративная вечеринка - 150 П-коинов 🥳\n' +
            '📚 Обучающие тренинги - 200 П-коинов 🎓\n\n' +
            '📅 Выбери мероприятие для записи!\n' +
            '⏰ Доступны тайм-слоты на выбор!', eventsKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Show events menu error:', error);
    }
}

function showEventSlots(chatId, telegramId, eventName) {
    try {
        db.all("SELECT * FROM event_slots WHERE category = ? AND status = 'active' AND current_participants < max_participants ORDER BY date, time", 
               [eventName], (err, slots) => {
            
            if (!slots || slots.length === 0) {
                bot.sendMessage(chatId, 
                    `📅 ${eventName} 🎯\n\n` + 
                    'В этой категории пока нет доступных мероприятий. 😕').catch(console.error);
                return;
            }
            
            let slotsText = `📅 ${eventName} - доступные слоты! 🎯\n\n`;
            
            slots.forEach((slot, index) => {
                const availableSpots = slot.max_participants - slot.current_participants;
                slotsText += `${index + 1}. 📍 ${slot.date} в ${slot.time}\n`;
                slotsText += `   🏢 Место: ${slot.location}\n`;
                slotsText += `   👥 Свободно мест: ${availableSpots}\n`;
                slotsText += `   💰 Награда: ${slot.points_reward} П-коинов\n\n`;
            });
            
            slotsText += '🎯 Для записи напиши номер слота!\n' +
                        '✏️ Например: 1';
            
            bot.sendMessage(chatId, slotsText).catch(console.error);
            
            // Сохраняем информацию для записи на мероприятие
            global.userScreenshots[telegramId] = { 
                type: 'event_booking', 
                eventName: eventName, 
                slots: slots 
            };
        });
    } catch (error) {
        console.error('❌ Show event slots error:', error);
    }
}

function bookEventSlot(chatId, telegramId, slot) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;
            
            // Проверяем, не записан ли уже пользователь
            db.get("SELECT * FROM event_bookings WHERE user_id = ? AND slot_id = ?", 
                   [user.id, slot.id], (err, existing) => {
                
                if (existing) {
                    bot.sendMessage(chatId, 
                        '😅 Ты уже записан на это мероприятие! 📅\n' +
                        '🎯 Выбери другой слот!').catch(console.error);
                    return;
                }
                
                // Проверяем есть ли еще места
                if (slot.current_participants >= slot.max_participants) {
                    bot.sendMessage(chatId, 
                        '😔 Места закончились! 📵\n' +
                        '⏰ Выбери другое время!').catch(console.error);
                    return;
                }
                
                // Записываем пользователя
                db.run("INSERT INTO event_bookings (user_id, slot_id) VALUES (?, ?)", 
                       [user.id, slot.id], () => {
                    
                    // Увеличиваем счетчик участников
                    db.run("UPDATE event_slots SET current_participants = current_participants + 1 WHERE id = ?", 
                           [slot.id]);
                    
                    bot.sendMessage(chatId, 
                        `🎉 УСПЕШНАЯ ЗАПИСЬ! ✅\n\n` +
                        `🎯 Мероприятие: ${slot.event_name}\n` +
                        `📅 Дата: ${slot.date}\n` +
                        `⏰ Время: ${slot.time}\n` +
                        `🏢 Место: ${slot.location}\n` +
                        `💰 Награда: ${slot.points_reward} П-коинов\n\n` +
                        '🔔 Не забудь прийти вовремя!\n' +
                        '💫 Увидимся на мероприятии!').catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Book event slot error:', error);
    }
}

function showAllEventSlots(chatId) {
    console.log(`[DEBUG USER VIEW] showAllEventSlots called for chatId ${chatId}`);
    try {
        db.all("SELECT * FROM event_slots WHERE status = 'active' ORDER BY date, time", (err, slots) => {
            console.log(`[DEBUG USER VIEW] DB query completed, slots count: ${slots ? slots.length : 0}, error: ${err ? 'Yes' : 'No'}`);
            if (!slots || slots.length === 0) {
                bot.sendMessage(chatId,
                    '📅 РАСПИСАНИЕ ВСЕХ МЕРОПРИЯТИЙ 🗓️\n\n' +
                    '⏰ Пока что занятий нет, но уже в процессе их размещения! 🔄\n\n' +
                    '👨‍💼 Администраторы работают над расписанием!\n' +
                    '🔔 Следи за обновлениями!\n' +
                    '💫 Скоро будет много интересного!').catch((sendErr) => console.error('Send empty message error:', sendErr));
                return;
            }
            
            let scheduleText = '📅 РАСПИСАНИЕ ВСЕХ МЕРОПРИЯТИЙ 🗓️\n\n';
            
            slots.forEach((slot, index) => {
                const availableSpots = slot.max_participants - slot.current_participants;
                scheduleText += `${index + 1}. 🎯 ${slot.event_name}\n`;
                scheduleText += `📅 ${slot.date} в ${slot.time}\n`;
                scheduleText += `🏢 ${slot.location}\n`;
                scheduleText += `👥 Свободно: ${availableSpots}/${slot.max_participants}\n`;
                scheduleText += `💰 ${slot.points_reward} П-коинов\n\n`;
            });
            
            scheduleText += '🎯 Для записи выбери конкретное мероприятие!';
            
            console.log(`[DEBUG USER VIEW] Sending message with ${slots.length} slots`);
            bot.sendMessage(chatId, scheduleText).catch((sendErr) => {
                console.error('❌ User view send error:', sendErr);
            });
            console.log(`[DEBUG USER VIEW] Message sent successfully`);
        });
    } catch (error) {
        console.error('❌ Show all event slots error:', error);
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function showTasksMenu(chatId, telegramId) {
    try {
        bot.sendMessage(chatId,
            '📋 СИСТЕМА ЗАДАЧ 🎯\n\n' +
            '📝 Управляй задачами и зарабатывай баллы!\n' +
            '🎯 Создавай задачи для коллег\n' +
            '📊 Отслеживай прогресс\n\n' +
            '👇 Выбери действие:', tasksKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Show tasks menu error:', error);
    }
}

function startGiftProcess(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            if (user.p_coins < config.GAME.min_gift_amount) {
                bot.sendMessage(chatId,
                    `💸 Недостаточно П-коинов! 😢\n\n` +
                    `💰 У тебя: ${user.p_coins} коинов\n` +
                    `🎯 Минимум для подарка: ${config.GAME.min_gift_amount} коинов\n\n` +
                    '💪 Пройди тесты или курсы!').catch(console.error);
                return;
            }

            // Проверяем лимит подарков за день
            db.get(`SELECT SUM(amount) as total_gifted
                    FROM gifts
                    WHERE sender_id = ?
                    AND gift_date::date = CURRENT_DATE`, [user.id], (err, giftStats) => {

                const todayGifted = giftStats?.total_gifted || 0;
                const remaining = config.GAME.max_gift_per_day - todayGifted;

                if (remaining <= 0) {
                    bot.sendMessage(chatId,
                        `🚫 Лимит подарков на сегодня исчерпан! 📅\n\n` +
                        `💰 Подарено сегодня: ${todayGifted} коинов\n` +
                        `🎯 Дневной лимит: ${config.GAME.max_gift_per_day} коинов\n\n` +
                        '⏰ Попробуй завтра!').catch(console.error);
                    return;
                }

                global.userScreenshots[telegramId] = {
                    type: 'gift',
                    step: 'select_user',
                    remaining: remaining,
                    failed_attempts: 0
                };

                // Показываем список пользователей для подарка
                db.all(`SELECT username, full_name, telegram_id, role, position, position_level, registration_date, graduated_at
                        FROM users
                        WHERE telegram_id != ?
                        AND is_registered = 1
                        ORDER BY full_name`, [telegramId], (err, users) => {

                    if (!users || users.length === 0) {
                        bot.sendMessage(chatId, '👻 Нет пользователей для подарка!').catch(console.error);
                        return;
                    }

                    let usersList = '🎁 ПОДАРИТЬ П-КОИНЫ 💝\n\n';
                    usersList += `💰 Доступно к подарку: ${remaining} коинов\n`;
                    usersList += `📊 Минимум: ${config.GAME.min_gift_amount} коинов\n\n`;
                    usersList += '👥 Выбери получателя:\n\n';

                    users.forEach((u, index) => {
                        const name = getUserDisplayName(u);
                        usersList += `${index + 1}. ${name} (@${u.username})\n`;
                    });

                    usersList += '\n✏️ Напиши номер пользователя:';

                    global.userScreenshots[telegramId].users = users;
                    bot.sendMessage(chatId, usersList).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Start gift process error:', error);
    }
}

function startPcoinExchange(chatId, telegramId) {
    db.get("SELECT p_coins, company_points FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Ошибка. Не удалось найти ваш профиль.');
            return;
        }

        const message = `🏦 **Обмен П-коинов на баллы**\n\n` +
                        `Текущий курс: **10 П-коинов = 1 балл**\n\n` +
                        `У вас в наличии:\n` +
                        `- ${user.p_coins} П-коинов\n` +
                        `- ${user.company_points} баллов\n\n` +
                        `Сколько П-коинов вы хотите обменять? Введите сумму, кратную 10.`;

        global.userScreenshots[telegramId] = {
            type: 'pcoin_exchange',
            step: 'enter_amount'
        };

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
}

function handleGiftProcess(chatId, telegramId, text) {
    // [DEBUG LOG] Gift process entry
    const giftState = global.userScreenshots[telegramId];
    console.log(`[GIFT DEBUG] User ${telegramId} text "${text}" | Step: ${giftState ? giftState.step : 'none'}`);
    
    try {
        const giftData = global.userScreenshots[telegramId];

        if (giftData.step === 'select_user') {
            const userIndex = parseInt(text) - 1;

            if (isNaN(userIndex) || userIndex < 0 || userIndex >= giftData.users.length) {
                // [DEBUG LOG] Invalid user number in gift selection
                console.log(`[GIFT DEBUG] Invalid user index "${text}" for user ${telegramId}, users length: ${giftData.users.length}`);
                bot.sendMessage(chatId, '❌ Неверный номер пользователя! Попробуй еще раз 🔢').catch(console.error);
                return;
            }

            giftData.selectedUser = giftData.users[userIndex];
            giftData.step = 'enter_amount';

            bot.sendMessage(chatId,
                `🎁 Получатель: ${getUserDisplayName(giftData.selectedUser)}\n\n` +
                `💰 Доступно: ${giftData.remaining} коинов\n` +
                `📊 Минимум: ${config.GAME.min_gift_amount} коинов\n\n` +
                '💎 Сколько коинов подарить?\n' +
                '✏️ Напиши число:').catch(console.error);

        } else if (giftData.step === 'enter_amount') {
            const amount = parseInt(text);

            if (isNaN(amount) || amount < config.GAME.min_gift_amount || amount > giftData.remaining) {
                bot.sendMessage(chatId,
                    `❌ Неверная сумма! 💸\n\n` +
                    `📊 Минимум: ${config.GAME.min_gift_amount} коинов\n` +
                    `💰 Максимум: ${giftData.remaining} коинов\n\n` +
                    '🔢 Попробуй еще раз:').catch(console.error);
                return;
            }

            giftData.amount = amount;
            giftData.step = 'enter_message';

            bot.sendMessage(chatId,
                `🎁 Подарок готов! 💝\n\n` +
                `👤 Получатель: ${getUserDisplayName(giftData.selectedUser)}\n` +
                `💰 Сумма: ${amount} П-коинов\n\n` +
                '💌 Добавь сообщение к подарку:\n' +
                '✏️ (или напиши "без сообщения")').catch(console.error);

        } else if (giftData.step === 'enter_message') {
            const message = text === 'без сообщения' ? null : text;
            processGift(chatId, telegramId, giftData, message);
        }
    } catch (error) {
        console.error('❌ Handle gift process error:', error);
    }
}

function processGift(chatId, telegramId, giftData, message) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, sender) => {
            if (!sender) return;

            db.get("SELECT id FROM users WHERE telegram_id = ?", [giftData.selectedUser.telegram_id], (err, receiver) => {
                if (!receiver) return;

                // Проверяем еще раз баланс отправителя
                db.get("SELECT p_coins FROM users WHERE id = ?", [sender.id], (err, senderData) => {
                    if (!senderData || senderData.p_coins < giftData.amount) {
                        bot.sendMessage(chatId, '❌ Недостаточно средств!').catch(console.error);
                        delete global.userScreenshots[telegramId];
                        return;
                    }

                    // Переводим коины
                    db.run("UPDATE users SET p_coins = p_coins - ? WHERE id = ?", [giftData.amount, sender.id]);
                    db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [giftData.amount, receiver.id]);

                    // Записываем подарок в историю
                    db.run("INSERT INTO gifts (sender_id, receiver_id, amount, message) VALUES (?, ?, ?, ?)",
                           [sender.id, receiver.id, giftData.amount, message], () => {

                        // Уведомляем отправителя
                        bot.sendMessage(chatId,
                            `🎉 ПОДАРОК ОТПРАВЛЕН! 💝\n\n` +
                            `👤 Получатель: ${getUserDisplayName(giftData.selectedUser)}\n` +
                            `💰 Сумма: ${giftData.amount} П-коинов\n` +
                            `💌 Сообщение: ${message || 'без сообщения'}\n\n` +
                            '🎊 Спасибо за щедрость!').catch(console.error);

                        // Уведомляем получателя
                        const senderName = global.userScreenshots[telegramId]?.senderName || 'Коллега';
                        bot.sendMessage(giftData.selectedUser.telegram_id,
                            `🎁 ТЕБЕ ПОДАРОК! 💝\n\n` +
                            `👤 От: ${senderName}\n` +
                            `💰 Сумма: +${giftData.amount} П-коинов\n` +
                            `💌 Сообщение: ${message || 'без сообщения'}\n\n` +
                            '🥳 Поздравляем с подарком!').catch(console.error);

                        delete global.userScreenshots[telegramId];
                    });
                });
            });
        });
    } catch (error) {
        console.error('❌ Process gift error:', error);
    }
}

// Генерация уникального адреса кошелька
function generateWalletAddress() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
    let address = 'PK'; // Префикс для Партнеркино
    for (let i = 0; i < 32; i++) {
        address += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return address;
}

function showWallet(chatId, telegramId) {
    console.log(`[showWallet] Called for chatId: ${chatId}, telegramId: ${telegramId}`);
    db.get("SELECT wallet_address, p_coins, company_points FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        console.log(`[showWallet] Query result - err:`, err, `user:`, user);
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Ошибка! Пользователь не найден.');
            return;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '💸 Отправить П-коины', callback_data: 'start_pcoin_transfer' },
                    { text: '🏦 Обмен на баллы', callback_data: 'start_pcoin_exchange' }
                ],
                [
                    { text: '🙏 Попросить П-коины', callback_data: 'start_pcoin_request' },
                    { text: '🤝 Мой QR-код', callback_data: 'generate_my_qr' }
                ]
            ]
        };

        if (user.wallet_address) {
            bot.sendMessage(chatId, 
                `👛 **Ваш кошелек**\n\n` +
                `**Адрес:** \`${user.wallet_address}\`\n` +
                `**Баланс:** ${user.p_coins} П-коинов\n` +
                `**Баллы:** ${user.company_points} баллов`,
                { parse_mode: 'Markdown', reply_markup: keyboard }
            );
        } else {
            const newAddress = generateWalletAddress();
            db.run("UPDATE users SET wallet_address = ? WHERE telegram_id = ?", [newAddress, telegramId], (err) => {
                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка при создании кошелька. Попробуйте еще раз.');
                    return;
                }
                bot.sendMessage(chatId, 
                    `🎉 **Вам создан новый кошелек!**\n\n` +
                    `**Адрес:** \`${newAddress}\`\n` +
                    `**Баланс:** ${user.p_coins} П-коинов\n` +
                    `**Баллы:** ${user.company_points} баллов`,
                    { parse_mode: 'Markdown', reply_markup: keyboard }
                );
            });
        }
    });
}

function startPcoinTransfer(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'pcoin_transfer',
        step: 'enter_wallet_address'
    };
    bot.sendMessage(chatId, 'Введите адрес кошелька получателя:');
}

function startPcoinRequest(chatId, telegramId) {
    db.all(`SELECT * FROM users WHERE telegram_id != ? AND is_registered = 1 ORDER BY full_name`, [telegramId], (err, users) => {
        if (err || !users || users.length === 0) {
            bot.sendMessage(chatId, '❌ Не найдено других пользователей, у кого можно попросить П-коины.');
            return;
        }

        let usersList = '🙏 У кого вы хотите попросить П-коины?\n\nВыберите пользователя из списка, написав его номер:\n\n';
        users.forEach((u, index) => {
            usersList += `${index + 1}. ${getUserDisplayName(u)}\n`;
        });

        global.userScreenshots[telegramId] = {
            type: 'pcoin_request',
            step: 'select_target',
            users: users
        };

        bot.sendMessage(chatId, usersList);
    });
}

// ========== ФУНКЦИИ ЗАДАЧ ==========

function showMyTasks(chatId, telegramId) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT t.*,
                    u_creator.full_name as creator_name, u_creator.username as creator_username
                    FROM tasks t
                    LEFT JOIN users u_creator ON t.creator_id = u_creator.id
                    WHERE t.assignee_id = ? AND t.status IN ('pending', 'in_progress')
                    ORDER BY t.status ASC, t.due_date ASC, t.priority DESC`, [user.id], (err, tasks) => {

                if (!tasks || tasks.length === 0) {
                    bot.sendMessage(chatId,
                        '📝 МОИ ЗАДАЧИ 🎯\n\n' +
                        '✅ Нет активных задач! 🎉\n\n' +
                        '🚀 Отличная работа! Можешь отдохнуть или взять новые задачи!').catch(console.error);
                    return;
                }

                bot.sendMessage(chatId, '📝 МОИ АКТИВНЫЕ ЗАДАЧИ 🎯\n\n');

                tasks.forEach((task, index) => {
                    const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
                    const creatorName = task.creator_name || task.creator_username || 'Система';
                    const dueDate = task.due_date ? new Date(task.due_date).toLocaleString('ru-RU') : 'без срока';
                    const statusEmoji = task.status === 'in_progress' ? '▶️ В работе' : '⏳ Ожидает';

                    let taskText = `${index + 1}. ${statusEmoji} ${priority} ${task.title}\n`;
                    taskText += `   📝 ${task.description || 'Описание отсутствует'}\n`;
                    taskText += `   👤 От: ${creatorName}\n`;
                    taskText += `   📅 Срок: ${dueDate}\n`;
                    if (task.reward_coins > 0) {
                        taskText += `   💰 Награда: ${task.reward_coins} П-коинов\n`;
                    }

                    const keyboard = {
                        inline_keyboard: [[{
                            text: '✅ Завершить',
                            callback_data: `complete_task_${task.id}`
                        }]]
                    };

                    bot.sendMessage(chatId, taskText, { reply_markup: keyboard }).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Show my tasks error:', error);
    }
}

function showCompletedTasks(chatId, telegramId) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT t.*,
                    u_creator.full_name as creator_name, u_creator.username as creator_username
                    FROM tasks t
                    LEFT JOIN users u_creator ON t.creator_id = u_creator.id
                    WHERE t.assignee_id = ? AND t.status = 'completed'
                    ORDER BY t.completed_date DESC
                    LIMIT 10`, [user.id], (err, tasks) => {

                if (!tasks || tasks.length === 0) {
                    bot.sendMessage(chatId,
                        '✅ ЗАВЕРШЕННЫЕ ЗАДАЧИ 🏆\n\n' +
                        '📋 Пока нет завершенных задач\n\n' +
                        '💪 Начни выполнять активные задачи!').catch(console.error);
                    return;
                }

                let tasksText = '✅ ПОСЛЕДНИЕ ЗАВЕРШЕННЫЕ ЗАДАЧИ 🏆\n\n';

                tasks.forEach((task, index) => {
                    const creatorName = task.creator_name || task.creator_username || 'Система';
                    const completedDate = new Date(task.completed_date).toLocaleDateString('ru-RU');

                    tasksText += `${index + 1}. ✅ ${task.title}\n`;
                    tasksText += `   👤 От: ${creatorName}\n`;
                    tasksText += `   📅 Выполнено: ${completedDate}\n`;
                    if (task.reward_coins > 0) {
                        tasksText += `   💰 Получено: ${task.reward_coins} П-коинов\n`;
                    }
                    tasksText += '\n';
                });

                bot.sendMessage(chatId, tasksText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show completed tasks error:', error);
    }
}

function startTaskCreation(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            global.userScreenshots[telegramId] = {
                type: 'task_creation',
                step: 'select_assignee',
                taskData: {
                    creator_id: user.id,
                    priority: 'medium',
                    reward_coins: 0
                },
                failed_attempts: 0
            };

            // Показываем список пользователей для назначения задачи
            db.all(`SELECT username, full_name, telegram_id, id
                    FROM users
                    WHERE telegram_id != ?
                    AND is_registered = 1
                    ORDER BY full_name`, [telegramId], (err, users) => {

                if (!users || users.length === 0) {
                    bot.sendMessage(chatId, '👻 Нет пользователей для назначения задач!').catch(console.error);
                    return;
                }

                let usersList = '🎯 СОЗДАТЬ ЗАДАЧУ 📝\n\n';
                usersList += '👥 Выбери исполнителя:\n\n';

                users.forEach((u, index) => {
                    const name = u.full_name || u.username || 'Неизвестный';
                    usersList += `${index + 1}. ${name} (@${u.username})\n`;
                });

                usersList += '\n✏️ Напиши номер пользователя:';

                global.userScreenshots[telegramId].users = users;
                bot.sendMessage(chatId, usersList).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Start task creation error:', error);
    }
}

function showTeamTasks(chatId, telegramId) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT t.*,
                    u_creator.full_name as creator_name, u_creator.username as creator_username,
                    u_assignee.full_name as assignee_name, u_assignee.username as assignee_username
                    FROM tasks t
                    LEFT JOIN users u_creator ON t.creator_id = u_creator.id
                    LEFT JOIN users u_assignee ON t.assignee_id = u_assignee.id
                    WHERE t.creator_id = ? OR t.assignee_id = ?
                    ORDER BY t.created_date DESC
                    LIMIT 15`, [user.id, user.id], (err, tasks) => {

                if (!tasks || tasks.length === 0) {
                    bot.sendMessage(chatId,
                        '👥 ЗАДАЧИ КОМАНДЫ 🎯\n\n' +
                        '📋 Пока нет задач в команде\n\n' +
                        '🎯 Создай первую задачу!').catch(console.error);
                    return;
                }

                let tasksText = '👥 ЗАДАЧИ КОМАНДЫ 🎯\n\n';

                tasks.forEach((task, index) => {
                    const creatorName = task.creator_name || task.creator_username || 'Система';
                    const assigneeName = task.assignee_name || task.assignee_username || 'Неизвестный';
                    const status = task.status === 'completed' ? '✅' : '⏳';
                    const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';

                    tasksText += `${index + 1}. ${status} ${priority} ${task.title}\n`;
                    tasksText += `   👤 ${creatorName} → ${assigneeName}\n`;
                    tasksText += `   📅 ${new Date(task.created_date).toLocaleDateString('ru-RU')}\n\n`;
                });

                bot.sendMessage(chatId, tasksText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show team tasks error:', error);
    }
}

function completeTask(chatId, telegramId, taskId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.get("SELECT t.*, u_creator.full_name as creator_name, u_creator.username as creator_username FROM tasks t LEFT JOIN users u_creator ON t.creator_id = u_creator.id WHERE t.id = ? AND t.assignee_id = ?", [taskId, user.id], (err, task) => {
                if (!task) {
                    bot.sendMessage(chatId, '❌ Задача не найдена или у вас нет прав на ее завершение.');
                    return;
                }

                // Отмечаем задачу как выполненную
                db.run("UPDATE tasks SET status = 'completed', completed_date = CURRENT_TIMESTAMP WHERE id = ?",
                       [taskId], () => {

                    // Cancel any pending reminders for this task
                    cancelTaskReminder(taskId);

                    // Начисляем награду если есть
                    if (task.reward_coins > 0) {
                        db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?",
                               [task.reward_coins, user.id]);
                    }

                    // Уведомляем исполнителя
                    bot.sendMessage(chatId,
                        `✅ ЗАДАЧА ВЫПОЛНЕНА! 🎉\n\n` +
                        `📝 "${task.title}"\n` +
                        `👤 От: ${task.creator_name || task.creator_username || 'Система'}\n` +
                        (task.reward_coins > 0 ? `💰 Получено: +${task.reward_coins} П-коинов\n` : '') +
                        '\n🏆 Отличная работа!').catch(console.error);

                    // Уведомляем создателя задачи
                    if (task.creator_id && task.creator_id !== user.id) {
                        db.get("SELECT * FROM users WHERE id = ?",
                               [task.creator_id], (err, creator) => {
                            if (creator) {
                                const executorName = getUserDisplayName(user);
                                bot.sendMessage(creator.telegram_id,
                                    `✅ ЗАДАЧА ВЫПОЛНЕНА! 🎉\n\n` +
                                    `📝 "${task.title}"\n` +
                                    `👤 Исполнитель: ${executorName}\n` +
                                    `📅 Выполнено: ${new Date().toLocaleDateString('ru-RU')}\n\n` +
                                    '🎯 Задача завершена успешно!').catch(console.error);
                            }
                        });
                    }
                });
            });
        });
    } catch (error) {
        console.error('❌ Complete task error:', error);
    }
}

function showUserStats(chatId, telegramId) {
    try {
        db.get(`SELECT u.*, 
                (SELECT COUNT(*) FROM battles WHERE winner_id = u.id) as wins,
                (SELECT COUNT(*) FROM battles WHERE (attacker_id = u.id OR defender_id = u.id) AND winner_id != u.id) as losses,
                (SELECT COUNT(*) FROM purchases WHERE user_id = u.id) as purchases_count,
                (SELECT COUNT(*) FROM event_bookings WHERE user_id = u.id) as events_count
                FROM users u WHERE u.telegram_id = ?`, [telegramId], (err, stats) => {
            
            if (!stats) return;
            
            const winRate = stats.wins + stats.losses > 0 ? 
                Math.round((stats.wins / (stats.wins + stats.losses)) * 100) : 0;
            
            const statsText = 
                '📊 ТВОЯ СТАТИСТИКА 🎯\n\n' +
                `👤 Имя: ${getUserDisplayName(stats)}\n` +
                `💰 П-коинов: ${stats.p_coins}\n` +
                `⚡ Энергия: ${stats.energy}%\n` +
                `🎭 Роль: ${stats.role}\n\n` +
                '⚔️ PVP Статистика:\n' +
                `🏆 Побед: ${stats.wins || 0}\n` +
                `💀 Поражений: ${stats.losses || 0}\n` +
                `📊 Винрейт: ${winRate}%\n\n` +
                '🎯 Активность:\n' +
                `🛍️ Покупок: ${stats.purchases_count || 0}\n` +
                `🎉 Мероприятий: ${stats.events_count || 0}\n\n` +
                `📅 Зарегистрирован: ${new Date(stats.registration_date).toLocaleDateString('ru-RU')}\n\n` +
                '🔥 Продолжай в том же духе!';
            
            bot.sendMessage(chatId, statsText).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show user stats error:', error);
    }
}

// ========== АДМИНСКИЕ ФУНКЦИИ ==========

function handleAdminLogin(chatId, telegramId) {
    console.log("<<<<< EXECUTING NEW ADMIN LOGIN LOGIC (v4 - DIAGNOSTIC) >>>>>");
    try {
        // Find the user in the main users table to get their user.id
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            // We removed the role check here. Any registered user can become an admin for the demo.
            if (err || !user) {
                bot.sendMessage(chatId, 
                    '❌ Ошибка! Пользователь не найден. Сначала зарегистрируйтесь в боте через /start.').catch(console.error);
                return;
            }

            // Check if the user is already an admin
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
                if (err) {
                    console.error('Admin check DB error:', err);
                    bot.sendMessage(chatId, '❌ Произошла ошибка базы данных при проверке прав.');
                    return;
                }

                if (admin) {
                    // User is already an admin, just show the menu
                    bot.sendMessage(chatId, 
                        '🔑 Вы уже в админке! Что будем делать?', adminKeyboard).catch(console.error);
                } else {
                    // User is not an admin, add them
                    db.run("INSERT INTO admins (user_id, telegram_id) VALUES (?, ?)", 
                           [user.id, telegramId], (err) => {
                        if (err) {
                            console.error('Admin login DB error:', err);
                            bot.sendMessage(chatId, '❌ Произошла ошибка базы данных при входе в админку.');
                            return;
                        }
                        bot.sendMessage(chatId, 
                            '🔑 ДОБРО ПОЖАЛОВАТЬ В АДМИНКУ! 👨‍💼\n\n' +
                            '🎯 Теперь у тебя есть суперсилы!\n' +
                            '📊 Управляй ботом как хочешь!\n\n' +
                            '🚀 Что будем делать?', adminKeyboard).catch(console.error);
                    });
                }
            });
        });
    } catch (error) {
        console.error('❌ Admin login error:', error);
    }
}

function exitAdminMode(chatId, telegramId) {
    try {
        db.run("DELETE FROM admins WHERE telegram_id = ?", [telegramId], () => {
            bot.sendMessage(chatId, 
                '👋 Выход из админки! 🚪\n\n' +
                '🎯 Возвращаемся в обычный режим!').catch(console.error);
            backToMainMenu(chatId, telegramId);
        });
    } catch (error) {
        console.error('❌ Exit admin mode error:', error);
    }
}

// ========== СОЗДАНИЕ МЕРОПРИЯТИЙ АДМИНОМ ==========

function startEventCreation(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }
            
            global.adminStates[telegramId] = {
                step: 'category',
                eventData: {}
            };
            
            bot.sendMessage(chatId, 
                '🗓️ СОЗДАНИЕ НОВОГО МЕРОПРИЯТИЯ! ✨\n\n' +
                '🎯 Шаг 1: Выбери категорию мероприятия\n\n' +
                '👇 Нажми на кнопку с нужной категорией:', 
                eventCategoryKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Start event creation error:', error);
    }
}

function handleAdminEventCreation(chatId, telegramId, text) {
    try {
        if (!global.adminStates[telegramId]) return;

        const state = global.adminStates[telegramId];

        if (text === '❌ Отмена') {
            delete global.adminStates[telegramId];
            bot.sendMessage(chatId, '❌ Действие отменено!', adminKeyboard).catch(console.error);
            return;
        }

        // Обработка редактирования слота
        if (state.step === 'select_slot_edit') {
            const slotId = parseInt(text);
            const slot = state.slots.find(s => s.id === slotId);

            if (!slot) {
                bot.sendMessage(chatId, '❌ Мероприятие с таким ID не найдено!').catch(console.error);
                return;
            }

            state.selectedSlot = slot;
            state.step = 'edit_field';

            bot.sendMessage(chatId,
                `✏️ РЕДАКТИРОВАНИЕ: ${slot.event_name}\n\n` +
                `📅 Дата: ${slot.date}\n` +
                `⏰ Время: ${slot.time}\n` +
                `📍 Место: ${slot.location}\n` +
                `👥 Участников: ${slot.max_participants}\n` +
                `💰 Награда: ${slot.points_reward}\n` +
                `📊 Статус: ${slot.status}\n\n` +
                'Что изменить?\n' +
                '1. Дату\n' +
                '2. Время\n' +
                '3. Место\n' +
                '4. Количество участников\n' +
                '5. Награду\n' +
                '6. Статус (активен/неактивен)\n\n' +
                '🔢 Напиши номер:').catch(console.error);
            return;
        }

        // Обработка удаления слота
        if (state.step === 'select_slot_delete') {
            const slotId = parseInt(text);
            const slot = state.slots.find(s => s.id === slotId);

            if (!slot) {
                bot.sendMessage(chatId, '❌ Мероприятие с таким ID не найдено!').catch(console.error);
                return;
            }

            db.run("DELETE FROM event_slots WHERE id = ?", [slotId], () => {
                bot.sendMessage(chatId,
                    `🗑️ МЕРОПРИЯТИЕ УДАЛЕНО!\n\n` +
                    `❌ "${slot.event_name}" удалено\n` +
                    `📅 ${slot.date} в ${slot.time}\n\n` +
                    '✅ Операция завершена!', adminKeyboard).catch(console.error);

                delete global.adminStates[telegramId];
            });
            return;
        }

        // Обработка изменения полей
        if (state.step === 'edit_field') {
            const fieldNumber = parseInt(text);
            const slot = state.selectedSlot;

            switch (fieldNumber) {
                case 1:
                    state.editField = 'date';
                    state.step = 'edit_value';
                    bot.sendMessage(chatId,
                        '📅 ИЗМЕНИТЬ ДАТУ\n\n' +
                        `Текущая: ${slot.date}\n\n` +
                        'Формат: ДД.ММ.ГГГГ\n' +
                        'Напиши новую дату:').catch(console.error);
                    break;
                case 2:
                    state.editField = 'time';
                    state.step = 'edit_value';
                    bot.sendMessage(chatId,
                        '⏰ ИЗМЕНИТЬ ВРЕМЯ\n\n' +
                        `Текущее: ${slot.time}\n\n` +
                        'Формат: ЧЧ:ММ\n' +
                        'Напиши новое время:').catch(console.error);
                    break;
                case 3:
                    state.editField = 'location';
                    state.step = 'edit_value';
                    bot.sendMessage(chatId,
                        '📍 ИЗМЕНИТЬ МЕСТО\n\n' +
                        `Текущее: ${slot.location}\n\n` +
                        'Напиши новое место:').catch(console.error);
                    break;
                case 4:
                    state.editField = 'max_participants';
                    state.step = 'edit_value';
                    bot.sendMessage(chatId,
                        '👥 ИЗМЕНИТЬ КОЛИЧЕСТВО УЧАСТНИКОВ\n\n' +
                        `Текущее: ${slot.max_participants}\n\n` +
                        'Напиши новое количество:').catch(console.error);
                    break;
                case 5:
                    state.editField = 'points_reward';
                    state.step = 'edit_value';
                    bot.sendMessage(chatId,
                        '💰 ИЗМЕНИТЬ НАГРАДУ\n\n' +
                        `Текущая: ${slot.points_reward} коинов\n\n` +
                        'Напиши новую награду:').catch(console.error);
                    break;
                case 6:
                    const newStatus = slot.status === 'active' ? 'inactive' : 'active';
                    db.run("UPDATE event_slots SET status = ? WHERE id = ?", [newStatus, slot.id], () => {
                        bot.sendMessage(chatId,
                            `📊 СТАТУС ИЗМЕНЕН!\n\n` +
                            `🎯 Мероприятие: ${slot.event_name}\n` +
                            `📊 Новый статус: ${newStatus === 'active' ? 'Активен 🟢' : 'Неактивен 🔴'}\n\n` +
                            '✅ Операция завершена!', adminKeyboard).catch(console.error);

                        delete global.adminStates[telegramId];
                    });
                    break;
                default:
                    bot.sendMessage(chatId, '❌ Неверный номер! Выбери от 1 до 6.').catch(console.error);
            }
            return;
        }

        // Обработка ввода нового значения
        if (state.step === 'edit_value') {
            const slot = state.selectedSlot;
            const field = state.editField;
            let newValue = text;
            let isValid = true;

            // Валидация
            if (field === 'date' && !/^\d{2}\.\d{2}\.\d{4}$/.test(newValue)) {
                bot.sendMessage(chatId, '❌ Неверный формат даты! Используй ДД.ММ.ГГГГ').catch(console.error);
                return;
            }
            if (field === 'time' && !/^\d{2}:\d{2}$/.test(newValue)) {
                bot.sendMessage(chatId, '❌ Неверный формат времени! Используй ЧЧ:ММ').catch(console.error);
                return;
            }
            if ((field === 'max_participants' || field === 'points_reward') && (isNaN(parseInt(newValue)) || parseInt(newValue) < 1)) {
                bot.sendMessage(chatId, '❌ Число должно быть больше 0!').catch(console.error);
                return;
            }

            if (field === 'max_participants' || field === 'points_reward') {
                newValue = parseInt(newValue);
            }

            // Обновляем в базе данных
            db.run(`UPDATE event_slots SET ${field} = ? WHERE id = ?`, [newValue, slot.id], () => {
                const fieldNames = {
                    'date': 'Дата',
                    'time': 'Время',
                    'location': 'Место',
                    'max_participants': 'Количество участников',
                    'points_reward': 'Награда'
                };

                bot.sendMessage(chatId,
                    `✅ ИЗМЕНЕНО!\n\n` +
                    `🎯 Мероприятие: ${slot.event_name}\n` +
                    `📝 ${fieldNames[field]}: ${newValue}\n\n` +
                    '✅ Операция завершена!', adminKeyboard).catch(console.error);

                delete global.adminStates[telegramId];
            });
            return;
        }
        
        switch (state.step) {
            case 'category':
            if (['🏃‍♂️ Зарядка', '🎰 Покер', '🎉 Корпоратив', '📚 Тренинги'].includes(text)) {
                state.eventData.category = text.substring(text.indexOf(' ') + 1).trim();
                state.eventData.name = text.replace(/[\w\s]+\s/, '').trim();
                    state.step = 'custom_name';
                    
                    bot.sendMessage(chatId, 
                        `✅ Выбрана категория: ${text}\n\n` +
                        '📝 Шаг 2: Напиши НАЗВАНИЕ мероприятия\n' +
                        `💡 Например: "Утренняя зарядка с тренером"\n\n` +
                        '✏️ Или просто напиши "далее" чтобы использовать стандартное название').catch(console.error);
                }
                break;
                
            case 'custom_name':
                if (text.toLowerCase() !== 'далее') {
                    state.eventData.name = text;
                }
                state.step = 'date';
                
                bot.sendMessage(chatId, 
                    `✅ Название: ${state.eventData.name}\n\n` +
                    '📅 Шаг 3: Укажи ДАТУ мероприятия\n\n' +
                    '📝 Формат: ДД.ММ.ГГГГ\n' +
                    '💡 Например: 25.12.2024').catch(console.error);
                break;
                
            case 'date':
                if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
                    state.eventData.date = text;
                    state.step = 'time';
                    
                    bot.sendMessage(chatId, 
                        `✅ Дата: ${text}\n\n` +
                        '⏰ Шаг 4: Укажи ВРЕМЯ начала\n\n' +
                        '📝 Формат: ЧЧ:ММ\n' +
                        '💡 Например: 09:30 или 18:00').catch(console.error);
                } else {
                    bot.sendMessage(chatId, 
                        '❌ Неверный формат даты!\n' +
                        '📝 Используй: ДД.ММ.ГГГГ\n' +
                        '💡 Например: 25.12.2024').catch(console.error);
                }
                break;
                
            case 'time':
                if (/^\d{2}:\d{2}$/.test(text)) {
                    state.eventData.time = text;
                    state.step = 'location';
                    
                    bot.sendMessage(chatId, 
                        `✅ Время: ${text}\n\n` +
                        '📍 Шаг 5: Укажи МЕСТО проведения\n\n' +
                        '💡 Например: "Конференц-зал 1", "Офис, 2 этаж"').catch(console.error);
                } else {
                    bot.sendMessage(chatId, 
                        '❌ Неверный формат времени!\n' +
                        '📝 Используй: ЧЧ:ММ\n' +
                        '💡 Например: 09:30 или 18:00').catch(console.error);
                }
                break;
                
            case 'location':
                state.eventData.location = text;
                state.step = 'participants';
                
                bot.sendMessage(chatId, 
                    `✅ Место: ${text}\n\n` +
                    '👥 Шаг 6: Максимальное количество участников\n\n' +
                    '🔢 Напиши число от 1 до 100\n' +
                    '💡 Например: 10').catch(console.error);
                break;
                
            case 'participants':
                const maxParticipants = parseInt(text);
                if (isNaN(maxParticipants) || maxParticipants < 1 || maxParticipants > 100) {
                    bot.sendMessage(chatId, 
                        '❌ Неверное количество!\n' +
                        '🔢 Введи число от 1 до 100').catch(console.error);
                    return;
                }
                
                state.eventData.maxParticipants = maxParticipants;
                state.step = 'reward';
                
                bot.sendMessage(chatId, 
                    `✅ Участников: ${maxParticipants}\n\n` +
                    '🏆 Шаг 7: Награда в П-коинах\n\n' +
                    '💰 Напиши количество коинов за участие\n' +
                    '💡 Например: 5, 10, 15').catch(console.error);
                break;
                
            case 'reward':
                const reward = parseInt(text);
                if (isNaN(reward) || reward < 0 || reward > 100) {
                    bot.sendMessage(chatId, 
                        '❌ Неверная награда!\n' +
                        '💰 Введи число от 0 до 100').catch(console.error);
                    return;
                }
                
                state.eventData.reward = reward;
                createEventSlot(chatId, telegramId, state.eventData);
                break;
        }
    } catch (error) {
        console.error('❌ Handle admin event creation error:', error);
    }
}

function createEventSlot(chatId, telegramId, eventData) {
    try {
        db.run(`INSERT INTO event_slots 
                (event_name, category, date, time, location, max_participants, points_reward, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
               [eventData.name, eventData.category, eventData.date, eventData.time, 
                eventData.location, eventData.maxParticipants, eventData.reward], function() { // Use function() to get 'this'
            
            const newSlotId = this.lastID;
            delete global.adminStates[telegramId];
            
            bot.sendMessage(chatId, 
                '🎉 МЕРОПРИЯТИЕ СОЗДАНО! ✅\n\n' +
                `🎯 Название: ${eventData.name}\n` +
                `📅 Дата: ${eventData.date}\n` +
                `⏰ Время: ${eventData.time}\n` +
                `📍 Место: ${eventData.location}\n` +
                `👥 Участников: ${eventData.maxParticipants}\n` +
                `💰 Награда: ${eventData.reward} П-коинов\n\n` +
                '🚀 Начинаю рассылку уведомлений пользователям...', adminKeyboard).catch(console.error);

            // Broadcast the new event to all users
            broadcastNewEvent(newSlotId, eventData);
        });
    } catch (error) {
        console.error('❌ Create event slot error:', error);
    }
}

function broadcastNewEvent(slotId, eventData) {
    try {
        db.all("SELECT telegram_id FROM users WHERE is_registered = 1", (err, users) => {
            if (err || !users) {
                console.error('Could not fetch users for event broadcast:', err);
                return;
            }

            const dayOfWeek = getDayOfWeek(eventData.date);
            const dateWithDay = dayOfWeek ? `${eventData.date} (${dayOfWeek})` : eventData.date;

            const message = `📢 Новое мероприятие!\n\n` +
                            `🎯 **${eventData.name}**\n\n` +
                            `🗓️ ${dateWithDay} в ${eventData.time}\n\n` +
                            `Хочешь поучаствовать?`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '✅ Записаться', callback_data: `signup_event_${slotId}` }
                ]]
            };

            users.forEach(user => {
                bot.sendMessage(user.telegram_id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                }).catch(err => {
                    console.error(`Failed to send event notification to ${user.telegram_id}:`, err.message);
                });
            });

            console.log(`Broadcasted new event #${slotId} to ${users.length} users.`);
        });
    } catch (error) {
        console.error('❌ Broadcast new event error:', error);
    }
}

function showAllEventSlotsAdmin(chatId, telegramId) {
    console.log(`[DEBUG ADMIN VIEW] showAllEventSlotsAdmin called for chatId ${chatId}, user ${telegramId}`);
    db.all("SELECT * FROM event_slots ORDER BY date, time", (err, slots) => {
        console.log(`[DEBUG ADMIN VIEW] DB query completed, slots count: ${slots ? slots.length : 0}, error: ${err ? 'Yes' : 'No'}`);
        if (err) {
            console.error('❌ Show all event slots admin DB error:', err);
            bot.sendMessage(chatId, '❌ Ошибка загрузки мероприятий!').catch((sendErr) => console.error('Send error:', sendErr));
            return;
        }
        if (!slots || slots.length === 0) {
            console.log(`[DEBUG ADMIN VIEW] No slots, sending empty message`);
            bot.sendMessage(chatId,
                '📅 ВСЕ МЕРОПРИЯТИЯ 🗓️\n\n' +
                '📋 Мероприятий пока нет!\n\n' +
                '🎯 Создай первое мероприятие через\n' +
                '"🗓️ Создать мероприятие"', adminKeyboard).catch((sendErr) => console.error('Send empty message error:', sendErr));
            return;
        }

        let slotsText = '📅 ВСЕ МЕРОПРИЯТИЯ 🗓️\n\n';

        slots.forEach((slot, index) => {
            const status = slot.status === 'active' ? '🟢' : '🔴';
            slotsText += `${index + 1}. ${status} ${slot.event_name}\n`;
            slotsText += `   📅 ${slot.date} в ${slot.time}\n`;
            slotsText += `   📍 ${slot.location}\n`;
            slotsText += `   👥 ${slot.current_participants}/${slot.max_participants}\n`;
            slotsText += `   💰 ${slot.points_reward} коинов\n`;
            slotsText += `   🆔 ID: ${slot.id}\n\n`;
        });

        slotsText += '✏️ Для редактирования используй "Редактировать слот"\n';
        slotsText += '🗑️ Для удаления используй "Удалить слот"';

        console.log(`[DEBUG ADMIN VIEW] Sending message with ${slots.length} slots`);
        bot.sendMessage(chatId, slotsText, adminKeyboard).catch((sendErr) => {
            console.error('❌ Admin view send error:', sendErr);
            bot.sendMessage(chatId, '❌ Ошибка отправки расписания!').catch(console.error);
        });
        console.log(`[DEBUG ADMIN VIEW] Message sent successfully`);
    });
}

function startSlotEdit(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            global.adminStates[telegramId] = {
                step: 'select_slot_edit',
                eventData: {}
            };

            db.all("SELECT * FROM event_slots ORDER BY date, time", (err, slots) => {
                if (!slots || slots.length === 0) {
                    bot.sendMessage(chatId, '📋 Нет мероприятий для редактирования!').catch(console.error);
                    return;
                }

                let slotsText = '✏️ РЕДАКТИРОВАТЬ МЕРОПРИЯТИЕ\n\n';
                slotsText += 'Выбери мероприятие для редактирования:\n\n';

                slots.forEach((slot, index) => {
                    const status = slot.status === 'active' ? '🟢' : '🔴';
                    slotsText += `${slot.id}. ${status} ${slot.event_name}\n`;
                    slotsText += `   📅 ${slot.date} в ${slot.time}\n\n`;
                });

                slotsText += '🔢 Напиши ID мероприятия:';

                global.adminStates[telegramId].slots = slots;
                bot.sendMessage(chatId, slotsText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Start slot edit error:', error);
    }
}

function startSlotDelete(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            global.adminStates[telegramId] = {
                step: 'select_slot_delete',
                eventData: {}
            };

            db.all("SELECT * FROM event_slots ORDER BY date, time", (err, slots) => {
                if (!slots || slots.length === 0) {
                    bot.sendMessage(chatId, '📋 Нет мероприятий для удаления!').catch(console.error);
                    return;
                }

                let slotsText = '🗑️ УДАЛИТЬ МЕРОПРИЯТИЕ\n\n';
                slotsText += '⚠️ ВНИМАНИЕ: Это действие нельзя отменить!\n\n';
                slotsText += 'Выбери мероприятие для удаления:\n\n';

                slots.forEach((slot, index) => {
                    const status = slot.status === 'active' ? '🟢' : '🔴';
                    slotsText += `${slot.id}. ${status} ${slot.event_name}\n`;
                    slotsText += `   📅 ${slot.date} в ${slot.time}\n`;
                    slotsText += `   👥 ${slot.current_participants} участников\n\n`;
                });

                slotsText += '🔢 Напиши ID мероприятия для удаления:';

                global.adminStates[telegramId].slots = slots;
                bot.sendMessage(chatId, slotsText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Start slot delete error:', error);
    }
}

// ========== ФУНКЦИИ РАССЫЛОК ==========

function startBroadcast(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            bot.sendMessage(chatId,
                '📢 СОЗДАТЬ РАССЫЛКУ 📨\n\n' +
                '👥 Выбери категорию получателей:\n\n' +
                '• Всем пользователям - все зарегистрированные\n' +
                '• Только старичкам - опытные сотрудники\n' +
                '• Только стажерам - новички в команде\n' +
                '• Выборочно - выбрать конкретных людей\n\n' +
                '👇 Выбери категорию:', broadcastKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Start broadcast error:', error);
    }
}

function setBroadcastTarget(chatId, telegramId, target) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            global.userScreenshots[telegramId] = {
                type: 'broadcast',
                target: target,
                step: 'message'
            };

            let targetText = '';
            switch (target) {
                case 'all':
                    targetText = '👥 Всем пользователям';
                    break;
                case 'seniors':
                    targetText = '🧓 Только старичкам';
                    break;
                case 'interns':
                    targetText = '👶 Только стажерам';
                    break;
                case 'selective':
                    targetText = '📊 Выборочно';
                    break;
            }

            if (target === 'selective') {
                // Показываем список пользователей для выбора
                db.all("SELECT username, full_name, telegram_id, role FROM users WHERE is_registered = 1 ORDER BY full_name", (err, users) => {
                    if (!users || users.length === 0) {
                        bot.sendMessage(chatId, '👻 Нет пользователей!').catch(console.error);
                        return;
                    }

                    let usersList = '📊 ВЫБОРОЧНАЯ РАССЫЛКА\n\n';
                    usersList += 'Выбери получателей (через запятую):\n\n';

                    users.forEach((user, index) => {
                        const name = user.full_name || user.username || 'Неизвестный';
                        const role = user.role === 'стажер' ? '👶' : '🧓';
                        usersList += `${index + 1}. ${role} ${name}\n`;
                    });

                    usersList += '\n💡 Например: 1,3,5 или напиши "всем"';

                    global.userScreenshots[telegramId].users = users;
                    global.userScreenshots[telegramId].step = 'select_users';
                    bot.sendMessage(chatId, usersList).catch(console.error);
                });
            } else {
                bot.sendMessage(chatId,
                    `📢 РАССЫЛКА: ${targetText}\n\n` +
                    '📝 Напиши текст сообщения для рассылки:\n\n' +
                    '💡 Можешь использовать эмодзи и форматирование\n' +
                    '⚠️ Сообщение будет отправлено ВСЕМ выбранным пользователям!').catch(console.error);
            }
        });
    } catch (error) {
        console.error('❌ Set broadcast target error:', error);
    }
}

function handleBroadcastMessage(chatId, telegramId, text) {
    try {
        const broadcastData = global.userScreenshots[telegramId];

        if (broadcastData.step === 'select_users') {
            let selectedUsers = [];

            if (text.toLowerCase() === 'всем') {
                selectedUsers = broadcastData.users;
            } else {
                const indices = text.split(',').map(n => parseInt(n.trim()) - 1);
                selectedUsers = indices.filter(i => i >= 0 && i < broadcastData.users.length)
                                      .map(i => broadcastData.users[i]);
            }

            if (selectedUsers.length === 0) {
                bot.sendMessage(chatId, '❌ Неверный выбор пользователей! Попробуй еще раз.').catch(console.error);
                return;
            }

            broadcastData.selectedUsers = selectedUsers;
            broadcastData.step = 'message';

            bot.sendMessage(chatId,
                `📊 ВЫБРАНО ПОЛУЧАТЕЛЕЙ: ${selectedUsers.length}\n\n` +
                selectedUsers.map(u => `• ${u.full_name || u.username}`).join('\n') + '\n\n' +
                '📝 Напиши текст сообщения для рассылки:').catch(console.error);

        } else if (broadcastData.step === 'message') {
            broadcastData.message = text;
            broadcastData.media = []; // Initialize media array
            broadcastData.step = 'media';

            bot.sendMessage(chatId,
                `📝 Текст сообщения сохранен!\n\n` +
                `💬 "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"\n\n` +
                '📸 Теперь отправь фото (одно или несколько) для рассылки.\n' +
                '⚡ Или напиши "готово" чтобы отправить только текст.\n' +
                '💡 Фото будут отправлены как медиа-группа с текстом как подписью к первому фото.').catch(console.error);

        } else if (broadcastData.step === 'media') {
            if (text.toLowerCase() === 'готово' || text === '/done') {
                console.log(`[BROADCAST LOG] Admin ${telegramId} finished media input. Media count: ${broadcastData.media.length}, sending broadcast.`);
                sendBroadcast(chatId, telegramId, broadcastData, broadcastData.message);
            } else {
                bot.sendMessage(chatId, '📸 Ожидаю фото или "готово" для завершения.').catch(console.error);
            }
        }
    } catch (error) {
        console.error('❌ Handle broadcast message error:', error);
    }
}

function sendBroadcast(chatId, telegramId, broadcastData, message) {
    try {
        let query = '';
        let params = [];

        if (broadcastData.target === 'selective') {
            const userIds = broadcastData.selectedUsers.map(u => u.telegram_id);
            query = `SELECT telegram_id, full_name, username FROM users WHERE telegram_id IN (${userIds.map(() => '?').join(',')}) AND is_registered = 1`;
            params = userIds;
        } else {
            switch (broadcastData.target) {
                case 'all':
                    query = 'SELECT telegram_id, full_name, username FROM users WHERE is_registered = 1';
                    break;
                case 'seniors':
                    query = "SELECT telegram_id, full_name, username FROM users WHERE role = 'старичок' AND is_registered = 1";
                    break;
                case 'interns':
                    query = "SELECT telegram_id, full_name, username FROM users WHERE role = 'стажер' AND is_registered = 1";
                    break;
            }
        }

        db.all(query, params, (err, users) => {
            if (!users || users.length === 0) {
                bot.sendMessage(chatId, '👻 Нет получателей для рассылки!').catch(console.error);
                return;
            }

            const media = broadcastData.media || [];
            console.log(`[BROADCAST LOG] Starting broadcast to ${users.length} users. Media count: ${media.length}, text: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);

            let successCount = 0;
            let errorCount = 0;

            users.forEach(user => {
                if (media.length > 0) {
                    // Prepare media group
                    const mediaGroup = media.map((item, index) => ({
                        type: 'photo',
                        media: item.media,
                        caption: index === 0 ? `📢 СООБЩЕНИЕ ОТ АДМИНИСТРАЦИИ\n\n${message}` : undefined
                    }));

                    bot.sendMediaGroup(user.telegram_id, mediaGroup)
                        .then(() => {
                            successCount++;
                            console.log(`[BROADCAST LOG] Media group sent successfully to ${user.telegram_id}`);
                        })
                        .catch((err) => {
                            errorCount++;
                            console.error(`[BROADCAST LOG] Failed to send media group to ${user.telegram_id}:`, err);
                        });
                } else {
                    // Send text only
                    const broadcastMessage = `📢 СООБЩЕНИЕ ОТ АДМИНИСТРАЦИИ\n\n${message}`;
                    bot.sendMessage(user.telegram_id, broadcastMessage)
                        .then(() => {
                            successCount++;
                            console.log(`[BROADCAST LOG] Text message sent successfully to ${user.telegram_id}`);
                        })
                        .catch((err) => {
                            errorCount++;
                            console.error(`[BROADCAST LOG] Failed to send text to ${user.telegram_id}:`, err);
                        });
                }
            });

            // Отчет админу
            setTimeout(() => {
                const mediaInfo = media.length > 0 ? ` + ${media.length} фото` : '';
                bot.sendMessage(chatId,
                    `📢 РАССЫЛКА ЗАВЕРШЕНА! ✅\n\n` +
                    `👥 Всего получателей: ${users.length}\n` +
                    `✅ Доставлено: ${successCount}\n` +
                    `❌ Ошибок: ${errorCount}\n\n` +
                    `📝 Текст: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"${mediaInfo}\n\n` +
                    '🎯 Рассылка выполнена успешно!', adminKeyboard).catch(console.error);

                delete global.userScreenshots[telegramId];
                console.log(`[BROADCAST LOG] Broadcast completed. Success: ${successCount}, Errors: ${errorCount}`);
            }, 3000); // Slightly longer delay for media sends
        });
    } catch (error) {
        console.error('❌ Send broadcast error:', error);
    }
}

function backToAdminMenu(chatId, telegramId) {
    try {
        // Очищаем состояния
        delete global.adminStates[telegramId];
        delete global.userScreenshots[telegramId];

        bot.sendMessage(chatId,
            '🔙 ВОЗВРАТ В АДМИНКУ 👨‍💼\n\n' +
            '🎯 Выбери действие:', adminKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Back to admin menu error:', error);
    }
}

function showTestSubmissions(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }
            
            db.all("SELECT * FROM test_submissions WHERE status = 'pending' ORDER BY submitted_date DESC", 
                   (err, submissions) => {
                
                if (!submissions || submissions.length === 0) {
                    bot.sendMessage(chatId, 
                        '📋 ЗАЯВКИ НА ПРОВЕРКУ 📝\n\n' +
                        '✅ Все заявки обработаны!\n\n' +
                        '🎉 Отличная работа, админ!').catch(console.error);
                    return;
                }
                
                submissions.forEach(submission => {
                    bot.sendPhoto(chatId, submission.photo_file_id, {
                        caption: `📋 ЗАЯВКА #${submission.id}\n\n` +
                                `👤 Пользователь: @${submission.username}\n` +
                                `📚 Тест: ${submission.test_name}\n` +
                                `🎯 Заявленные баллы: ${submission.points_claimed}\n` +
                                `📅 Дата: ${new Date(submission.submitted_date).toLocaleString('ru-RU')}\n\n` +
                                '🤔 Твое решение?',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '✅ Одобрить', callback_data: `approve_${submission.id}` },
                                { text: '❌ Отклонить', callback_data: `reject_${submission.id}` }
                            ]]
                        }
                    }).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Show test submissions error:', error);
    }
}

function showUsersList(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }
            
            db.all("SELECT * FROM users WHERE is_registered = 1 ORDER BY registration_date DESC", 
                   (err, users) => {
                
                if (!users || users.length === 0) {
                    bot.sendMessage(chatId, '👥 Пользователей пока нет!').catch(console.error);
                    return;
                }
                
                let usersText = '👥 СПИСОК ПОЛЬЗОВАТЕЛЕЙ 📋\n\n';
                
                users.forEach((user, index) => {
                    const roleEmoji = user.role === 'стажер' ? '👶' : '🧓';
                    usersText += `${index + 1}. ${roleEmoji} ${getUserDisplayName(user)}\n`;
                    usersText += `   💰 ${user.p_coins} П-коинов\n`;
                    usersText += `   📅 ${new Date(user.registration_date).toLocaleDateString('ru-RU')}\n\n`;
                });
                
                bot.sendMessage(chatId, usersText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show users list error:', error);
    }
}

function showBugReports(chatId, telegramId) {
    db.all(`SELECT br.*, u.username, u.full_name, u.role, u.position, u.position_level, u.registration_date, u.graduated_at
            FROM bug_reports br
            JOIN users u ON br.user_id = u.id 
            ORDER BY br.submitted_date DESC`, (err, reports) => {
        
        if (err || !reports || reports.length === 0) {
            bot.sendMessage(chatId, '🐞 Отчетов о багах пока нет.');
            return;
        }

        bot.sendMessage(chatId, '🐞 Отчеты о багах:');

        reports.forEach(report => {
            const userName = getUserDisplayName(report);
            let reportText = `**Отчет #${report.id}** от ${userName}\n\n` +
                             `**Описание:** ${report.description}\n` +
                             `**Статус:** ${report.status}`;

            let keyboard = {};
            if (report.status === 'pending') {
                keyboard = {
                    inline_keyboard: [[
                        { text: '✅ Одобрить', callback_data: `approve_bug_${report.id}` },
                        { text: '❌ Отклонить', callback_data: `reject_bug_${report.id}` }
                    ]]
                };
            }

            if (report.media_type === 'photo') {
                bot.sendPhoto(chatId, report.media_file_id, { caption: reportText, parse_mode: 'Markdown', reply_markup: keyboard });
            } else if (report.media_type === 'video') {
                bot.sendVideo(chatId, report.media_file_id, { caption: reportText, parse_mode: 'Markdown', reply_markup: keyboard });
            } else {
                bot.sendMessage(chatId, reportText, { parse_mode: 'Markdown', reply_markup: keyboard });
            }
        });
    });
}

function showAdminStats(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            // Собираем общую статистику
            db.all(`
                SELECT
                    (SELECT COUNT(*) FROM users WHERE is_registered = 1) as total_users,
                    (SELECT COUNT(*) FROM users WHERE role = 'стажер' AND is_registered = 1) as interns,
                    (SELECT COUNT(*) FROM users WHERE role = 'старичок' AND is_registered = 1) as seniors,
                    (SELECT SUM(p_coins) FROM users WHERE is_registered = 1) as total_coins,
                    (SELECT COUNT(*) FROM event_slots) as total_events,
                    (SELECT COUNT(*) FROM event_slots WHERE status = 'active') as active_events,
                    (SELECT COUNT(*) FROM event_bookings) as total_bookings,
                    (SELECT COUNT(*) FROM battles) as total_battles,
                    (SELECT COUNT(*) FROM gifts) as total_gifts,
                    (SELECT SUM(amount) FROM gifts) as total_gifted,
                    (SELECT COUNT(*) FROM tasks) as total_tasks,
                    (SELECT COUNT(*) FROM tasks WHERE status = 'completed') as completed_tasks,
                    (SELECT COUNT(*) FROM test_submissions WHERE status = 'pending') as pending_tests
            `, (err, stats) => {
                if (err) {
                    console.error('Stats error:', err);
                    return;
                }

                const statsText =
                    '📊 АДМИНСКАЯ СТАТИСТИКА 🎯\n\n' +
                    '👥 ПОЛЬЗОВАТЕЛИ:\n' +
                    `   Всего: ${stats[0].total_users}\n` +
                    `   Стажеры: ${stats[0].interns}\n` +
                    `   Старички: ${stats[0].seniors}\n\n` +
                    '💰 ЭКОНОМИКА:\n' +
                    `   Всего П-коинов: ${stats[0].total_coins}\n` +
                    `   Подарков: ${stats[0].total_gifts}\n` +
                    `   Подарено коинов: ${stats[0].total_gifted}\n\n` +
                    '🎯 МЕРОПРИЯТИЯ:\n' +
                    `   Всего слотов: ${stats[0].total_events}\n` +
                    `   Активных: ${stats[0].active_events}\n` +
                    `   Записей: ${stats[0].total_bookings}\n\n` +
                    '⚔️ АКТИВНОСТЬ:\n' +
                    `   PVP битв: ${stats[0].total_battles}\n` +
                    `   Задач создано: ${stats[0].total_tasks}\n` +
                    `   Задач выполнено: ${stats[0].completed_tasks}\n\n` +
                    '📋 ЗАЯВКИ:\n' +
                    `   На проверке: ${stats[0].pending_tests} тестов\n\n` +
                    '📈 Общая активность отличная!';

                bot.sendMessage(chatId, statsText, adminKeyboard).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show admin stats error:', error);
    }
}

// ========== CALLBACK ОБРАБОТЧИКИ ==========

bot.on('callback_query', (callbackQuery) => {
    try {
        const data = callbackQuery.data;
        const chatId = callbackQuery.message.chat.id;
        const messageId = callbackQuery.message.message_id;
        const telegramId = callbackQuery.from.id;
        const username = callbackQuery.from.username || 'user';

        // DUPLICATE PREVENTION: Check if this action was recently processed
        const actionKey = `${telegramId}_${data}`;
        const now = Date.now();
        if (global.lastActionTimes && global.lastActionTimes[actionKey] && (now - global.lastActionTimes[actionKey] < 1000)) {
            console.log(`[DUPLICATE PREVENTION] Ignoring duplicate callback action: ${actionKey} (${now - global.lastActionTimes[actionKey]}ms ago)`);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
            return;
        }
        
        // Initialize global action tracking if not exists
        if (!global.lastActionTimes) {
            global.lastActionTimes = {};
        }
        global.lastActionTimes[actionKey] = now;

        // [CALLBACK LOG] Логирование inline кнопок
        const currentTime = new Date().toLocaleString('ru-RU');
        db.get("SELECT full_name, role FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            const userInfo = user ? `${user.full_name} (${user.role})` : `@${username}`;
            console.log(`\n🖱️ [${currentTime}] CALLBACK ACTION:`);
            console.log(`👤 User: ${userInfo} (ID: ${telegramId})`);
            console.log(`🔘 Button: "${data}"`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        });
        
        if (data === 'confirm_invoice') {
            console.log(`[INVOICE DEBUG] Confirm invoice callback for user ${telegramId}, state: ${JSON.stringify(global.userScreenshots[telegramId])}`);
            const state = global.userScreenshots[telegramId];
            if (!state || state.type !== 'invoice_creation' || state.step !== 'preview') {
                bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Сессия истекла! Начните заново.'});
                return;
            }
            const data = state.data;
            db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                if (err || !user) {
                    bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка!'});
                    return;
                }
                // Get next invoice_number
                db.get("SELECT COALESCE(MAX(invoice_number), 0) + 1 AS next FROM invoices", (err, row) => {
                    if (err) {
                        bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка БД!'});
                        return;
                    }
                    const invoice_number = row.next;
                    const invoice_date = new Date().toLocaleDateString('ru-RU');
                    const fileName = `INV-${invoice_number}_${new Date().toISOString().split('T')[0]}.pdf`;
                    const invoicesDir = path.join(__dirname, 'invoices');
                    const filePath = path.join(invoicesDir, fileName);
                    data.creator_id = user.id;
                    data.invoice_number = invoice_number;
                    data.invoice_date = invoice_date;
                    data.file_path = filePath;
                    
                    // Ensure invoices directory exists
                    try {
                        if (!fs.existsSync(invoicesDir)) {
                            fs.mkdirSync(invoicesDir, { recursive: true });
                            console.log(`Created invoices directory: ${invoicesDir}`);
                        }
                    } catch (dirError) {
                        console.error('Error creating invoices directory:', dirError);
                        bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка создания директории для инвойсов!'});
                        return;
                    }
                    
                    // Generate PDF with error handling
                    try {
                        generateInvoicePDF(data, filePath);
                    } catch (pdfError) {
                        console.error('Error generating PDF:', pdfError);
                        bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка генерации PDF инвойса!'});
                        return;
                    }
                    // Insert to DB
                    db.run(`INSERT INTO invoices (creator_id, company_name, org_address, work_type, start_date, end_date, quantity, amount, description, file_path, invoice_number, invoice_date)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [data.creator_id, data.org_name, data.org_address, data.work_type, data.start_date, data.end_date, data.quantity, data.amount, data.description, data.file_path, data.invoice_number, data.invoice_date], (err) => {
                        if (err) {
                            bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка сохранения!'});
                            return;
                        }
                        // Send document using a readable stream for better compatibility
                        const documentStream = fs.createReadStream(filePath);
                        bot.sendDocument(chatId, documentStream, {caption: "✅ Инвойс создан и отправлен! Сохранен в БД."})
                            .catch((sendError) => {
                                console.error('Error sending document to Telegram:', sendError);
                                bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Ошибка отправки инвойса в Telegram!'});
                                return;
                            });
                        bot.answerCallbackQuery(callbackQuery.id, {text: '✅ Инвойс создан!'});
                        delete global.userScreenshots[telegramId];
                        // Delete preview message
                        bot.deleteMessage(chatId, messageId).catch(console.error);
                    });
                });
            });
        } else if (data === 'cancel_invoice') {
            if (global.userScreenshots[telegramId] && global.userScreenshots[telegramId].type === 'invoice_creation') {
                delete global.userScreenshots[telegramId];
                bot.answerCallbackQuery(callbackQuery.id, {text: '❌ Отменено.'});
                bot.editMessageText("❌ Создание инвойса отменено. Возврат в меню.", {chat_id: chatId, message_id: messageId}).catch(console.error);
                backToMainMenu(chatId, telegramId);
            }
        } else if (data.startsWith('approve_') && !data.startsWith('approve_bug_')) {
            const submissionId = data.split('_')[1];
            approveSubmission(chatId, messageId, telegramId, submissionId, callbackQuery.id);
        } else if (data.startsWith('reject_') && !data.startsWith('reject_bug_')) {
            const submissionId = data.split('_')[1];
            rejectSubmission(chatId, messageId, telegramId, submissionId, callbackQuery.id);
        } else if (data.startsWith('vac_approve_')) {
            const requestId = data.split('_')[2];
            approveVacationRequest(chatId, telegramId, parseInt(requestId));
            bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Заявка одобрена!' }).catch(console.error);
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(console.error);
        } else if (data.startsWith('vac_reject_')) {
            const requestId = data.split('_')[2];
            const reason = 'Отклонено администратором';
            rejectVacationRequest(chatId, telegramId, parseInt(requestId), reason);
            bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Заявка отклонена!' }).catch(console.error);
            bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(console.error);
        } else if (data.startsWith('signup_event_')) {
            const slotId = data.split('_')[2];
            db.get("SELECT * FROM event_slots WHERE id = ?", [slotId], (err, slot) => {
                if (err || !slot) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Мероприятие больше не доступно!', show_alert: true });
                    return;
                }
                // The existing bookEventSlot function handles all logic and messaging
                bookEventSlot(chatId, telegramId, slot);
                bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Вы записаны!' });
            });
        } else if (data.startsWith('start_task_')) {
            const taskId = data.split('_')[2];

            db.get("SELECT * FROM tasks WHERE id = ? AND assignee_id = (SELECT id FROM users WHERE telegram_id = ?)", [taskId, telegramId], (err, task) => {
                if (err || !task) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Задача не найдена или уже не доступна.', show_alert: true });
                    return;
                }

                if (task.status !== 'pending') {
                    bot.answerCallbackQuery(callbackQuery.id, { text: `⚠️ Задача уже в статусе: ${task.status}`, show_alert: true });
                    return;
                }

                db.run("UPDATE tasks SET status = 'in_progress', started_at = CURRENT_TIMESTAMP WHERE id = ?", [taskId], function(err) {
                    if (err) {
                        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Ошибка обновления задачи.', show_alert: true });
                        return;
                    }

                    bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Задача начата!' });

                    const newText = `🎯 **Задача в работе!**\n\n` +
                                    `**Название:** ${task.title}\n` +
                                    `**Описание:** ${task.description || 'Без описания'}`;
                    
                    const newKeyboard = {
                        inline_keyboard: [[
                            { text: '❌ Отменить выполнение', callback_data: `cancel_execution_task_${taskId}` }
                        ]]
                    };

                    bot.editMessageText(newText, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: newKeyboard // Add the new keyboard
                    });

                    // Notify creator
                    if (task.creator_id) {
                        db.get("SELECT telegram_id FROM users WHERE id = ?", [task.creator_id], (err, creator) => {
                            if (creator && creator.telegram_id !== telegramId) {
                                db.get("SELECT full_name FROM users WHERE telegram_id = ?", [telegramId], (err, assignee) => {
                                    const assigneeName = assignee ? assignee.full_name : 'Исполнитель';
                                    bot.sendMessage(creator.telegram_id, `▶️ **${assigneeName}** начал(а) выполнение задачи:\n*${task.title}*`, { parse_mode: 'Markdown' });
                                });
                            }
                        });
                    }
                });
            });
        } else if (data.startsWith('cancel_execution_task_')) {
            const taskId = data.split('_')[3]; // e.g., cancel_execution_task_123

            db.get("SELECT * FROM tasks WHERE id = ? AND assignee_id = (SELECT id FROM users WHERE telegram_id = ?)", [taskId, telegramId], (err, task) => {
                if (err || !task) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Задача не найдена или у вас нет прав.', show_alert: true });
                    return;
                }

                global.userScreenshots[telegramId] = {
                    type: 'task_cancel',
                    step: 'enter_reason',
                    taskId: taskId // Store taskId for the next step
                };

                bot.answerCallbackQuery(callbackQuery.id, { text: 'Отмена задачи...' });
                bot.editMessageText(`❌ Вы отменяете задачу: **${task.title}**.\n\nПожалуйста, укажите причину отмены:`, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [] } // Remove the button
                });
            });
        } else if (data === 'confirm_template_task_final') {
            const state = global.userScreenshots[telegramId];
            if (!state || state.type !== 'task_from_template' || state.step !== 'confirm_task') {
                bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Сессия истекла!' });
                return;
            }

            const task = state.taskData;
            db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                if(err || !user) {
                    bot.sendMessage(chatId, '❌ Ошибка пользователя!').catch(console.error);
                    return;
                }
                task.creator_id = user.id;
                
                let dueDate = null;
                if (task.due_date) {
                    const parts = task.due_date.split(' ');
                    const dateParts = parts[0].split('.');
                    if (dateParts.length === 3) {
                        dueDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
                        if (parts.length > 1) {
                            dueDate += ` ${parts[1]}`;
                        }
                    }
                }

                db.run(`INSERT INTO tasks (creator_id, assignee_id, title, description, priority, due_date, started_at)
                        VALUES (?, ?, ?, ?, ?, ?, NULL)`,
                       [task.creator_id, task.assignee_id, task.title, task.description, 'high', dueDate], function() {
                    
                    const newTaskId = this.lastID;

                    bot.sendMessage(chatId, '✅ Задача создана и отправлена исполнителю!', mainMenuKeyboard);
                    
                    db.get("SELECT telegram_id FROM users WHERE id = ?", [task.assignee_id], (err, assignee) => {
                        if (assignee) {
                            // Send media if it exists first
                            if (task.media_type === 'photo') {
                                bot.sendPhoto(assignee.telegram_id, task.media, { caption: task.description });
                            } else if (task.media_type === 'video') {
                                bot.sendVideo(assignee.telegram_id, task.media, { caption: task.description });
                            }

                            const priorityText = '🔴 Высокий'; // Template tasks are always high priority
                            const dueDateText = dueDate ? new Date(dueDate).toLocaleString('ru-RU') : 'Без срока';

                            const message = `🎯 **Новая задача!**\n\n` +
                                            `**Название:** ${task.title}\n` +
                                            `**Описание:** ${task.description || 'Без описания'}\n\n` +
                                            `**Приоритет:** ${priorityText}\n` +
                                            `**Срок выполнения:** ${dueDateText}\n\n` +
                                            `Нажмите, чтобы начать отсчет времени.`;

                            const keyboard = {
                                inline_keyboard: [[
                                    { text: '▶️ Начать выполнение', callback_data: `start_task_${newTaskId}` }
                                ]]
                            };

                            bot.sendMessage(assignee.telegram_id, message, {
                                parse_mode: 'Markdown',
                                reply_markup: keyboard
                            });
                        }
                    });

                    delete global.userScreenshots[telegramId];
                    bot.answerCallbackQuery(callbackQuery.id);
                    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId });
                });
            });

        } else if (data === 'cancel_template_task_final') {
            delete global.userScreenshots[telegramId];
            bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Создание задачи отменено.' });
            bot.editMessageText('Создание задачи отменено.', { chat_id: chatId, message_id: messageId });
        } else if (data === 'show_bug_reports') {
            showBugReports(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('approve_bug_')) {
            console.log(`Approving bug: chatId=${chatId}, messageId=${messageId}`);
            const reportId = data.split('_')[2];
            db.get("SELECT * FROM bug_reports WHERE id = ?", [reportId], (err, report) => {
                if (err || !report) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Отчет не найден!' });
                    return;
                }
                if (report.status !== 'pending') {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот отчет уже обработан!' });
                    return;
                }

                const reward = 200; // Fixed reward
                db.run("UPDATE bug_reports SET status = 'approved' WHERE id = ?", [reportId]);
                db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [reward, report.user_id]);

                db.get("SELECT telegram_id FROM users WHERE id = ?", [report.user_id], (err, user) => {
                    if (user) {
                        bot.sendMessage(user.telegram_id, `🎉 Ваш отчет об ошибке #${reportId} был одобрен! Вы получили ${reward} П-коинов. Спасибо за вашу помощь!`);
                    }
                });

                bot.answerCallbackQuery(callbackQuery.id, { text: `✅ Отчет одобрен! Пользователю начислено ${reward} П-коинов.` });
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(console.error);
            });
        } else if (data.startsWith('reject_bug_')) {
            console.log(`Rejecting bug: chatId=${chatId}, messageId=${messageId}`);
            const reportId = data.split('_')[2];
            db.get("SELECT * FROM bug_reports WHERE id = ?", [reportId], (err, report) => {
                if (err || !report) {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Отчет не найден!' });
                    return;
                }
                if (report.status !== 'pending') {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот отчет уже обработан!' });
                    return;
                }
                db.run("UPDATE bug_reports SET status = 'rejected' WHERE id = ?", [reportId]);
                bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Отчет об ошибке отклонен!' }).catch(console.error);
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(console.error);
            });
        } else if (data === 'show_test_submissions') {
            showTestSubmissions(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('complete_task_')) {
            const taskId = data.split('_')[2];
            completeTask(chatId, telegramId, parseInt(taskId));
            bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Задача завершена!' }).catch(console.error);
            bot.deleteMessage(chatId, messageId).catch(console.error);
        } else if (data.startsWith('like_achievement_')) {
            const achievementId = data.split('_')[2];
            handleLikeAchievement(chatId, telegramId, parseInt(achievementId));
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('comment_achievement_')) {
            const achievementId = data.split('_')[2];
            startCommentAchievement(chatId, telegramId, parseInt(achievementId));
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data === 'start_pcoin_transfer') {
            startPcoinTransfer(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data === 'start_pcoin_exchange') {
            startPcoinExchange(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data === 'start_pcoin_request') {
            startPcoinRequest(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data === 'generate_my_qr') {
            generateUserQrCode(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('approve_pcoin_request_')) {
            const requestId = data.split('_')[3];
            db.get("SELECT * FROM pcoin_requests WHERE id = ?", [requestId], (err, request) => {
                if (err || !request || request.status !== 'pending') {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот запрос уже неактивен.', show_alert: true });
                    return;
                }

                db.get("SELECT * FROM users WHERE id = ?", [request.target_id], (err, targetUser) => {
                    if (err || !targetUser || targetUser.p_coins < request.amount) {
                        bot.answerCallbackQuery(callbackQuery.id, { text: '❌ У вас недостаточно П-коинов для этого перевода.', show_alert: true });
                        return;
                    }

                    db.serialize(() => {
                        db.run("UPDATE users SET p_coins = p_coins - ? WHERE id = ?", [request.amount, request.target_id]);
                        db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [request.amount, request.requester_id]);
                        db.run("UPDATE pcoin_requests SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);
                    });

                    bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Запрос одобрен!' });
                    bot.editMessageText(`✅ Вы одобрили запрос на ${request.amount} П-коинов.`, { chat_id: chatId, message_id: messageId });

                    db.get("SELECT telegram_id FROM users WHERE id = ?", [request.requester_id], (err, requester) => {
                        if (requester) {
                            bot.sendMessage(requester.telegram_id, `🎉 Ваш запрос на ${request.amount} П-коинов был одобрен пользователем ${targetUser.full_name}!`);
                        }
                    });
                });
            });
        } else if (data.startsWith('decline_pcoin_request_')) {
            const requestId = data.split('_')[3];
            db.get("SELECT * FROM pcoin_requests WHERE id = ?", [requestId], (err, request) => {
                if (err || !request || request.status !== 'pending') {
                    bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Этот запрос уже неактивен.', show_alert: true });
                    return;
                }

                db.run("UPDATE pcoin_requests SET status = 'declined', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?", [requestId]);

                bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Запрос отклонен.' });
                bot.editMessageText(`❌ Вы отклонили запрос на ${request.amount} П-коинов.`, { chat_id: chatId, message_id: messageId });

                db.get("SELECT telegram_id, full_name FROM users WHERE id = ?", [request.target_id], (err, targetUser) => {
                    db.get("SELECT telegram_id FROM users WHERE id = ?", [request.requester_id], (err, requester) => {
                        if (requester) {
                            bot.sendMessage(requester.telegram_id, `😔 Пользователь ${targetUser.full_name} отклонил ваш запрос на ${request.amount} П-коинов.`);
                        }
                    });
                });
            });
        } else if (data === 'generate_my_qr') {
            generateUserQrCode(chatId, telegramId);
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('add_company_info_')) {
            const scannerId = data.split('_')[3];
            
            // Set state for collecting company info
            global.userScreenshots[telegramId] = {
                type: 'collect_company_info',
                step: 'awaiting_company_name',
                scannerId: scannerId
            };
            
            bot.sendMessage(chatId,
                '📝 *Добавление информации о контакте*\n\n' +
                'Пожалуйста, введите название компании:',
                { parse_mode: 'Markdown' }
            );
            
            bot.answerCallbackQuery(callbackQuery.id).catch(console.error);
        } else if (data.startsWith('delete_user_')) {
            handleUserDeletionCallback(chatId, callbackQuery.message.message_id, telegramId, data, callbackQuery.id);
        }
    } catch (error) {
        console.error('❌ Callback query error:', error);
    }
});

function deleteUser(userId, callback) {
    const tablesToDeleteFrom = [
        { name: 'admins', column: 'user_id' },
        { name: 'achievement_comments', column: 'user_id' },
        { name: 'achievement_likes', column: 'user_id' },
        { name: 'achievements', column: 'user_id' },
        { name: 'bug_reports', column: 'user_id' },
        { name: 'company_contacts', column: 'added_by' },
        { name: 'event_bookings', column: 'user_id' },
        { name: 'exchange_history', column: 'user_id' },
        { name: 'intern_progress', column: 'user_id' },
        { name: 'invoices', column: 'creator_id' },
        { name: 'purchases', column: 'user_id' },
        { name: 'task_comments', column: 'user_id' },
        { name: 'test_submissions', column: 'user_id' },
        { name: 'vacation_balances', column: 'user_id' },
    ];

    const promises = [];

    // Nullify references first
    promises.push(db.run("UPDATE users SET mentor_id = NULL WHERE mentor_id = ?", [userId]));
    promises.push(db.run("UPDATE battles SET winner_id = NULL WHERE winner_id = ?", [userId]));
    promises.push(db.run("UPDATE vacation_requests SET reviewer_id = NULL WHERE reviewer_id = ?", [userId]));

    // Delete from junction/dependent tables
    tablesToDeleteFrom.forEach(table => {
        promises.push(db.run(`DELETE FROM ${table.name} WHERE ${table.column} = ?`, [userId]));
    });

    // Special cases for tables with multiple FKs to users
    promises.push(db.run("DELETE FROM battles WHERE attacker_id = ? OR defender_id = ?", [userId, userId]));
    promises.push(db.run("DELETE FROM conference_contacts WHERE scanner_id = ? OR manager_id = ?", [userId, userId]));
    promises.push(db.run("DELETE FROM gifts WHERE sender_id = ? OR receiver_id = ?", [userId, userId]));
    promises.push(db.run("DELETE FROM pcoin_requests WHERE requester_id = ? OR target_id = ?", [userId, userId]));
    promises.push(db.run("DELETE FROM tasks WHERE creator_id = ? OR assignee_id = ?", [userId, userId]));
    promises.push(db.run("DELETE FROM vacation_requests WHERE user_id = ?", [userId]));

    // Finally, delete the user
    Promise.all(promises)
        .then(() => {
            db.run("DELETE FROM users WHERE id = ?", [userId])
                .then(() => callback(null))
                .catch(err => callback(err));
        })
        .catch(err => {
            console.error(`Cascade delete failed for user ${userId}`, err);
            callback(err);
        });
}

function handleUserDeletionCallback(chatId, messageId, telegramId, data, callbackQueryId) {
    const parts = data.split('_');
    const action = parts[2];

    if (action === 'page') {
        const page = parseInt(parts[3], 10);
        bot.deleteMessage(chatId, messageId).catch(()=>{}); // Ignore errors if message is already gone
        startUserDeletion(chatId, telegramId, page);
        bot.answerCallbackQuery(callbackQueryId).catch(()=>{});
        return;
    }

    if (action === 'cancel') {
        bot.answerCallbackQuery(callbackQueryId, { text: 'Отменено' });
        bot.editMessageText('Удаление пользователя отменено.', { chat_id: chatId, message_id: messageId, reply_markup: null });
        return;
    }

    if (action === 'select') {
        const userId = parseInt(parts[3], 10);
        if (isNaN(userId)) {
            bot.answerCallbackQuery(callbackQueryId, { text: 'Ошибка: неверный ID пользователя', show_alert: true });
            return;
        }

        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, userToDelete) => {
            if (err || !userToDelete) {
                bot.answerCallbackQuery(callbackQueryId, { text: 'Ошибка: пользователь не найден', show_alert: true });
                return;
            }

            if (userToDelete.telegram_id == config.SUPER_ADMIN_ID) {
                bot.answerCallbackQuery(callbackQueryId, { text: 'Нельзя удалить суперадминистратора', show_alert: true });
                bot.editMessageText('❌ Попытка удаления суперадминистратора.', { chat_id: chatId, message_id: messageId, reply_markup: null });
                return;
            }

            const confirmationText = `Вы уверены, что хотите удалить пользователя **${getUserDisplayName(userToDelete)}**?` +
                                   `\n\nЭто действие удалит ВСЕ его данные и является **НЕОБРАТИМЫМ**.`;

            const keyboard = {
                inline_keyboard: [[
                    { text: '✅ Да, удалить', callback_data: `delete_user_confirm_${userToDelete.id}` },
                    { text: '❌ Нет, отмена', callback_data: 'delete_user_cancel' }
                ]]
            };
            bot.editMessageText(confirmationText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
            bot.answerCallbackQuery(callbackQueryId).catch(()=>{});
        });
        return;
    }

    if (action === 'confirm') {
        const userId = parseInt(parts[3], 10);
        if (isNaN(userId)) {
            bot.answerCallbackQuery(callbackQueryId, { text: 'Ошибка: неверный ID пользователя', show_alert: true });
            return;
        }

        bot.answerCallbackQuery(callbackQueryId, { text: 'Удаление...' });
        
        deleteUser(userId, (err) => {
            if (err) {
                console.error("Error during user deletion:", err);
                bot.editMessageText('❌ Произошла ошибка при удалении пользователя.', { chat_id: chatId, message_id: messageId, reply_markup: null });
            } else {
                bot.editMessageText(`✅ Пользователь (ID: ${userId}) и все его данные были успешно удалены.`, { chat_id: chatId, message_id: messageId, reply_markup: null });
                console.log(`Admin ${telegramId} deleted user ${userId}`);
            }
        });
    }
}

function approveSubmission(chatId, messageId, adminTelegramId, submissionId, callbackQueryId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [adminTelegramId], (err, admin) => {
            if (!admin) {
                bot.answerCallbackQuery(callbackQueryId, { text: '❌ Нет прав!' }).catch(console.error);
                return;
            }
            
            db.get("SELECT * FROM test_submissions WHERE id = ? AND status = 'pending'", 
                   [submissionId], (err, submission) => {
                if (!submission) {
                    bot.answerCallbackQuery(callbackQueryId, { text: '❌ Заявка не найдена!' }).catch(console.error);
                    return;
                }
                
                // Обновляем статус заявки
                db.run("UPDATE test_submissions SET status = 'approved', admin_id = ?, reviewed_date = CURRENT_TIMESTAMP WHERE id = ?",
                       [admin.user_id, submissionId], () => {

                    // Записываем прогресс с баллами, которые ввел пользователь
                    db.run(`INSERT OR REPLACE INTO intern_progress
                            (user_id, test_name, completed, points_earned, completed_date)
                            VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)`,
                           [submission.user_id, submission.test_name, submission.points_claimed], (err) => {

                        if (err) {
                            console.error('❌ Error inserting into intern_progress:', err);
                            return;
                        }

                        console.log(`✅ Added test "${submission.test_name}" to intern_progress for user ${submission.user_id}`);

                        // Небольшая задержка для гарантии что INSERT завершился
                        setTimeout(() => {
                            // Проверяем, не выпускник ли это
                            db.get("SELECT role FROM users WHERE id = ?", [submission.user_id], (err, user) => {
                                if (err || !user) {
                                    console.error('[GRADUATION CHECK] Error getting user:', err);
                                    return;
                                }

                                console.log(`[GRADUATION CHECK] User ${submission.user_id} role: ${user.role}`);

                                if (user.role === 'стажер') {
                                        db.get("SELECT COUNT(*) as count FROM intern_progress WHERE user_id = ? AND completed = 1", [submission.user_id], (err, row) => {
                                            if (err) {
                                                console.error('Error counting completed tests:', err);
                                                return;
                                            }

                                            console.log(`[GRADUATION CHECK] User ${submission.user_id} has ${row.count}/3 tests completed`);
                                            console.log(`[GRADUATION CHECK] row.count type: ${typeof row.count}, value: ${row.count}`);

                                            if (parseInt(row.count) === 3) {
                                                console.log(`🎓 [GRADUATION TRIGGERED] User ${submission.user_id} completed all 3 tests!`);

                                                // Начисляем бонус за окончание стажировки
                                                const graduationBonus = 400;
                                                db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [graduationBonus, submission.user_id], (err) => {
                                                    if (err) {
                                                        console.error('❌ Error adding graduation bonus:', err);
                                                    } else {
                                                        console.log(`✅ Added ${graduationBonus} graduation bonus to user ${submission.user_id}`);
                                                    }
                                                });

                                                // Запускаем процесс выпуска
                                                global.userScreenshots[submission.telegram_id] = {
                                                    type: 'graduation',
                                                    step: 'welcome_message'
                                                };

                                                console.log(`📧 Sending graduation message to telegram_id: ${submission.telegram_id}`);

                                                bot.sendMessage(submission.telegram_id,
                                                    `🎉 Поздравляем! Ты прошел стажировку и теперь становишься полноправным членом команды! 🥳\n\n` +
                                                    `💰 В качестве бонуса тебе начислено ${graduationBonus} стартовых П-коинов!\n\n` +
                                                    'Тебе открыт весь функционал нашего бота. Можешь поздороваться с коллегами и написать приветственное сообщение, которое увидят все! 📣\n\n' +
                                                    'Напиши свое приветствие:'
                                                ).then(() => {
                                                    console.log(`✅ Graduation message sent successfully to ${submission.telegram_id}`);
                                                }).catch(err => {
                                                    console.error(`❌ Error sending graduation message to ${submission.telegram_id}:`, err);
                                                });
                                        } else {
                                            // Обычное сообщение об одобрении для стажера (без П-коинов)
                                            bot.sendMessage(submission.telegram_id,
                                                `🎉 ТЕСТ ОДОБРЕН! ✅\n\n` +
                                                `📚 Тест: ${submission.test_name}\n` +
                                                `🎯 Баллы на курсе: ${submission.points_claimed}\n\n` +
                                                '🏆 Отличная работа! Так держать! 💪\n' +
                                                '🚀 Продолжай проходить тесты!').catch(console.error);
                                        }
                                    });
                                } else {
                                    // Сообщение для старичков - начисляем П-коины
                                    db.run("UPDATE users SET p_coins = p_coins + ? WHERE telegram_id = ?",
                                           [submission.points_claimed, submission.telegram_id], (err) => {
                                        if (err) {
                                            console.error('❌ Error adding coins to old-timer:', err);
                                        } else {
                                            console.log(`✅ Added ${submission.points_claimed} coins to old-timer ${submission.telegram_id}`);
                                        }

                                        bot.sendMessage(submission.telegram_id,
                                            `🎉 ТЕСТ ОДОБРЕН! ✅\n\n` +
                                            `📚 Тест: ${submission.test_name}\n` +
                                            `💰 Получено: +${submission.points_claimed} П-коинов\n\n` +
                                            '🏆 Отличная работа! Так держать! 💪\n' +
                                            '🚀 Продолжай развиваться!').catch(console.error);
                                    });
                                }
                            });
                        }, 100); // setTimeout delay
                    });
                    
                    // Обновляем сообщение админа
                    bot.editMessageCaption(
                        `✅ ЗАЯВКА #${submission.id} - ОДОБРЕНА!\n\n` +
                        `👤 Пользователь: @${submission.username}\n` +
                        `📚 Тест: ${submission.test_name}\n` +
                        `💰 Начислено: ${submission.points_claimed} баллов\n\n` +
                        '🎉 Решение принято!',
                        {
                            chat_id: chatId,
                            message_id: messageId,
                            reply_markup: { inline_keyboard: [] }
                        }
                    ).catch(console.error);
                    
                    bot.answerCallbackQuery(callbackQueryId, {
                        text: '✅ Одобрено! Баллы начислены!',
                        show_alert: false
                    }).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Approve submission error:', error);
    }
}

function rejectSubmission(chatId, messageId, adminTelegramId, submissionId, callbackQueryId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [adminTelegramId], (err, admin) => {
            if (!admin) {
                bot.answerCallbackQuery(callbackQueryId, { text: '❌ Нет прав!' }).catch(console.error);
                return;
            }
            
            db.get("SELECT * FROM test_submissions WHERE id = ? AND status = 'pending'", 
                   [submissionId], (err, submission) => {
                if (!submission) {
                    bot.answerCallbackQuery(callbackQueryId, { text: '❌ Заявка не найдена!' }).catch(console.error);
                    return;
                }
                
                // Обновляем статус заявки
                db.run("UPDATE test_submissions SET status = 'rejected', admin_id = ?, reviewed_date = CURRENT_TIMESTAMP WHERE id = ?", 
                       [admin.user_id, submissionId], () => {
                    
                    // Уведомляем пользователя
                    bot.sendMessage(submission.telegram_id, 
                        `❌ Тест отклонен 😔\n\n` +
                        `📚 Тест: ${submission.test_name}\n\n` +
                        '🤔 Возможные причины:\n' +
                        '• Неправильный или нечеткий скриншот 📸\n' +
                        '• Неверно указаны баллы 🎯\n' +
                        '• Тест не завершен полностью ⏳\n' +
                        '• Подозрение в мошенничестве 🚫\n\n' +
                        '💪 Не расстраивайся! Попробуй еще раз!\n' +
                        '🎯 Будь внимательнее при прохождении!').catch(console.error);
                    
                    // Обновляем сообщение админа
                    bot.editMessageCaption(
                        `❌ ЗАЯВКА #${submission.id} - ОТКЛОНЕНА!\n\n` +
                        `👤 Пользователь: @${submission.username}\n` +
                        `📚 Тест: ${submission.test_name}\n` +
                        `🎯 Заявленные баллы: ${submission.points_claimed}\n\n` +
                        '🚫 Решение принято!', 
                        { 
                            chat_id: chatId, 
                            message_id: messageId, 
                            reply_markup: { inline_keyboard: [] } 
                        }
                    ).catch(console.error);
                    
                    bot.answerCallbackQuery(callbackQueryId, { 
                        text: '❌ Отклонено!', 
                        show_alert: false 
                    }).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Reject submission error:', error);
    }
}

// ========== ОБРАБОТКА ОШИБОК И ЗАПУСК ========== 

// Cron job to update intern roles to old-timers after 3 months
cron.schedule('0 0 * * *', () => {
    console.log('Running a daily cron job to update intern roles...');
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    db.all("SELECT * FROM users WHERE role = 'стажер' AND registration_date <= ?", [threeMonthsAgo.toISOString()], (err, users) => {
        if (err) {
            console.error('Error fetching interns for role update:', err);
            return;
        }

        if (users && users.length > 0) {
            users.forEach(user => {
                db.run("UPDATE users SET role = 'старичок' WHERE id = ?", [user.id], (err) => {
                    if (err) {
                        console.error(`Error updating role for user ${user.id}:`, err);
                    } else {
                        console.log(`User ${user.full_name} (${user.id}) has been promoted to 'старичок'.`);
                        bot.sendMessage(user.telegram_id,
                            '🎉 Поздравляем! 🎉\n\n' +
                            'Прошло 3 месяца с твоей регистрации, и теперь ты официально становишься "старичком" в нашей команде!\n\n' +
                            'Спасибо за твою работу и вклад в нашу компанию! 💪'
                        ).catch(console.error);
                    }
                });
            });
        }
    });
});

// Cron job to update Junior to Middle after 3 months from graduation
cron.schedule('0 0 * * *', () => {
    console.log('Running a daily cron job to update Junior to Middle...');
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    db.all("SELECT * FROM users WHERE position_level = 'Junior' AND graduated_at IS NOT NULL AND graduated_at <= ?", [threeMonthsAgo.toISOString()], (err, users) => {
        if (err) {
            console.error('Error fetching Juniors for level update:', err);
            return;
        }

        if (users && users.length > 0) {
            users.forEach(user => {
                db.run("UPDATE users SET position_level = 'Middle' WHERE id = ?", [user.id], (err) => {
                    if (err) {
                        console.error(`Error updating position_level for user ${user.id}:`, err);
                    } else {
                        console.log(`User ${user.full_name} (${user.id}) has been promoted to 'Middle'.`);
                        bot.sendMessage(user.telegram_id,
                            '🎉 Поздравляем с повышением! 🎉\n\n' +
                            '🚀 Прошло 3 месяца с твоего выпуска, и теперь ты официально становишься специалистом уровня Middle!\n\n' +
                            '💪 Продолжай расти и развиваться! Ты на правильном пути!'
                        ).catch(console.error);
                    }
                });
            });
        }
    });
});

// Cron job to automatically update user statuses
cron.schedule('*/15 * * * *', updateUserStatusesCron);

console.log('🚀 Бот "Жизнь в Партнеркине" запускается...');console.log('🎯 Версия: Кнопочная 2.0');
console.log('📋 Ctrl+C для остановки');

// Remove bot commands menu completely (but /start will still work)
bot.setMyCommands([]).then(() => {
    console.log('✅ Меню команд бота полностью убрано');
}).catch(err => {
    console.error('❌ Ошибка при удалении команд меню:', err.message);
});

// Initialize task reminders from DB after a short delay
setTimeout(initializeSchedules, 5000); // 5 second delay

bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

// CLEANUP: Periodically clean up old action timestamps to prevent memory leaks
setInterval(() => {
    if (global.lastActionTimes) {
        const now = Date.now();
        const cutoffTime = now - 60000; // Keep actions from last 60 seconds
        let cleanedCount = 0;
        
        for (const key in global.lastActionTimes) {
            if (global.lastActionTimes[key] < cutoffTime) {
                delete global.lastActionTimes[key];
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`[CLEANUP] Removed ${cleanedCount} old action timestamps`);
        }
    }
}, 30000); // Run cleanup every 30 seconds

function updateUserStatusesCron() {
    console.log('[CRON] Running job to update user statuses...');

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    // Set users to 'offline' if inactive for 2 days (and not already busy/offline)
    db.run(`UPDATE users SET status = 'offline' 
            WHERE last_activity < ? 
            AND status NOT IN ('offline', 'busy')`, 
            [twoDaysAgo], function() {
        if (this.changes > 0) {
            console.log(`[CRON] Set ${this.changes} users to 'offline'.`);
        }
    });

    // Set 'online' users to 'away' if inactive for 1 hour (but less than 2 days)
    db.run(`UPDATE users SET status = 'away' 
            WHERE last_activity < ? 
            AND last_activity >= ? 
            AND status = 'online'`, 
            [oneHourAgo, twoDaysAgo], function() {
        if (this.changes > 0) {
            console.log(`[CRON] Set ${this.changes} users to 'away'.`);
        }
    });
}

function initializeSchedules() {
    console.log('[SCHEDULER] Initializing schedules for active tasks...');
    db.all("SELECT id, reminder_interval_minutes, assignee_id, title FROM tasks WHERE status = 'in_progress' AND reminder_interval_minutes IS NOT NULL", (err, tasks) => {
        if (err) {
            console.error('[SCHEDULER] Error fetching tasks for schedule initialization:', err);
            return;
        }

        if (tasks && tasks.length > 0) {
            tasks.forEach(task => {
                scheduleTaskReminder(task.id, task.reminder_interval_minutes, task.assignee_id, task.title);
            });
            console.log(`[SCHEDULER] Initialized ${tasks.length} task reminders.`);
        } else {
            console.log('[SCHEDULER] No active tasks with reminders to initialize.');
        }
    });
}

// ========== УЛУЧШЕННЫЕ ФУНКЦИИ ТАСК-ТРЕКЕРА ==========

function handleTaskCreation(chatId, telegramId, text) {
    // [DEBUG LOG] Task creation entry
    const taskState = global.userScreenshots[telegramId];
    console.log(`[TASK DEBUG] User ${telegramId} text "${text}" | Step: ${taskState ? taskState.step : 'none'}`);
    
    try {
        const taskData = global.userScreenshots[telegramId];

        switch (taskData.step) {
            case 'select_assignee':
                const userIndex = parseInt(text) - 1;

                if (isNaN(userIndex) || userIndex < 0 || userIndex >= taskData.users.length) {
                    console.log(`[TASK DEBUG] Invalid assignee index "${text}" for user ${telegramId}, users length: ${taskData.users.length}`);
                    bot.sendMessage(chatId, '❌ Неверный номер пользователя! Попробуй еще раз 🔢').catch(console.error);
                    return;
                }

                taskData.taskData.assignee_id = taskData.users[userIndex].id;
                taskData.taskData.assignee_name = getUserDisplayName(taskData.users[userIndex]);
                taskData.step = 'enter_title';
                bot.sendMessage(chatId, `👤 Исполнитель: ${taskData.taskData.assignee_name}\n\n📝 Напиши НАЗВАНИЕ задачи:`);
                break;

            case 'enter_title':
                taskData.taskData.title = text;
                taskData.step = 'enter_description';
                bot.sendMessage(chatId,
                    `📝 Название: "${text}"\n\n` +
                    '📋 Напиши ОПИСАНИЕ задачи:\n' +
                    '💡 Детально опиши что нужно сделать\n' +
                    '⚡ Или напиши "без описания"').catch(console.error);
                break;

            case 'enter_description':
                taskData.taskData.description = text === 'без описания' ? null : text;
                taskData.step = 'select_priority';
                bot.sendMessage(chatId,
                    `📋 Описание: ${taskData.taskData.description || 'Без описания'}\n\n` +
                    '🎯 Выбери ПРИОРИТЕТ задачи:', taskPriorityKeyboard).catch(console.error);
                break;

            case 'select_priority': // This case is handled by setTaskPriority, but as a fallback
                bot.sendMessage(chatId, 'Пожалуйста, используйте кнопки для выбора приоритета.', taskPriorityKeyboard).catch(console.error);
                break;

            case 'select_reward': // This case is handled by setTaskReward, but as a fallback
                bot.sendMessage(chatId, 'Пожалуйста, используйте кнопки для выбора награды.', taskRewardKeyboard).catch(console.error);
                break;

            case 'enter_due_date':
                let dueDate = null;
                if (text.toLowerCase() === 'без срока') {
                    taskData.taskData.due_date = null;
                } else {
                    // Try parsing with chrono
                    const parsedDate = chrono.ru.parseDate(text, new Date(), { forwardDate: true });

                    if (parsedDate) {
                        // Format to YYYY-MM-DD HH:MM:SS
                        dueDate = parsedDate.toISOString();
                    } else {
                        // Fallback to regex if chrono fails
                        const dateMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
                        if (!dateMatch) {
                            bot.sendMessage(chatId, '❌ Неверный формат даты! Попробуйте, например, "завтра в 18:00" или укажите дату в формате ДД.ММ.ГГГГ.').catch(console.error);
                            return;
                        }
                        dueDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
                    }
                    taskData.taskData.due_date = dueDate;
                }

                taskData.step = 'ask_for_reminders';

                const reminderQuestionKeyboard = {
                    reply_markup: {
                        keyboard: [
                            ['Да, нужно', 'Нет, спасибо']
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                bot.sendMessage(chatId, 'Нужно ли будет напоминать о задаче?', reminderQuestionKeyboard);
                break;

            case 'ask_for_reminders':
                if (text === 'Нет, спасибо') {
                    taskData.taskData.reminder_interval_minutes = null;
                    finalizeTaskCreation(chatId, telegramId);
                } else if (text === 'Да, нужно') {
                    taskData.step = 'select_reminder_interval';
                    const reminderIntervalKeyboard = {
                        reply_markup: {
                            keyboard: [['Каждый час', 'Каждые 3 часа'], ['Свой интервал', '❌ Отмена']],
                            resize_keyboard: true, one_time_keyboard: true
                        }
                    };
                    bot.sendMessage(chatId, 'Как часто напоминать о задаче?', reminderIntervalKeyboard);
                }
                break;

            case 'select_reminder_interval':
                if (text === '❌ Отмена') {
                    delete global.userScreenshots[telegramId];
                    showTasksMenu(chatId, telegramId);
                    return;
                }

                if (text === 'Каждый час') {
                    taskData.taskData.reminder_interval_minutes = 60;
                    finalizeTaskCreation(chatId, telegramId);
                } else if (text === 'Каждые 3 часа') {
                    taskData.taskData.reminder_interval_minutes = 180;
                    finalizeTaskCreation(chatId, telegramId);
                } else if (text === 'Свой интервал') {
                    taskData.step = 'enter_custom_interval';
                    bot.sendMessage(chatId, 'Введите интервал напоминаний в минутах:');
                }
                break;

            case 'enter_custom_interval':
                const interval = parseInt(text);
                if (isNaN(interval) || interval <= 0) {
                    bot.sendMessage(chatId, '❌ Введите корректное число (больше 0).');
                    return;
                }
                taskData.taskData.reminder_interval_minutes = interval;
                finalizeTaskCreation(chatId, telegramId);
                break;
        }
    } catch (error) {
        console.error('❌ Handle task creation error:', error);
    }
}

function finalizeTaskCreation(chatId, telegramId) {
    const taskData = global.userScreenshots[telegramId];
    if (!taskData) return;

    const { creator_id, assignee_id, title, description, priority, reward_coins, due_date, reminder_interval_minutes } = taskData.taskData;

    db.run(`INSERT INTO tasks (creator_id, assignee_id, title, description, priority, reward_coins, due_date, reminder_interval_minutes, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [creator_id, assignee_id, title, description, priority, reward_coins, due_date, reminder_interval_minutes || null], function(err) {
        
        if (err) {
            console.error('Task creation DB error:', err);
            bot.sendMessage(chatId, '❌ Ошибка создания задачи в базе данных!');
            delete global.userScreenshots[telegramId];
            return;
        }

        const newTaskId = this.lastID;

        // Schedule reminder if needed
        if (reminder_interval_minutes && reminder_interval_minutes > 0) {
            scheduleTaskReminder(newTaskId, reminder_interval_minutes, assignee_id, title);
        }

        // Уведомляем создателя
        bot.sendMessage(chatId,
            '✅ ЗАДАЧА СОЗДАНА! 🎉\n\n' +
            `👤 Исполнитель: ${taskData.taskData.assignee_name}\n` +
            `📝 Название: ${title}\n` +
            `📋 Описание: ${description || 'Без описания'}\n` +
            `🎯 Приоритет: ${priority === 'high' ? '🔴 Высокий' : priority === 'medium' ? '🟡 Средний' : '🟢 Низкий'}\n` +
            `💰 Награда: ${reward_coins} П-коинов\n` +
            `📅 Срок: ${due_date ? new Date(due_date).toLocaleString('ru-RU') : 'Без срока'}\n` +
            (reminder_interval_minutes ? `⏰ Напоминание: каждые ${reminder_interval_minutes} мин.\n` : '') +
            '\n🚀 Исполнитель получит уведомление!', mainMenuKeyboard).catch(console.error);

        // Уведомляем исполнителя
        db.get("SELECT telegram_id FROM users WHERE id = ?", [assignee_id], (err, assignee) => {
            if (assignee) {
                const priorityText = priority === 'high' ? '🔴 Высокий' : priority === 'medium' ? '🟡 Средний' : '🟢 Низкий';
                const dueDateText = due_date ? new Date(due_date).toLocaleString('ru-RU') : 'Без срока';

                const message = `🎯 **Новая задача!**\n\n` +
                                `**Название:** ${title}\n` +
                                `**Описание:** ${description || 'Без описания'}\n\n` +
                                `**Приоритет:** ${priorityText}\n` +
                                `**Срок выполнения:** ${dueDateText}\n\n` +
                                `Нажмите, чтобы начать отсчет времени.`;

                const keyboard = {
                    inline_keyboard: [[
                        { text: '▶️ Начать выполнение', callback_data: `start_task_${newTaskId}` }
                    ]]
                };

                bot.sendMessage(assignee.telegram_id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                });
            }
        });

        delete global.userScreenshots[telegramId];
    });
}

function setTaskPriority(chatId, telegramId, priority) {
    try {
        if (!global.userScreenshots[telegramId] || global.userScreenshots[telegramId].type !== 'task_creation') {
            return;
        }

        const taskData = global.userScreenshots[telegramId];

        switch (priority) {
            case '🔴 Высокий':
                taskData.taskData.priority = 'high';
                break;
            case '🟡 Средний':
                taskData.taskData.priority = 'medium';
                break;
            case '🟢 Низкий':
                taskData.taskData.priority = 'low';
                break;
        }

        taskData.step = 'select_reward';

        bot.sendMessage(chatId,
            `🎯 Приоритет: ${priority}\n\n` +
            '💰 Выбери НАГРАДУ за выполнение:', taskRewardKeyboard).catch(console.error);
    } catch (error) {
        console.error('❌ Set task priority error:', error);
    }
}

function setTaskReward(chatId, telegramId, reward) {
    try {
        if (!global.userScreenshots[telegramId] || global.userScreenshots[telegramId].type !== 'task_creation') {
            return;
        }

        const taskData = global.userScreenshots[telegramId];
        taskData.taskData.reward_coins = parseInt(reward.split(' ')[0]);
        taskData.step = 'enter_due_date';

        bot.sendMessage(chatId,
            `💰 Награда: ${reward}\n\n` +
            '📅 Укажи СРОК выполнения:\n' +
            '💡 Формат: ДД.ММ.ГГГГ (например: 25.12.2024)\n' +
            '⚡ Или напиши "без срока"').catch(console.error);
    } catch (error) {
        console.error('❌ Set task reward error:', error);
    }
}

// ========== НОВЫЕ ФУНКЦИИ ТАСК-ТРЕКЕРА ==========

function showPostponedTasks(chatId, telegramId) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT t.*,
                    u_creator.full_name as creator_name, u_creator.username as creator_username
                    FROM tasks t
                    LEFT JOIN users u_creator ON t.creator_id = u_creator.id
                    WHERE t.assignee_id = ? AND t.status = 'postponed'
                    ORDER BY t.postponed_until ASC`, [user.id], (err, tasks) => {

                if (!tasks || tasks.length === 0) {
                    bot.sendMessage(chatId,
                        '📦 ОТЛОЖЕННЫЕ ЗАДАЧИ 📋\n\n' +
                        '✅ Нет отложенных задач!\n\n' +
                        '🚀 Все задачи в работе!').catch(console.error);
                    return;
                }

                let tasksText = '📦 ОТЛОЖЕННЫЕ ЗАДАЧИ 📋\n\n';

                tasks.forEach((task, index) => {
                    const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
                    const creatorName = task.creator_name || task.creator_username || 'Система';
                    const postponedUntil = task.postponed_until ? new Date(task.postponed_until).toLocaleDateString('ru-RU') : 'не указан';

                    tasksText += `${index + 1}. ${priority} ${task.title}\n`;
                    tasksText += `   📝 ${task.description || 'Описание отсутствует'}\n`;
                    tasksText += `   👤 От: ${creatorName}\n`;
                    tasksText += `   📅 Отложено до: ${postponedUntil}\n`;
                    if (task.reward_coins > 0) {
                        tasksText += `   💰 Награда: ${task.reward_coins} П-коинов\n`;
                    }
                    tasksText += '\n';
                });

                bot.sendMessage(chatId, tasksText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show postponed tasks error:', error);
    }
}

function showCancelledTasks(chatId, telegramId) {
    try {
        db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) return;

            db.all(`SELECT t.*,
                    u_creator.full_name as creator_name, u_creator.username as creator_username
                    FROM tasks t
                    LEFT JOIN users u_creator ON t.creator_id = u_creator.id
                    WHERE (t.assignee_id = ? OR t.creator_id = ?) AND t.status = 'cancelled'
                    ORDER BY t.last_action_date DESC
                    LIMIT 10`, [user.id, user.id], (err, tasks) => {

                if (!tasks || tasks.length === 0) {
                    bot.sendMessage(chatId,
                        '❌ ОТМЕНЕННЫЕ ЗАДАЧИ 📋\n\n' +
                        '✅ Нет отмененных задач!\n\n' +
                        '🚀 Отличная работа!').catch(console.error);
                    return;
                }

                let tasksText = '❌ ОТМЕНЕННЫЕ ЗАДАЧИ 📋\n\n';

                tasks.forEach((task, index) => {
                    const priority = task.priority === 'high' ? '🔴' : task.priority === 'medium' ? '🟡' : '🟢';
                    const creatorName = task.creator_name || task.creator_username || 'Система';
                    const cancelDate = new Date(task.last_action_date).toLocaleDateString('ru-RU');

                    tasksText += `${index + 1}. ${priority} ${task.title}\n`;
                    tasksText += `   📝 ${task.description || 'Описание отсутствует'}\n`;
                    tasksText += `   👤 От: ${creatorName}\n`;
                    tasksText += `   📅 Отменено: ${cancelDate}\n`;
                    if (task.cancelled_reason) {
                        tasksText += `   💬 Причина: ${task.cancelled_reason}\n`;
                    }
                    tasksText += '\n';
                });

                bot.sendMessage(chatId, tasksText).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show cancelled tasks error:', error);
    }
}

function acceptTask(chatId, telegramId) {
    bot.sendMessage(chatId,
        '✅ Задача принята к выполнению!\n\n' +
        '🎯 Задача перешла в статус "Выполняется"\n' +
        '💪 Удачи в выполнении!', mainMenuKeyboard).catch(console.error);
}

function startTaskComment(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'task_comment',
        step: 'enter_comment'
    };

    bot.sendMessage(chatId,
        '💬 КОММЕНТАРИЙ К ЗАДАЧЕ\n\n' +
        '📝 Напиши свой комментарий к задаче:\n' +
        '💡 Объясни, что не так или что нужно уточнить').catch(console.error);
}

function postponeTask(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'task_postpone',
        step: 'enter_date'
    };

    bot.sendMessage(chatId,
        '📦 ОТЛОЖИТЬ ЗАДАЧУ\n\n' +
        '📅 На какую дату отложить задачу?\n' +
        '💡 Формат: ДД.ММ.ГГГГ (например: 25.12.2024)\n' +
        '⚡ Или напиши "на неделю" / "на месяц"').catch(console.error);
}

function cancelTask(chatId, telegramId) {
    const currentState = global.userScreenshots[telegramId];
    if (!currentState || !currentState.taskId) {
        bot.sendMessage(chatId, '❌ Сначала нужно выбрать задачу для отмены.');
        return;
    }

    global.userScreenshots[telegramId] = {
        type: 'task_cancel',
        step: 'enter_reason',
        taskId: currentState.taskId // Preserve the taskId
    };

    bot.sendMessage(chatId,
        '❌ ОТМЕНИТЬ ЗАДАЧУ\n\n' +
        '📝 Укажи причину отмены:\n' +
        '💡 Объясни, почему задачу нельзя выполнить').catch(console.error);
}

function redirectTask(chatId, telegramId) {
    bot.sendMessage(chatId,
        '🔄 Задача отправлена исполнителю для доработки\n\n' +
        '📋 Исполнитель получит уведомление с вашим комментарием', mainMenuKeyboard).catch(console.error);
}

function keepTaskAsIs(chatId, telegramId) {
    bot.sendMessage(chatId,
        '📦 Задача оставлена без изменений\n\n' +
        '✅ Комментарий сохранен в истории задачи', mainMenuKeyboard).catch(console.error);
}

// ========== ФУНКЦИИ УПРАВЛЕНИЯ БАЛАНСОМ ==========

function showBalanceManagement(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Доступ запрещен!').catch(console.error);
                return;
            }

            const balanceKeyboard = {
                reply_markup: {
                    keyboard: [
                        ['➕ Начислить баллы', '➖ Списать баллы'],
                        ['👥 Список пользователей', '📊 Балансы'],
                        ['🔙 Назад в админку']
                    ],
                    resize_keyboard: true
                }
            };

            bot.sendMessage(chatId,
                '💰 УПРАВЛЕНИЕ БАЛАНСОМ 💳\n\n' +
                '➕ Начислить баллы пользователям\n' +
                '➖ Списать баллы за нарушения\n' +
                '👥 Список пользователей\n' +
                '📊 Просмотр всех балансов\n\n' +
                '👇 Выбери действие:', balanceKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show balance management error:', error);
    }
}

// ========== ФУНКЦИЯ ПОХВАСТАТЬСЯ ==========

function startAchievementCreation(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'achievement_creation',
        step: 'enter_title'
    };

    bot.sendMessage(chatId,
        '🎉 ПОХВАСТАТЬСЯ ДОСТИЖЕНИЕМ! 🏆\n\n' +
        '📝 Напиши НАЗВАНИЕ своего достижения:\n' +
        '💡 Например: "Закрыл крупную сделку", "Выучил новый навык"\n' +
        '⚡ Или опиши свой успех кратко').catch(console.error);
}

function handleAchievementCreation(chatId, telegramId, text) {
    try {
        const achievementData = global.userScreenshots[telegramId];

        if (achievementData.step === 'enter_title') {
            achievementData.title = text;
            achievementData.step = 'enter_description';

            bot.sendMessage(chatId,
                `🏆 Название: "${text}"\n\n` +
                '📝 Теперь напиши ОПИСАНИЕ достижения:\n' +
                '💡 Расскажи подробнее о своем успехе\n' +
                '⚡ Или напиши "без описания"').catch(console.error);

        } else if (achievementData.step === 'enter_description') {
            achievementData.description = text === 'без описания' ? null : text;
            achievementData.step = 'add_photo';

            bot.sendMessage(chatId,
                `🏆 Название: "${achievementData.title}"\n` +
                `📝 Описание: ${achievementData.description || 'Без описания'}\n\n` +
                '📸 Хочешь добавить фото к достижению?\n' +
                '💡 Загрузи фото или напиши "без фото"', {
                    reply_markup: {
                        keyboard: [
                            ['📸 Загрузить фото', '📋 Без фото'],
                            ['🔙 Назад в меню']
                        ],
                        resize_keyboard: true
                    }
                }).catch(console.error);

        } else if (achievementData.step === 'add_photo') {
            if (text === '📋 Без фото' || text === 'без фото') {
                // Публикуем без фото
                achievementData.photoFileId = null;
                achievementData.step = 'confirm_achievement';

                bot.sendMessage(chatId,
                    '📋 Готово без фото! ✅\n\n' +
                    `🏆 Название: ${achievementData.title}\n` +
                    `📝 Описание: ${achievementData.description || 'Без описания'}\n\n` +
                    '✅ Все готово! Опубликовать достижение?\n' +
                    '📢 Оно будет отправлено всем пользователям!', {
                        reply_markup: {
                            keyboard: [
                                ['✅ Опубликовать', '❌ Отменить'],
                                ['🔙 Назад в меню']
                            ],
                            resize_keyboard: true
                        }
                    }).catch(console.error);
            } else if (text === '📸 Загрузить фото') {
                bot.sendMessage(chatId,
                    '📸 Отправь фото своего достижения! 📷\n\n' +
                    '💡 Просто загрузи картинку в чат').catch(console.error);
            }
        }
    } catch (error) {
        console.error('❌ Handle achievement creation error:', error);
    }
}

function publishAchievement(chatId, telegramId) {
    try {
        const achievementData = global.userScreenshots[telegramId];

        if (!achievementData || achievementData.type !== 'achievement_creation') {
            return;
        }

        // Получаем информацию о пользователе
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) {
                bot.sendMessage(chatId, '❌ Ошибка! Пользователь не найден.').catch(console.error);
                return;
            }

            // Сохраняем достижение в базе
            db.run(`INSERT INTO achievements (user_id, title, description, photo_file_id)
                    VALUES (?, ?, ?, ?)`,
                   [user.id, achievementData.title, achievementData.description, achievementData.photoFileId],
                   function(err) {

                if (err) {
                    console.error('❌ Achievement save error:', err);
                    bot.sendMessage(chatId, '❌ Ошибка сохранения достижения!').catch(console.error);
                    return;
                }

                const achievementId = this.lastID;

                // Уведомляем создателя
                bot.sendMessage(chatId,
                    '🎉 Достижение опубликовано! 🏆\n\n' +
                    '📢 Все пользователи получили уведомление\n' +
                    '👍 Ждем лайков и комментариев!', mainMenuKeyboard).catch(console.error);

                // Отправляем всем пользователям
                broadcastAchievement(achievementId, user, achievementData);

                delete global.userScreenshots[telegramId];
            });
        });
    } catch (error) {
        console.error('❌ Publish achievement error:', error);
    }
}

function broadcastAchievement(achievementId, author, achievementData) {
    try {
        // Получаем всех пользователей
        db.all("SELECT * FROM users WHERE is_registered = 1 AND telegram_id != ?",
               [author.telegram_id], (err, users) => {

            if (err || !users) {
                console.error('❌ Get users for broadcast error:', err);
                return;
            }

            const authorName = getUserDisplayName(author);
            const achievementText = `🎉 ДОСТИЖЕНИЕ КОЛЛЕГИ! 🏆\n\n` +
                                  `👤 ${authorName}\n` +
                                  `🏆 ${achievementData.title}\n` +
                                  (achievementData.description ? `📝 ${achievementData.description}\n\n` : '\n') +
                                  '🔥 Поздравим коллегу с успехом!';

            const keyboard = {
                inline_keyboard: [[
                    { text: '👍 Лайк', callback_data: `like_achievement_${achievementId}` },
                    { text: '💬 Комментировать', callback_data: `comment_achievement_${achievementId}` }
                ]]
            };

            // Отправляем всем пользователям
            users.forEach(user => {
                if (achievementData.photoFileId) {
                    // Отправляем с фото
                    bot.sendPhoto(user.telegram_id, achievementData.photoFileId, {
                        caption: achievementText,
                        reply_markup: keyboard
                    }).catch(console.error);
                } else {
                    // Отправляем только текст
                    bot.sendMessage(user.telegram_id, achievementText, { reply_markup: keyboard }).catch(console.error);
                }
            });

            console.log(`📢 Достижение разослано ${users.length} пользователям`);
        });
    } catch (error) {
        console.error('❌ Broadcast achievement error:', error);
    }
}

function broadcastWelcomeMessage(senderTelegramId, senderUsername, message) {
    db.get("SELECT * FROM users WHERE telegram_id = ?", [senderTelegramId], (err, sender) => {
        if (err) {
            console.error('Error getting sender name for welcome message:', err);
            return;
        }
        const senderName = getUserDisplayName(sender);

        db.all("SELECT telegram_id FROM users WHERE is_registered = 1 AND telegram_id != ?", [senderTelegramId], (err, users) => {
            if (err) {
                console.error('Error getting users for welcome message broadcast:', err);
                return;
            }

            const welcomeText = `🎉 Давайте поприветствуем нового члена команды! 🥳\n\n` +
                                `**${senderName}** передает вам:\n\n` +
                                `_"${message}"_`;

            users.forEach(user => {
                bot.sendMessage(user.telegram_id, welcomeText, { parse_mode: 'Markdown' }).catch(err => {
                    console.error(`Failed to send welcome message to ${user.telegram_id}:`, err);
                });
            });
        });
    });
}

function notifyAdminsOfGraduation(userTelegramId, username) {
    db.get("SELECT * FROM users WHERE telegram_id = ?", [userTelegramId], (err, user) => {
        if (err) {
            console.error('Error getting user name for admin notification:', err);
            return;
        }
        const userName = getUserDisplayName(user);

        db.all("SELECT telegram_id FROM admins", (err, admins) => {
            if (err) {
                console.error('Error getting admins for graduation notification:', err);
                return;
            }

            const notificationText = `🎓 Стажер **${userName}** (@${username}) прошел стажировку и стал членом нашей компании!`;

            admins.forEach(admin => {
                bot.sendMessage(admin.telegram_id, notificationText, { parse_mode: 'Markdown' }).catch(err => {
                    console.error(`Failed to send graduation notification to admin ${admin.telegram_id}:`, err);
                });
            });
        });
    });
}

function notifyAdminsOfVacationRequest(requestId, user, request) {
    db.all("SELECT telegram_id FROM admins", (err, admins) => {
        if (err) {
            console.error('Error getting admins for vacation notification:', err);
            return;
        }

        const userName = getUserDisplayName(user);
        const notificationText = `🏖️ Новая заявка на отпуск от **${userName}**!\n\n` +
                               `**Период:** ${request.start_date} - ${request.end_date} (${request.days_count} дн.)\n` +
                               `**Тип:** ${request.vacation_type}\n` +
                               (request.reason ? `**Причина:** ${request.reason}\n\n` : '\n') +
                               `Что будем делать?`;

        const keyboard = {
            inline_keyboard: [[
                { text: '✅ Одобрить', callback_data: `vac_approve_${requestId}` },
                { text: '❌ Отклонить', callback_data: `vac_reject_${requestId}` }
            ]]
        };

        admins.forEach(admin => {
            bot.sendMessage(admin.telegram_id, notificationText, { 
                parse_mode: 'Markdown',
                reply_markup: keyboard 
            }).catch(err => {
                console.error(`Failed to send vacation notification to admin ${admin.telegram_id}:`, err);
            });
        });
    });
}

function notifyAdminsOfInternCompletion(user) {
    db.all("SELECT telegram_id FROM admins", (err, admins) => {
        if (err) {
            console.error('Error getting admins for intern completion notification:', err);
            return;
        }

        const userName = getUserDisplayName(user);
        const notificationText = `🎓 Стажер **${userName}** (@${user.username}) прошел все тесты и ожидает проверки!`;

        const keyboard = {
            inline_keyboard: [[{
                text: 'Перейти к просмотру результатов',
                callback_data: 'show_test_submissions'
            }]]
        };

        admins.forEach(admin => {
            bot.sendMessage(admin.telegram_id, notificationText, { 
                parse_mode: 'Markdown',
                reply_markup: keyboard 
            }).catch(err => {
                console.error(`Failed to send intern completion notification to admin ${admin.telegram_id}:`, err);
            });
        });
    });
}

function notifyAdminsOfBugReport(user, description, reportId) {
    db.all("SELECT telegram_id FROM admins", (err, admins) => {
        if (err) {
            console.error('Error getting admins for bug report notification:', err);
            return;
        }

        const userName = getUserDisplayName(user);
        const notificationText = `🐞 Новый отчет о баге от **${userName}**!\n\n` +
                               `**Описание:** ${description}`;

        const keyboard = {
            inline_keyboard: [[{
                text: 'Посмотреть отчеты',
                callback_data: 'show_bug_reports'
            }]]
        };

        admins.forEach(admin => {
            bot.sendMessage(admin.telegram_id, notificationText, { 
                parse_mode: 'Markdown',
                reply_markup: keyboard 
            }).catch(err => {
                console.error(`Failed to send bug report notification to admin ${admin.telegram_id}:`, err);
            });
        });
    });
}

function showAchievementsAdmin(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Доступ запрещен!').catch(console.error);
                return;
            }

            db.all(`SELECT a.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at,
                    (SELECT COUNT(*) FROM achievement_likes al WHERE al.achievement_id = a.id) as likes_count,
                    (SELECT COUNT(*) FROM achievement_comments ac WHERE ac.achievement_id = a.id) as comments_count
                    FROM achievements a
                    LEFT JOIN users u ON a.user_id = u.id
                    ORDER BY a.created_date DESC
                    LIMIT 10`, (err, achievements) => {

                if (!achievements || achievements.length === 0) {
                    bot.sendMessage(chatId,
                        '🎉 ДОСТИЖЕНИЯ СОТРУДНИКОВ 🏆\n\n' +
                        '📋 Пока нет достижений\n\n' +
                        '🎯 Ждем первых успехов команды!').catch(console.error);
                    return;
                }

                let achievementsText = '🎉 ПОСЛЕДНИЕ ДОСТИЖЕНИЯ 🏆\n\n';

                achievements.forEach((achievement, index) => {
                    const userName = getUserDisplayName(achievement);
                    const date = new Date(achievement.created_date).toLocaleDateString('ru-RU');

                    achievementsText += `${index + 1}. ${achievement.title}\n`;
                    achievementsText += `   👤 ${userName}\n`;
                    achievementsText += `   📅 ${date}\n`;
                    achievementsText += `   👍 ${achievement.likes_count} лайков\n`;
                    achievementsText += `   💬 ${achievement.comments_count} комментариев\n\n`;
                });

                bot.sendMessage(chatId, achievementsText, adminKeyboard).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show achievements admin error:', error);
    }
}

// ========== ФУНКЦИИ ЛАЙКОВ И КОММЕНТАРИЕВ ==========

function handleLikeAchievement(chatId, telegramId, achievementId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) {
                bot.sendMessage(chatId, '❌ Пользователь не найден!').catch(console.error);
                return;
            }

            // Проверяем, есть ли уже лайк от этого пользователя
            db.get("SELECT id FROM achievement_likes WHERE achievement_id = ? AND user_id = ?",
                   [achievementId, user.id], (err, existingLike) => {

                if (existingLike) {
                    bot.sendMessage(chatId, '👍 Ты уже поставил лайк этому достижению!').catch(console.error);
                    return;
                }

                // Добавляем лайк
                db.run("INSERT INTO achievement_likes (achievement_id, user_id) VALUES (?, ?)",
                       [achievementId, user.id], (err) => {

                    if (err) {
                        console.error('❌ Like achievement error:', err);
                        bot.sendMessage(chatId, '❌ Ошибка при добавлении лайка!').catch(console.error);
                        return;
                    }

                    // Получаем информацию о достижении для уведомления
                    db.get(`SELECT a.*, u.full_name, u.username, u.telegram_id as author_telegram_id
                            FROM achievements a
                            LEFT JOIN users u ON a.user_id = u.id
                            WHERE a.id = ?`, [achievementId], (err, achievement) => {

                        if (achievement && achievement.author_telegram_id !== telegramId) {
                            // Уведомляем автора достижения
                            const likerName = getUserDisplayName(user);
                            bot.sendMessage(achievement.author_telegram_id,
                                `👍 Новый лайк! 🎉\n\n` +
                                `👤 ${likerName} поставил лайк твоему достижению:\n` +
                                `🏆 "${achievement.title}"\n\n` +
                                '🔥 Так держать!').catch(console.error);
                        }
                    });

                    bot.sendMessage(chatId, '👍 Лайк поставлен! 🎉').catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Handle like achievement error:', error);
    }
}

function startCommentAchievement(chatId, telegramId, achievementId) {
    try {
        db.get("SELECT * FROM achievements WHERE id = ?", [achievementId], (err, achievement) => {
            if (!achievement) {
                bot.sendMessage(chatId, '❌ Достижение не найдено!').catch(console.error);
                return;
            }

            global.userScreenshots[telegramId] = {
                type: 'achievement_comment',
                achievementId: achievementId,
                step: 'enter_comment'
            };

            bot.sendMessage(chatId,
                `💬 КОММЕНТАРИЙ К ДОСТИЖЕНИЮ\n\n` +
                `🏆 "${achievement.title}"\n\n` +
                '📝 Напиши свой комментарий:').catch(console.error);
        });
    } catch (error) {
        console.error('❌ Start comment achievement error:', error);
    }
}

function handleAchievementComment(chatId, telegramId, text) {
    try {
        const commentData = global.userScreenshots[telegramId];

        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (!user) {
                bot.sendMessage(chatId, '❌ Пользователь не найден!').catch(console.error);
                return;
            }

            // Добавляем комментарий
            db.run("INSERT INTO achievement_comments (achievement_id, user_id, comment) VALUES (?, ?, ?)",
                   [commentData.achievementId, user.id, text], (err) => {

                if (err) {
                    console.error('❌ Comment achievement error:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при добавлении комментария!').catch(console.error);
                    return;
                }

                // Получаем информацию о достижении для уведомления
                db.get(`SELECT a.*, u.full_name, u.username, u.telegram_id as author_telegram_id
                        FROM achievements a
                        LEFT JOIN users u ON a.user_id = u.id
                        WHERE a.id = ?`, [commentData.achievementId], (err, achievement) => {

                    if (achievement && achievement.author_telegram_id !== telegramId) {
                        // Уведомляем автора достижения
                        const commenterName = getUserDisplayName(user);
                        bot.sendMessage(achievement.author_telegram_id,
                            `💬 Новый комментарий! 📝\n\n` +
                            `👤 ${commenterName} прокомментировал твое достижение:\n` +
                            `🏆 "${achievement.title}"\n\n` +
                            `💬 "${text}"\n\n` +
                            '🎉 Поздравляем!').catch(console.error);
                    }
                });

                bot.sendMessage(chatId, '💬 Комментарий добавлен! 🎉', mainMenuKeyboard).catch(console.error);
                delete global.userScreenshots[telegramId];
            });
        });
    } catch (error) {
        console.error('❌ Handle achievement comment error:', error);
    }
}

// ========== ФУНКЦИИ УПРАВЛЕНИЯ БАЛАНСОМ ==========

function showBalances(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            db.all("SELECT username, full_name, p_coins, role, position, position_level, registration_date, graduated_at FROM users WHERE is_registered = 1 ORDER BY p_coins DESC",
                   (err, users) => {

                if (!users || users.length === 0) {
                    bot.sendMessage(chatId, '👻 Нет пользователей!').catch(console.error);
                    return;
                }

                let balancesText = '📊 БАЛАНСЫ ПОЛЬЗОВАТЕЛЕЙ 💰\n\n';
                const medals = ['🥇', '🥈', '🥉'];

                users.forEach((user, index) => {
                    const name = getUserDisplayName(user);
                    const medal = index < 3 ? medals[index] : `${index + 1}.`;
                    balancesText += `${medal} ${name} - ${user.p_coins} П-коинов\n`;
                });

                balancesText += '\n💰 Общий баланс команды отличный!';

                bot.sendMessage(chatId, balancesText, balanceKeyboard).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show balances error:', error);
    }
}

function startAddCoins(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            db.all("SELECT id, username, full_name, telegram_id, role, position, position_level, registration_date, graduated_at FROM users WHERE is_registered = 1 ORDER BY full_name", (err, users) => {
                if (!users || users.length === 0) {
                    bot.sendMessage(chatId, '👻 Нет пользователей для начисления!').catch(console.error);
                    return;
                }

                global.userScreenshots[telegramId] = {
                    type: 'balance_add',
                    step: 'select_user',
                    users: users,
                    failed_attempts: 0
                };

                let usersList = '➕ НАЧИСЛИТЬ БАЛЛЫ 💰\n\n';
                usersList += 'Выбери пользователя:\n\n';

                users.forEach((user, index) => {
                    const name = getUserDisplayName(user);
                    usersList += `${index + 1}. ${name} (@${user.username})\n`;
                });

                usersList += '\n🔢 Напиши номер пользователя:';

                bot.sendMessage(chatId, usersList).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Start add coins error:', error);
    }
}

function startDeductCoins(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            db.all("SELECT id, username, full_name, telegram_id, role, position, position_level, registration_date, graduated_at FROM users WHERE is_registered = 1 ORDER BY full_name", (err, users) => {
                if (!users || users.length === 0) {
                    bot.sendMessage(chatId, '👻 Нет пользователей для списания!').catch(console.error);
                    return;
                }

                global.userScreenshots[telegramId] = {
                    type: 'balance_deduct',
                    step: 'select_user',
                    users: users,
                    failed_attempts: 0
                };

                let usersList = '➖ СПИСАТЬ БАЛЛЫ 💸\n\n';
                usersList += 'Выбери пользователя:\n\n';

                users.forEach((user, index) => {
                    const name = getUserDisplayName(user);
                    usersList += `${index + 1}. ${name} (@${user.username})\n`;
                });

                usersList += '\n🔢 Напиши номер пользователя:';

                bot.sendMessage(chatId, usersList).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Start deduct coins error:', error);
    }
}

function handleBalanceAdd(chatId, telegramId, text) {
    // [DEBUG LOG] Balance add entry
    const addState = global.userScreenshots[telegramId];
    console.log(`[BALANCE ADD DEBUG] User ${telegramId} text "${text}" | Step: ${addState ? addState.step : 'none'}`);
    
    try {
        const addData = global.userScreenshots[telegramId];

        if (addData.step === 'select_user') {
            const userIndex = parseInt(text) - 1;

            if (isNaN(userIndex) || userIndex < 0 || userIndex >= addData.users.length) {
                // [DEBUG LOG] Invalid user in balance add
                console.log(`[BALANCE ADD DEBUG] Invalid user index "${text}" for user ${telegramId}, users length: ${addData.users.length}`);
                bot.sendMessage(chatId, '❌ Неверный номер пользователя! Попробуй еще раз 🔢').catch(console.error);
                return;
            }

            addData.selectedUser = addData.users[userIndex];
            addData.step = 'enter_amount';

            bot.sendMessage(chatId,
                `➕ Начислить баллы пользователю: ${getUserDisplayName(addData.selectedUser)}\n\n` +
                '💰 Сколько баллов начислить?\n' +
                '🔢 Напиши положительное число:').catch(console.error);

        } else if (addData.step === 'enter_amount') {
            const amount = parseInt(text);

            if (isNaN(amount) || amount <= 0) {
                bot.sendMessage(chatId, '❌ Сумма должна быть положительным числом! 💰').catch(console.error);
                return;
            }

            // Получаем имя админа
            db.get("SELECT full_name, username FROM users WHERE telegram_id = ?", [telegramId], (err, adminUser) => {
                const adminName = adminUser ? (adminUser.full_name || adminUser.username || 'Админ') : 'Админ';

                // Начисляем баллы
                db.run("UPDATE users SET p_coins = p_coins + ? WHERE id = ?", [amount, addData.selectedUser.id], () => {
                    // Уведомляем пользователя
                    bot.sendMessage(addData.selectedUser.telegram_id,
                        `💰 ${adminName} НАЧИСЛИЛ БАЛЛЫ! 🎉\n\n` +
                        `➕ +${amount} П-коинов\n\n` +
                        '🎯 Продолжай в том же духе!').catch(console.error);

                    // Уведомляем админа
                    bot.sendMessage(chatId,
                        `✅ БАЛЛЫ НАЧИСЛЕНЫ! 💰\n\n` +
                        `👤 ${getUserDisplayName(addData.selectedUser)}\n` +
                        `➕ +${amount} П-коинов\n\n` +
                        '🎉 Операция завершена!', balanceKeyboard).catch(console.error);

                    delete global.userScreenshots[telegramId];
                });
            });
        }
    } catch (error) {
        console.error('❌ Handle balance add error:', error);
    }
}

function handleBalanceDeduct(chatId, telegramId, text) {
    try {
        const deductData = global.userScreenshots[telegramId];

        if (deductData.step === 'select_user') {
            const userIndex = parseInt(text) - 1;

            if (isNaN(userIndex) || userIndex < 0 || userIndex >= deductData.users.length) {
                deductData.failed_attempts = (deductData.failed_attempts || 0) + 1;
                console.log(`[BALANCE DEDUCT DEBUG] Failed attempt ${deductData.failed_attempts} for user ${telegramId}, text: "${text}"`);
                if (deductData.failed_attempts >= 3) {
                    bot.sendMessage(chatId, '❌ Слишком много неверных попыток! Возвращаемся в меню.').catch(console.error);
                    delete global.userScreenshots[telegramId];
                    backToMainMenu(chatId, telegramId);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер пользователя! Попробуй еще раз 🔢').catch(console.error);
                return;
            }

            deductData.selectedUser = deductData.users[userIndex];
            deductData.step = 'enter_amount';

            bot.sendMessage(chatId,
                `➖ Списать баллы у пользователя: ${getUserDisplayName(deductData.selectedUser)}\n\n` +
                '💸 Сколько баллов списать?\n' +
                '🔢 Напиши положительное число:').catch(console.error);

        } else if (deductData.step === 'enter_amount') {
            const amount = parseInt(text);

            if (isNaN(amount) || amount <= 0) {
                bot.sendMessage(chatId, '❌ Сумма должна быть положительным числом! 💸').catch(console.error);
                return;
            }

            // Получаем имя админа
            db.get("SELECT full_name, username FROM users WHERE telegram_id = ?", [telegramId], (err, adminUser) => {
                const adminName = adminUser ? (adminUser.full_name || adminUser.username || 'Админ') : 'Админ';

                // Проверяем баланс пользователя
                db.get("SELECT p_coins FROM users WHERE id = ?", [deductData.selectedUser.id], (err, userData) => {
                    if (!userData || userData.p_coins < amount) {
                        bot.sendMessage(chatId, '❌ У пользователя недостаточно баллов! 😔').catch(console.error);
                        return;
                    }

                    // Списываем баллы
                    db.run("UPDATE users SET p_coins = p_coins - ? WHERE id = ?", [amount, deductData.selectedUser.id], () => {
                        // Уведомляем пользователя
                        bot.sendMessage(deductData.selectedUser.telegram_id,
                            `💸 ${adminName} СПИСАЛ БАЛЛЫ 😔\n\n` +
                            `➖ -${amount} П-коинов\n\n` +
                            '💪 Старайся лучше!').catch(console.error);

                        // Уведомляем админа
                        bot.sendMessage(chatId,
                            `✅ БАЛЛЫ СПИСАНЫ! 💸\n\n` +
                            `👤 ${getUserDisplayName(deductData.selectedUser)}\n` +
                            `➖ -${amount} П-коинов\n\n` +
                            '🎯 Операция завершена!', balanceKeyboard).catch(console.error);

                        delete global.userScreenshots[telegramId];
                    });
                });
            });
        }
    } catch (error) {
        console.error('❌ Handle balance deduct error:', error);
    }
}

process.on('SIGINT', () => {
    console.log('\n⏹️ Останавливаю бот...');
    console.log('💾 Закрываю базу данных...');
    db.close((err) => {
        if (err) {
            console.error('❌ Ошибка закрытия БД:', err.message);
        } else {
            console.log('✅ База данных закрыта успешно');
        }
        console.log('👋 Бот остановлен! До встречи!');
        process.exit(0);
    });
});

// ========== ФУНКЦИИ УПРАВЛЕНИЯ КОНТАКТАМИ ==========

function startContactSearch(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'contact_search',
        step: 'enter_company'
    };

    const contactSearchKeyboard = {
        reply_markup: {
            keyboard: [
                ['➕ Добавить контакт'],
                ['🔙 Назад в меню']
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId,
        '📇 ПОИСК КОНТАКТОВ КОМПАНИИ 🔍\n\n' +
        '💼 Введите название компании для поиска или добавьте новый контакт.', 
        contactSearchKeyboard).catch(console.error);
}

function handleContactSearch(chatId, telegramId, text) {
    try {
        const searchData = global.userScreenshots[telegramId];

        if (searchData.step === 'enter_company') {
            const companyName = text.trim();

            // Поиск контактов по названию компании (с частичным совпадением)
            db.all(`SELECT * FROM company_contacts WHERE company_name LIKE ? ORDER BY company_name, contact_name`,
                [`%${companyName}%`], (err, contacts) => {
                if (err) {
                    console.error('❌ Contact search error:', err);
                    bot.sendMessage(chatId, '❌ Ошибка поиска контактов!').catch(console.error);
                    return;
                }

                delete global.userScreenshots[telegramId];

                if (!contacts || contacts.length === 0) {
                    bot.sendMessage(chatId,
                        `📇 РЕЗУЛЬТАТЫ ПОИСКА 🔍\n\n` +
                        `🔎 Запрос: "${companyName}"\n\n` +
                        `❌ Контакты не найдены!\n\n` +
                        `💡 Попробуйте:\n` +
                        `• Изменить запрос\n` +
                        `• Использовать часть названия\n` +
                        `• Обратиться к админу для добавления`).catch(console.error);
                    return;
                }

                let contactsText = `📇 РЕЗУЛЬТАТЫ ПОИСКА 🔍\n\n`;
                contactsText += `🔎 Запрос: "${companyName}"\n`;
                contactsText += `📊 Найдено: ${contacts.length} контакт(ов)\n\n`;

                let currentCompany = '';
                contacts.forEach((contact, index) => {
                    if (contact.company_name !== currentCompany) {
                        currentCompany = contact.company_name;
                        contactsText += `🏢 ${contact.company_name}\n`;
                    }

                    contactsText += `   👤 ${contact.contact_name}`;
                    if (contact.position) contactsText += ` (${contact.position})`;
                    contactsText += `\n`;

                    if (contact.email) contactsText += `   ✉️ ${contact.email}\n`;
                    if (contact.phone) contactsText += `   📞 ${contact.phone}\n`;
                    if (contact.telegram) contactsText += `   💬 ${contact.telegram}\n`;
                    if (contact.notes) contactsText += `   📝 ${contact.notes}\n`;
                    contactsText += `\n`;
                });

                // Разбиваем на части если слишком длинное
                if (contactsText.length > 4000) {
                    const parts = [];
                    let currentPart = `📇 РЕЗУЛЬТАТЫ ПОИСКА 🔍\n\n🔎 Запрос: "${companyName}"\n📊 Найдено: ${contacts.length} контакт(ов)\n\n`;

                    contacts.forEach((contact) => {
                        let contactInfo = '';
                        if (contact.company_name !== currentCompany) {
                            currentCompany = contact.company_name;
                            contactInfo += `🏢 ${contact.company_name}\n`;
                        }
                        contactInfo += `   👤 ${contact.contact_name}`;
                        if (contact.position) contactInfo += ` (${contact.position})`;
                        contactInfo += `\n`;
                        if (contact.email) contactInfo += `   ✉️ ${contact.email}\n`;
                        if (contact.phone) contactInfo += `   📞 ${contact.phone}\n`;
                        if (contact.telegram) contactInfo += `   💬 ${contact.telegram}\n`;
                        if (contact.notes) contactInfo += `   📝 ${contact.notes}\n`;
                        contactInfo += `\n`;

                        if (currentPart.length + contactInfo.length > 4000) {
                            parts.push(currentPart);
                            currentPart = contactInfo;
                        } else {
                            currentPart += contactInfo;
                        }
                    });
                    if (currentPart) parts.push(currentPart);

                    parts.forEach((part, index) => {
                        setTimeout(() => {
                            bot.sendMessage(chatId, part + (index < parts.length - 1 ? '\n📄 Продолжение...' : '')).catch(console.error);
                        }, index * 1000);
                    });
                } else {
                    bot.sendMessage(chatId, contactsText).catch(console.error);
                }
            });
        }
    } catch (error) {
        console.error('❌ Handle contact search error:', error);
        delete global.userScreenshots[telegramId];
    }
}

function showContactsAdmin(chatId, telegramId) {
    const contactsKeyboard = {
        reply_markup: {
            keyboard: [
                ['➕ Добавить контакт', '📋 Все контакты'],
                ['📥 Импорт CSV'],
                ['🗑️ Удалить контакт', '✏️ Редактировать контакт'],
                ['🔙 Назад в админку']
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId,
        '📇 УПРАВЛЕНИЕ КОНТАКТАМИ 👥\n\n' +
        '➕ Добавить контакт - Добавить новый контакт компании\n' +
        '📋 Все контакты - Просмотр всех контактов\n' +
        '📥 Импорт CSV - Массовая загрузка контактов из файла\n' +
        '✏️ Редактировать контакт - Изменить данные\n' +
        '🗑️ Удалить контакт - Удалить контакт\n\n' +
        '👇 Выберите действие:', contactsKeyboard).catch(console.error);
}

function startCsvImport(chatId, telegramId) {
    db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
        if (!admin) return; // Silently ignore for non-admins

        global.userScreenshots[telegramId] = {
            type: 'import_contacts',
            step: 'awaiting_file'
        };

        const message = `**Импорт контактов из CSV**\n\n` +
                        `Пожалуйста, загрузите CSV-файл.\n` +
                        `Файл должен содержать следующие колонки в указанном порядке и без заголовка:\n` +
                        `1.  ` + '\`company_name\`' + ` (Название компании)\n` +
                        `2.  ` + '\`contact_name\`' + ` (Имя контакта)\n` +
                        `3.  ` + '\`position\`' + ` (Должность)\n` +
                        `4.  ` + '\`email\`' + `\n` +
                        `5.  ` + '\`phone\`' + ` (Телефон)\n` +
                        `6.  ` + '\`telegram\`' + `\n` +
                        `7.  ` + '\`notes\`' + ` (Заметки)\n\n` +
                        `Разделитель - запятая. Для пропуска значения оставьте поле пустым.`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });
}

function startAddContact(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'contact_creation',
        step: 'enter_company',
        data: {}
    };

    bot.sendMessage(chatId,
        '➕ ДОБАВЛЕНИЕ КОНТАКТА 👤\n\n' +
        '🏢 Шаг 1: Введите название компании:\n' +
        '💡 Например: "Google", "Microsoft", "ООО Рога и Копыта"').catch(console.error);
}

function handleContactCreation(chatId, telegramId, text) {
    try {
        const contactData = global.userScreenshots[telegramId];

        if (contactData.step === 'enter_company') {
            contactData.data.company_name = text.trim();
            contactData.step = 'enter_name';

            bot.sendMessage(chatId,
                `🏢 Компания: "${text}"\n\n` +
                '👤 Шаг 2: Введите имя контактного лица:\n' +
                '💡 Например: "Иван Петров", "John Smith"').catch(console.error);

        } else if (contactData.step === 'enter_name') {
            contactData.data.contact_name = text.trim();
            contactData.step = 'enter_position';

            bot.sendMessage(chatId,
                `👤 Имя: "${text}"\n\n` +
                '💼 Шаг 3: Введите должность (или "пропустить"):\n' +
                '💡 Например: "Менеджер по продажам", "CEO", "Директор"').catch(console.error);

        } else if (contactData.step === 'enter_position') {
            if (text.toLowerCase() !== 'пропустить') {
                contactData.data.position = text.trim();
            }
            contactData.step = 'enter_email';

            bot.sendMessage(chatId,
                `💼 Должность: "${text === 'пропустить' ? 'Не указана' : text}"\n\n` +
                '✉️ Шаг 4: Введите email (или "пропустить"):\n' +
                '💡 Например: "ivan@company.com"').catch(console.error);

        } else if (contactData.step === 'enter_email') {
            if (text.toLowerCase() !== 'пропустить') {
                contactData.data.email = text.trim();
            }
            contactData.step = 'enter_phone';

            bot.sendMessage(chatId,
                `✉️ Email: "${text === 'пропустить' ? 'Не указан' : text}"\n\n` +
                '📞 Шаг 5: Введите телефон (или "пропустить"):\n' +
                '💡 Например: "+7 999 123-45-67"').catch(console.error);

        } else if (contactData.step === 'enter_phone') {
            if (text.toLowerCase() !== 'пропустить') {
                contactData.data.phone = text.trim();
            }
            contactData.step = 'enter_telegram';

            bot.sendMessage(chatId,
                `📞 Телефон: "${text === 'пропустить' ? 'Не указан' : text}"\n\n` +
                '💬 Шаг 6: Введите Telegram (или "пропустить"):\n' +
                '💡 Например: "@username" или ссылку').catch(console.error);

        } else if (contactData.step === 'enter_telegram') {
            if (text.toLowerCase() !== 'пропустить') {
                contactData.data.telegram = text.trim();
            }
            contactData.step = 'enter_notes';

            bot.sendMessage(chatId,
                `💬 Telegram: "${text === 'пропустить' ? 'Не указан' : text}"\n\n` +
                '📝 Шаг 7: Введите заметки (или "пропустить"):\n' +
                '💡 Например: "Ответственный за закупки", "Доступен по вторникам"').catch(console.error);

        } else if (contactData.step === 'enter_notes') {
            if (text.toLowerCase() !== 'пропустить') {
                contactData.data.notes = text.trim();
            }

            // Сохранение контакта
            db.get("SELECT id FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
                if (err || !user) {
                    bot.sendMessage(chatId, '❌ Ошибка пользователя!').catch(console.error);
                    return;
                }

                const { company_name, contact_name, position, email, phone, telegram, notes } = contactData.data;

                db.run(`INSERT INTO company_contacts (company_name, contact_name, position, email, phone, telegram, notes, added_by)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [company_name, contact_name, position || null, email || null, phone || null, telegram || null, notes || null, user.id],
                    function(err) {
                        if (err) {
                            console.error('❌ Contact creation error:', err);
                            bot.sendMessage(chatId, '❌ Ошибка сохранения контакта!').catch(console.error);
                            return;
                        }

                        delete global.userScreenshots[telegramId];

                        let summaryText = '✅ КОНТАКТ УСПЕШНО ДОБАВЛЕН! 🎉\n\n';
                        summaryText += `🏢 Компания: ${company_name}\n`;
                        summaryText += `👤 Имя: ${contact_name}\n`;
                        if (position) summaryText += `💼 Должность: ${position}\n`;
                        if (email) summaryText += `✉️ Email: ${email}\n`;
                        if (phone) summaryText += `📞 Телефон: ${phone}\n`;
                        if (telegram) summaryText += `💬 Telegram: ${telegram}\n`;
                        if (notes) summaryText += `📝 Заметки: ${notes}\n`;

                        bot.sendMessage(chatId, summaryText).catch(console.error);
                    });
            });
        }
    } catch (error) {
        console.error('❌ Handle contact creation error:', error);
        delete global.userScreenshots[telegramId];
    }
}

function showAllContacts(chatId, telegramId) {
    try {
        db.all(`SELECT cc.*, u.role as added_by_role, u.telegram_id as added_by_telegram
                FROM company_contacts cc
                LEFT JOIN users u ON cc.added_by = u.id
                ORDER BY cc.company_name, cc.contact_name`, (err, contacts) => {
            if (err) {
                console.error('❌ Show all contacts error:', err);
                bot.sendMessage(chatId, '❌ Ошибка загрузки контактов!').catch(console.error);
                return;
            }

            if (!contacts || contacts.length === 0) {
                bot.sendMessage(chatId,
                    '📇 БАЗА КОНТАКТОВ 📋\n\n' +
                    '❌ Контакты отсутствуют!\n\n' +
                    '💡 Используйте "➕ Добавить контакт" для создания первого контакта.').catch(console.error);
                return;
            }

            let contactsText = `📇 БАЗА КОНТАКТОВ 📋\n\n`;
            contactsText += `📊 Всего контактов: ${contacts.length}\n\n`;

            let currentCompany = '';
            contacts.forEach((contact, index) => {
                if (contact.company_name !== currentCompany) {
                    currentCompany = contact.company_name;
                    contactsText += `🏢 ${contact.company_name}\n`;
                }

                contactsText += `   👤 ${contact.contact_name}`;
                if (contact.position) contactsText += ` (${contact.position})`;
                contactsText += `\n`;

                if (contact.email) contactsText += `   ✉️ ${contact.email}\n`;
                if (contact.phone) contactsText += `   📞 ${contact.phone}\n`;
                if (contact.telegram) contactsText += `   💬 ${contact.telegram}\n`;
                if (contact.notes) contactsText += `   📝 ${contact.notes}\n`;

                // Показываем кто добавил
                contactsText += `   👨‍💼 Добавил: ${contact.added_by_role || 'Unknown'}\n`;
                contactsText += `   📅 ${new Date(contact.created_date).toLocaleDateString()}\n\n`;
            });

            // Разбиваем на части если слишком длинное
            if (contactsText.length > 4000) {
                const parts = [];
                let currentPart = `📇 БАЗА КОНТАКТОВ 📋\n\n📊 Всего контактов: ${contacts.length}\n\n`;

                contacts.forEach((contact) => {
                    let contactInfo = '';
                    if (contact.company_name !== currentCompany) {
                        currentCompany = contact.company_name;
                        contactInfo += `🏢 ${contact.company_name}\n`;
                    }
                    contactInfo += `   👤 ${contact.contact_name}`;
                    if (contact.position) contactInfo += ` (${contact.position})`;
                    contactInfo += `\n`;
                    if (contact.email) contactInfo += `   ✉️ ${contact.email}\n`;
                    if (contact.phone) contactInfo += `   📞 ${contact.phone}\n`;
                    if (contact.telegram) contactInfo += `   💬 ${contact.telegram}\n`;
                    if (contact.notes) contactInfo += `   📝 ${contact.notes}\n`;
                    contactInfo += `   👨‍💼 Добавил: ${contact.added_by_role || 'Unknown'}\n`;
                    contactInfo += `   📅 ${new Date(contact.created_date).toLocaleDateString()}\n\n`;

                    if (currentPart.length + contactInfo.length > 4000) {
                        parts.push(currentPart);
                        currentPart = contactInfo;
                    } else {
                        currentPart += contactInfo;
                    }
                });
                if (currentPart) parts.push(currentPart);

                parts.forEach((part, index) => {
                    setTimeout(() => {
                        bot.sendMessage(chatId, part + (index < parts.length - 1 ? '\n📄 Продолжение...' : '')).catch(console.error);
                    }, index * 1000);
                });
            } else {
                bot.sendMessage(chatId, contactsText).catch(console.error);
            }
        });
    } catch (error) {
        console.error('❌ Show all contacts error:', error);
    }
}

// Вспомогательные функции валидации
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function isValidPhone(phone) {
    const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
    return phoneRegex.test(phone);
}

function startEditContact(chatId, telegramId) {
    try {
        // Сброс предыдущего состояния
        if (global.userScreenshots[telegramId]) {
            delete global.userScreenshots[telegramId];
        }
        
        // Проверка прав администратора
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (err || !admin) {
                console.log(`[SECURITY] Unauthorized access attempt to edit contacts by user ${telegramId}`);
                bot.sendMessage(chatId, '❌ У вас нет прав для выполнения этой операции.').catch(console.error);
                return;
            }
            
            db.all(`SELECT cc.*, u.role as added_by_role
                    FROM company_contacts cc
                    LEFT JOIN users u ON cc.added_by = u.id
                    ORDER BY cc.company_name, cc.contact_name`, (err, contacts) => {
            if (err) {
                console.error('Error fetching contacts for editing:', err);
                bot.sendMessage(chatId, '❌ Ошибка при получении списка контактов!').catch(console.error);
                return;
            }

            if (!contacts || contacts.length === 0) {
                bot.sendMessage(chatId,
                    '📭 В базе данных нет контактов для редактирования.\n\n' +
                    'Сначала добавьте контакт через "➕ Добавить контакт"').catch(console.error);
                return;
            }

            // Store contacts for selection
            global.userScreenshots[telegramId] = {
                type: 'contact_editing',
                step: 'select_contact',
                contacts: contacts,
                data: {}
            };

            let contactsText = '🔍 Выберите контакт для редактирования:\n\n';
            
            let currentCompany = '';
            contacts.forEach((contact, index) => {
                if (contact.company_name !== currentCompany) {
                    currentCompany = contact.company_name;
                    contactsText += `🏢 ${contact.company_name}\n`;
                }

                contactsText += `${index + 1}. ${contact.contact_name}`;
                if (contact.position) contactsText += ` (${contact.position})`;
                contactsText += '\n';
            });

            contactsText += '\n💡 Введите номер контакта для редактирования (1-' + contacts.length + ') или "отмена" для выхода:';

            bot.sendMessage(chatId, contactsText).catch(console.error);
            
            // Логирование операции
            console.log(`[CONTACT EDIT] Admin ${telegramId} started contact editing process`);
            });
        });
    } catch (error) {
        console.error('Error in startEditContact:', error);
    }
}

function startDeleteContact(chatId, telegramId) {
    try {
        // Сброс предыдущего состояния
        if (global.userScreenshots[telegramId]) {
            delete global.userScreenshots[telegramId];
        }
        
        // Проверка прав администратора
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (err || !admin) {
                console.log(`[SECURITY] Unauthorized access attempt to delete contacts by user ${telegramId}`);
                bot.sendMessage(chatId, '❌ У вас нет прав для выполнения этой операции.').catch(console.error);
                return;
            }
            
            db.all(`SELECT cc.*, u.role as added_by_role
                    FROM company_contacts cc
                    LEFT JOIN users u ON cc.added_by = u.id
                    ORDER BY cc.company_name, cc.contact_name`, (err, contacts) => {
            if (err) {
                console.error('Error fetching contacts for deletion:', err);
                bot.sendMessage(chatId, '❌ Ошибка при получении списка контактов!').catch(console.error);
                return;
            }

            if (!contacts || contacts.length === 0) {
                bot.sendMessage(chatId,
                    '📭 В базе данных нет контактов для удаления.\n\n' +
                    'Сначала добавьте контакт через "➕ Добавить контакт"').catch(console.error);
                return;
            }

            // Store contacts for selection
            global.userScreenshots[telegramId] = {
                type: 'contact_deletion',
                step: 'select_contact',
                contacts: contacts,
                data: {}
            };

            let contactsText = '🗑️ Выберите контакт для удаления:\n\n';
            
            let currentCompany = '';
            contacts.forEach((contact, index) => {
                if (contact.company_name !== currentCompany) {
                    currentCompany = contact.company_name;
                    contactsText += `🏢 ${contact.company_name}\n`;
                }

                contactsText += `${index + 1}. ${contact.contact_name}`;
                if (contact.position) contactsText += ` (${contact.position})`;
                contactsText += '\n';
            });

            contactsText += '\n⚠️ Введите номер контакта для удаления (1-' + contacts.length + ') или "отмена" для выхода:';

            bot.sendMessage(chatId, contactsText).catch(console.error);
            
            // Логирование операции
            console.log(`[CONTACT DELETE] Admin ${telegramId} started contact deletion process`);
            });
        });
    } catch (error) {
        console.error('Error in startDeleteContact:', error);
    }
}

function handleContactEditing(chatId, telegramId, text) {
    try {
        const contactData = global.userScreenshots[telegramId];
        
        if (contactData.step === 'select_contact') {
            const contactIndex = parseInt(text.trim()) - 1;
            
            if (isNaN(contactIndex) || contactIndex < 0 || contactIndex >= contactData.contacts.length) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Операция отменена').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер контакта. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const selectedContact = contactData.contacts[contactIndex];
            contactData.selectedContact = selectedContact;
            contactData.step = 'select_field';
            
            let contactInfo = `📝 Редактирование контакта:\n\n`;
            contactInfo += `🏢 Компания: ${selectedContact.company_name}\n`;
            contactInfo += `👤 Имя: ${selectedContact.contact_name}\n`;
            if (selectedContact.position) contactInfo += `💼 Должность: ${selectedContact.position}\n`;
            if (selectedContact.email) contactInfo += `✉️ Email: ${selectedContact.email}\n`;
            if (selectedContact.phone) contactInfo += `📞 Телефон: ${selectedContact.phone}\n`;
            if (selectedContact.telegram) contactInfo += `💬 Telegram: ${selectedContact.telegram}\n`;
            if (selectedContact.notes) contactInfo += `📝 Заметки: ${selectedContact.notes}\n`;
            
            contactInfo += `\nВыберите поле для редактирования:\n`;
            contactInfo += `1. 🏢 Компания\n`;
            contactInfo += `2. 👤 Имя контакта\n`;
            contactInfo += `3. 💼 Должность\n`;
            contactInfo += `4. ✉️ Email\n`;
            contactInfo += `5. 📞 Телефон\n`;
            contactInfo += `6. 💬 Telegram\n`;
            contactInfo += `7. 📝 Заметки\n`;
            contactInfo += `\nВведите номер поля (1-7) или "отмена" для выхода:`;
            
            bot.sendMessage(chatId, contactInfo).catch(console.error);
            
        } else if (contactData.step === 'select_field') {
            const fieldIndex = parseInt(text.trim());
            
            if (isNaN(fieldIndex) || fieldIndex < 1 || fieldIndex > 7) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Операция отменена').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер поля. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const fieldNames = {
                1: 'компанию',
                2: 'имя контакта',
                3: 'должность',
                4: 'email',
                5: 'телефон',
                6: 'telegram',
                7: 'заметки'
            };
            
            const fieldKeys = {
                1: 'company_name',
                2: 'contact_name',
                3: 'position',
                4: 'email',
                5: 'phone',
                6: 'telegram',
                7: 'notes'
            };
            
            contactData.selectedField = fieldKeys[fieldIndex];
            contactData.step = 'enter_value';
            
            const currentValue = contactData.selectedContact[contactData.selectedField];
            bot.sendMessage(chatId,
                `✏️ Редактирование поля "${fieldNames[fieldIndex]}"\n\n` +
                `Текущее значение: ${currentValue || '(не указано)'}\n\n` +
                `Введите новое значение или "отмена" для выхода:`
            ).catch(console.error);
            
        } else if (contactData.step === 'enter_value') {
            if (text.toLowerCase() === 'отмена') {
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Операция отменена').catch(console.error);
                return;
            }
            
            const newValue = text.trim();
            const contactId = contactData.selectedContact.id;
            const field = contactData.selectedField;
            
            // Валидация данных
            if (field === 'email' && newValue && !isValidEmail(newValue)) {
                bot.sendMessage(chatId, '❌ Введен некорректный email. Пожалуйста, попробуйте еще раз:').catch(console.error);
                return;
            }
            
            if (field === 'phone' && newValue && !isValidPhone(newValue)) {
                bot.sendMessage(chatId, '❌ Введен некорректный номер телефона. Пожалуйста, попробуйте еще раз:').catch(console.error);
                return;
            }
            
            // Проверка безопасности поля
            const allowedFields = ['company_name', 'contact_name', 'position', 'email', 'phone', 'telegram', 'notes'];
            if (!allowedFields.includes(field)) {
                console.error(`[SECURITY] Attempt to update forbidden field: ${field} by admin ${telegramId}`);
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Попытка обновления запрещенного поля!').catch(console.error);
                return;
            }
            
            db.run(`UPDATE company_contacts SET ${field} = ? WHERE id = ?`, [newValue, contactId], function(err) {
                if (err) {
                    console.error('Error updating contact:', err);
                    bot.sendMessage(chatId, '❌ Ошибка при обновлении контакта!').catch(console.error);
                    return;
                }
                
                // Логирование операции
                console.log(`[CONTACT EDIT] Admin ${telegramId} updated contact ${contactId}: ${field} = "${newValue}"`);
                
                delete global.userScreenshots[telegramId];
                
                bot.sendMessage(chatId,
                    `✅ Контакт успешно обновлен!\n\n` +
                    `🏢 Компания: ${contactData.selectedContact.company_name}\n` +
                    `👤 Имя: ${contactData.selectedContact.contact_name}\n` +
                    `📝 Обновлено поле: ${field}\n` +
                    `🔄 Новое значение: ${newValue}`
                ).catch(console.error);
            });
        }
    } catch (error) {
        console.error('Error in handleContactEditing:', error);
        delete global.userScreenshots[telegramId];
    }
}

function handleContactDeletion(chatId, telegramId, text) {
    try {
        const contactData = global.userScreenshots[telegramId];
        
        if (contactData.step === 'select_contact') {
            const contactIndex = parseInt(text.trim()) - 1;
            
            if (isNaN(contactIndex) || contactIndex < 0 || contactIndex >= contactData.contacts.length) {
                if (text.toLowerCase() === 'отмена') {
                    delete global.userScreenshots[telegramId];
                    bot.sendMessage(chatId, '❌ Операция отменена').catch(console.error);
                    return;
                }
                bot.sendMessage(chatId, '❌ Неверный номер контакта. Попробуйте еще раз или введите "отмена":').catch(console.error);
                return;
            }
            
            const selectedContact = contactData.contacts[contactIndex];
            contactData.selectedContact = selectedContact;
            contactData.step = 'confirm_deletion';
            
            let contactInfo = `⚠️ Подтверждение удаления контакта:\n\n`;
            contactInfo += `🏢 Компания: ${selectedContact.company_name}\n`;
            contactInfo += `👤 Имя: ${selectedContact.contact_name}\n`;
            if (selectedContact.position) contactInfo += `💼 Должность: ${selectedContact.position}\n`;
            if (selectedContact.email) contactInfo += `✉️ Email: ${selectedContact.email}\n`;
            if (selectedContact.phone) contactInfo += `📞 Телефон: ${selectedContact.phone}\n`;
            if (selectedContact.telegram) contactInfo += `💬 Telegram: ${selectedContact.telegram}\n`;
            if (selectedContact.notes) contactInfo += `📝 Заметки: ${selectedContact.notes}\n`;
            
            contactInfo += `\n⚠️ ВНИМАНИЕ! Это действие необратимо!\n\n`;
            contactInfo += `Для подтверждения удаления введите "да" или "удалить"\n`;
            contactInfo += `Для отмены введите "отмена"`;
            
            bot.sendMessage(chatId, contactInfo).catch(console.error);
            
        } else if (contactData.step === 'confirm_deletion') {
            const confirmation = text.toLowerCase().trim();
            
            if (confirmation === 'да' || confirmation === 'удалить') {
                const contactId = contactData.selectedContact.id;
                
                db.run(`DELETE FROM company_contacts WHERE id = ?`, [contactId], function(err) {
                    if (err) {
                        console.error('Error deleting contact:', err);
                        bot.sendMessage(chatId, '❌ Ошибка при удалении контакта!').catch(console.error);
                        return;
                    }
                    
                    // Логирование операции
                    console.log(`[CONTACT DELETE] Admin ${telegramId} deleted contact ${contactId}: ${contactData.selectedContact.company_name} - ${contactData.selectedContact.contact_name}`);
                    
                    delete global.userScreenshots[telegramId];
                    
                    bot.sendMessage(chatId,
                        `✅ Контакт успешно удален!\n\n` +
                        `🏢 Компания: ${contactData.selectedContact.company_name}\n` +
                        `👤 Имя: ${contactData.selectedContact.contact_name}`
                    ).catch(console.error);
                });
            } else if (confirmation === 'отмена') {
                delete global.userScreenshots[telegramId];
                bot.sendMessage(chatId, '❌ Удаление контакта отменено').catch(console.error);
            } else {
                bot.sendMessage(chatId, '❌ Неверное подтверждение. Введите "да", "удалить" или "отмена":').catch(console.error);
            }
        }
    } catch (error) {
        console.error('Error in handleContactDeletion:', error);
        delete global.userScreenshots[telegramId];
    }
}

// ========== ФУНКЦИИ СТАТУСА СОТРУДНИКОВ ==========

function showEmployeesOnline(chatId, telegramId) {
    try {
        // Обновляем последнюю активность текущего пользователя
        updateUserActivity(telegramId);

        const query = `SELECT
                    full_name, role, status, status_message, last_activity, position, position_level, registration_date, graduated_at,
                    CASE
                        WHEN last_activity > datetime('now', '-5 minutes') AND status != 'offline' THEN 'online'
                        WHEN status = 'away' THEN 'away'
                        WHEN status = 'busy' THEN 'busy'
                        ELSE 'offline'
                    END as actual_status
                FROM users
                WHERE is_registered = 1
                ORDER BY actual_status DESC, full_name`;

        db.all(query, [], (err, users) => {
            if (err) {
                console.error('❌ Show employees online error:', err);
                bot.sendMessage(chatId, '❌ Ошибка загрузки сотрудников!').catch(console.error);
                return;
            }

            if (!users || users.length === 0) {
                bot.sendMessage(chatId,
                    '👥 СОТРУДНИКИ ОНЛАЙН 📊\n\n' +
                    '❌ Сотрудники не найдены!').catch(console.error);
                return;
            }

            let statusText = '👥 СОТРУДНИКИ ОНЛАЙН 📊\n\n';

            const statusGroups = {
                online: [],
                away: [],
                busy: [],
                offline: []
            };

            // Группируем по статусам
            users.forEach(user => {
                statusGroups[user.actual_status].push(user);
            });

            // Показываем онлайн
            if (statusGroups.online.length > 0) {
                statusText += `🟢 ОНЛАЙН (${statusGroups.online.length})\n`;
                statusGroups.online.forEach(user => {
                    statusText += `   👤 ${getUserDisplayName(user)} (${user.role})\n`;
                    if (user.status_message) statusText += `      💬 ${user.status_message}\n`;
                });
                statusText += '\n';
            }

            // Показываем не на месте
            if (statusGroups.away.length > 0) {
                statusText += `🟡 НЕ НА МЕСТЕ (${statusGroups.away.length})\n`;
                statusGroups.away.forEach(user => {
                    statusText += `   👤 ${getUserDisplayName(user)} (${user.role})\n`;
                    if (user.status_message) statusText += `      💬 ${user.status_message}\n`;
                });
                statusText += '\n';
            }

            // Показываем занятых
            if (statusGroups.busy.length > 0) {
                statusText += `🔴 НЕ БЕСПОКОИТЬ (${statusGroups.busy.length})\n`;
                statusGroups.busy.forEach(user => {
                    statusText += `   👤 ${getUserDisplayName(user)} (${user.role})\n`;
                    if (user.status_message) statusText += `      💬 ${user.status_message}\n`;
                });
                statusText += '\n';
            }

            // Показываем оффлайн
            if (statusGroups.offline.length > 0) {
                statusText += `⚫ ОФФЛАЙН (${statusGroups.offline.length})\n`;
                statusGroups.offline.forEach(user => {
                    const lastActivity = new Date(user.last_activity);
                    const timeAgo = getTimeAgo(lastActivity);
                    statusText += `   👤 ${getUserDisplayName(user)} (${user.role})\n`;
                    statusText += `      ⏰ ${timeAgo}\n`;
                });
                statusText += '\n';
            }

            statusText += '⚡ Измените свой статус через "⚡ Мой статус"';

            bot.sendMessage(chatId, statusText).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show employees online error:', error);
    }
}

function showStatusMenu(chatId, telegramId) {
    const statusKeyboard = {
        reply_markup: {
            keyboard: [
                ['🟢 Онлайн', '🟡 Не на месте'],
                ['🔴 Не беспокоить', '⚫ Оффлайн'],
                ['✏️ Изменить сообщение', '📊 Мой текущий статус'],
                ['🔙 Назад в меню']
            ],
            resize_keyboard: true
        }
    };

    db.get("SELECT status, status_message FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Ошибка получения статуса!').catch(console.error);
            return;
        }

        const currentStatus = getStatusEmoji(user.status || 'offline');
        const statusMessage = user.status_message ? `\n💬 Сообщение: "${user.status_message}"` : '';

        bot.sendMessage(chatId,
            '⚡ УПРАВЛЕНИЕ СТАТУСОМ 📊\n\n' +
            `📍 Текущий статус: ${currentStatus}${statusMessage}\n\n` +
            '🟢 Онлайн - доступен для связи\n' +
            '🟡 Не на месте - отошел ненадолго\n' +
            '🔴 Не беспокоить - занят работой\n' +
            '⚫ Оффлайн - недоступен\n\n' +
            '👇 Выберите новый статус:', statusKeyboard).catch(console.error);
    });
}

function changeUserStatus(chatId, telegramId, newStatus) {
    const statusNames = {
        'online': 'Онлайн',
        'away': 'Не на месте',
        'busy': 'Не беспокоить',
        'offline': 'Оффлайн'
    };

    db.run("UPDATE users SET status = ?, last_activity = CURRENT_TIMESTAMP WHERE telegram_id = ?",
        [newStatus, telegramId], (err) => {
        if (err) {
            console.error('❌ Change status error:', err);
            bot.sendMessage(chatId, '❌ Ошибка изменения статуса!').catch(console.error);
            return;
        }

        const statusEmoji = getStatusEmoji(newStatus);
        bot.sendMessage(chatId,
            `✅ Статус изменен!\n\n` +
            `📍 Новый статус: ${statusEmoji}\n\n` +
            `💡 Коллеги теперь видят ваш статус в разделе "👥 Сотрудники онлайн"`).catch(console.error);
    });
}

function startStatusMessage(chatId, telegramId) {
    global.userScreenshots[telegramId] = {
        type: 'status_message',
        step: 'enter_message'
    };

    bot.sendMessage(chatId,
        '✏️ СООБЩЕНИЕ СТАТУСА 💬\n\n' +
        '📝 Введите сообщение для вашего статуса:\n' +
        '💡 Например: "На встрече до 15:00", "Обед", "В командировке"\n' +
        '⚡ Или напишите "убрать" чтобы удалить сообщение').catch(console.error);
}

function handleStatusMessage(chatId, telegramId, text) {
    try {
        const message = text.trim();
        let statusMessage = null;

        if (message.toLowerCase() !== 'убрать') {
            statusMessage = message;
        }

        db.run("UPDATE users SET status_message = ? WHERE telegram_id = ?",
            [statusMessage, telegramId], (err) => {
            if (err) {
                console.error('❌ Update status message error:', err);
                bot.sendMessage(chatId, '❌ Ошибка сохранения сообщения!').catch(console.error);
                return;
            }

            delete global.userScreenshots[telegramId];

            if (statusMessage) {
                bot.sendMessage(chatId,
                    `✅ Сообщение статуса обновлено!\n\n` +
                    `💬 Новое сообщение: "${statusMessage}"\n\n` +
                    `👥 Коллеги увидят это сообщение рядом с вашим статусом`).catch(console.error);
            } else {
                bot.sendMessage(chatId,
                    `✅ Сообщение статуса удалено!\n\n` +
                    `📍 Теперь отображается только ваш статус без дополнительного сообщения`).catch(console.error);
            }
        });
    } catch (error) {
        console.error('❌ Handle status message error:', error);
        delete global.userScreenshots[telegramId];
    }
}

function updateUserActivity(telegramId) {
    db.run("UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE telegram_id = ?", [telegramId], (err) => {
        if (err) {
            console.error('❌ Update activity error:', err);
        }
    });
}

function getStatusEmoji(status) {
    switch(status) {
        case 'online': return '🟢 Онлайн';
        case 'away': return '🟡 Не на месте';
        case 'busy': return '🔴 Не беспокоить';
        case 'offline': return '⚫ Оффлайн';
        default: return '⚫ Оффлайн';
    }
}

function getDayOfWeek(dateString) { // "ДД.ММ.ГГГГ"
    const parts = dateString.split('.');
    if (parts.length !== 3) return '';
    const date = new Date(parts[2], parts[1] - 1, parts[0]);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    return days[date.getDay()];
}

function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays < 7) return `${diffDays} дн назад`;
    return date.toLocaleDateString();
}

function getUserDisplayName(user) {
    if (!user) {
        return 'Неизвестный';
    }

    let displayName = user.full_name || user.username || 'Неизвестный';

    if (user.position) {
        if (user.graduated_at) {
            displayName += `, Junior-${user.position}`;
        } else if (user.position_level) {
            displayName += `, ${user.position_level} ${user.position}`;
        } else {
            displayName += `, ${user.position}`;
        }
    }

    return displayName;
}

// Handle contact exchange for QR code scanning
function handleContactExchange(chatId, telegramId, contact, state, username) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err) {
                console.error('Error finding user in handleContactExchange:', err);
                bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте снова.');
                return;
            }

            if (!user) {
                // User does not exist, create a new external user
                const fullName = `${contact.first_name} ${contact.last_name || ''}`.trim();
                db.run("INSERT INTO users (telegram_id, username, full_name, role, is_registered, is_external) VALUES (?, ?, ?, 'contact', 0, 1)",
                    [telegramId, username, fullName],
                    function(err) {
                        if (err) {
                            console.error('Error creating new external user:', err);
                            bot.sendMessage(chatId, '❌ Произошла ошибка при регистрации. Попробуйте снова.');
                            return;
                        }
                        const newScanner = { id: this.lastID, full_name: fullName };
                        proceedWithContactExchange(chatId, telegramId, contact, state, newScanner);
                    }
                );
            } else {
                // User exists, just proceed.
                proceedWithContactExchange(chatId, telegramId, contact, state, user);
            }
        });
    } catch (error) {
        console.error('Error in handleContactExchange:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте снова.');
    }
}

// Helper function to continue with contact exchange after we have scanner info
function proceedWithContactExchange(chatId, telegramId, contact, state, scanner) {
    try {
        // Get manager's user info
        db.get("SELECT id, full_name, telegram_id, username FROM users WHERE id = ?", [state.managerId], (err, manager) => {
            if (err || !manager) {
                console.error('Error getting manager info:', err);
                bot.sendMessage(chatId, '❌ Менеджер не найден. Попробуйте снова.');
                return;
            }

            // Get scanner's username
            db.get("SELECT username FROM users WHERE id = ?", [scanner.id], (err, scannerInfo) => {
                if (err) {
                    console.error('Error getting scanner username:', err);
                }

                const scannerUsername = scannerInfo ? scannerInfo.username : null;

                // Format contact info with username
                const scannerContactInfo = `👤 ${contact.first_name} ${contact.last_name || ''}\n📞 ${contact.phone_number}` +
                                           (scannerUsername ? `\n💬 @${scannerUsername}` : '');

                const managerContactInfo = `👤 ${manager.full_name}\n🆔 Telegram ID: ${manager.telegram_id}`;

                // Save contact exchange to database
                db.run(`INSERT INTO conference_contacts (scanner_id, manager_id, scanner_contact, manager_contact)
                        VALUES (?, ?, ?, ?)`,
                    [scanner.id, manager.id, scannerContactInfo, managerContactInfo], (err) => {
                    if (err) {
                        console.error('Error saving contact exchange:', err);
                        bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении контакта.');
                        return;
                    }

                    // Create inline keyboard for scanner with "Write to Manager" button
                    const scannerKeyboard = {
                        inline_keyboard: [[
                            { text: '💬 Написать менеджеру', url: manager.username ? `https://t.me/${manager.username}` : `tg://user?id=${manager.telegram_id}` }
                        ]]
                    };

                    // Send confirmation to scanner
                    bot.sendMessage(chatId,
                        `✅ Ваш контакт успешно отправлен менеджеру ${manager.full_name}.`,
                        { reply_markup: scannerKeyboard }
                    );

                    // Set state for manager to collect company info
                    global.userScreenshots[manager.telegram_id] = {
                        type: 'collect_company_info',
                        step: 'awaiting_company_name',
                        scannerId: scanner.id,
                        scannerName: `${contact.first_name} ${contact.last_name || ''}`.trim(),
                        scannerPhone: contact.phone_number,
                        scannerTelegramId: telegramId
                    };

                    // Create direct message URL
                    const directMessageUrl = scannerUsername 
                        ? `https://t.me/${scannerUsername}` 
                        : `tg://user?id=${telegramId}`;

                    // Send notification to manager with option to add company info
                    const managerKeyboard = {
                        inline_keyboard: [
                            [
                                { text: '💬 Написать', url: directMessageUrl }
                            ],
                            [
                                { text: '📝 Добавить информацию о контакте', callback_data: `add_company_info_${scanner.id}` }
                            ]
                        ]
                    };

                    bot.sendMessage(manager.telegram_id,
                        `🔔 Новый контакт с конференции!\n\n` +
                        `${scannerContactInfo}\n\n` +
                        `Вы можете связаться с этим человеком через Telegram или добавить дополнительную информацию о контакте.`,
                        { reply_markup: managerKeyboard }
                    );

                    // Clear the scanner's state
                    delete global.userScreenshots[telegramId];
                });
            });
        });
    } catch (error) {
        console.error('Error in proceedWithContactExchange:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте снова.');
    }
}

function showCurrentStatus(chatId, telegramId) {
    db.get("SELECT status, status_message, last_activity FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
        if (err || !user) {
            bot.sendMessage(chatId, '❌ Ошибка получения статуса!').catch(console.error);
            return;
        }

        const currentStatus = getStatusEmoji(user.status || 'offline');
        const statusMessage = user.status_message ? `\n💬 Сообщение: "${user.status_message}"` : '';
        const lastActivity = new Date(user.last_activity);
        const timeAgo = getTimeAgo(lastActivity);

        bot.sendMessage(chatId,
            `📊 ВАШ ТЕКУЩИЙ СТАТУС 📍\n\n` +
            `📍 Статус: ${currentStatus}${statusMessage}\n` +
            `⏰ Последняя активность: ${timeAgo}\n\n` +
            `💡 Коллеги видят ваш статус в разделе "👥 Сотрудники онлайн"\n` +
            `⚡ Для изменения используйте кнопки выше`).catch(console.error);
    });
}

// PDF Generation Function
function generateInvoicePDF(data, filePath) {
    try {
        // Simple transliteration function for Cyrillic to Latin
    function transliterate(text) {
        if (!text) return '';
        const map = {
            'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
            'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
            'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
            'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '',
            'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
            'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo',
            'Ж': 'Zh', 'З': 'Z', 'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M',
            'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'У': 'U',
            'Ф': 'F', 'Х': 'H', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch', 'Ъ': '',
            'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya'
        };
        return text.replace(/[а-яёА-ЯЁ]/g, char => map[char] || char);
    }

    const transOrgName = transliterate(data.org_name || 'Company Name');
    const transOrgAddress = transliterate(data.org_address || 'Address Line 1\nAddress Line 2');
    const transDescription = transliterate(data.work_type || 'Advertising services on Partnerkin.com');

    const doc = new PDFDocument({ size: 'A4', margin: 36 }); // 0.5in margins
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pageWidth = 595; // A4 width in points
    const pageHeight = 842; // A4 height
    const margin = 36;
    const contentWidth = pageWidth - 2 * margin;
    const tableWidth = contentWidth * 0.8; // 80% width
    const tableX = margin + (contentWidth - tableWidth) / 2; // Centered

    // 1. Header Section (~100pt from top margin, so y=36+100=136pt)
    const headerY = margin + 100;
    const detailsY = headerY + 20;

    // Left: Dynamic payer organization details
    doc.font('Helvetica-Bold').fontSize(12).text(transOrgName, margin + 20, headerY, { lineGap: 4, width: contentWidth - 100 });
    
    // Calculate company name height dynamically
    const companyNameLines = doc.widthOfString(transOrgName) > (contentWidth - 100) ?
        Math.ceil(doc.widthOfString(transOrgName) / (contentWidth - 100)) : 1;
    const companyNameHeight = companyNameLines * 14; // Approximate height based on font size and line gap
    
    // Add "Address:" label with proper spacing
    const addressLabelY = headerY + companyNameHeight + 15; // 15pt below company name
    doc.font('Helvetica-Bold').fontSize(10).text('Address:', margin + 20, addressLabelY);
    
    // Calculate address height dynamically
    const addressText = transliterate(data.org_address || 'Address');
    doc.font('Helvetica').fontSize(10);
    
    // Calculate how many lines the address will take
    const addressLines = doc.widthOfString(addressText) > (contentWidth - 100) ?
        Math.ceil(doc.widthOfString(addressText) / (contentWidth - 100)) : 1;
    const addressHeight = addressLines * 12; // Approximate height based on font size and line gap
    
    // Position address below the "Address:" label with proper spacing
    const addressY = addressLabelY + 15; // 15pt below "Address:" label
    doc.text(addressText, margin + 20, addressY, { lineGap: 3, width: contentWidth - 100 });

    // Right: Invoice details at the same level as company name
    const rightX = pageWidth - margin - 100;
    const invoiceDate = data.invoice_date || new Date().toLocaleDateString('ru-RU');
    const invoiceNumber = `INV-${data.invoice_number || '001'}`;
    const subject = 'advertising on Partnerkin.com';
    doc.font('Helvetica').fontSize(10).text(`Invoice Date: ${invoiceDate} | Invoice Number: ${invoiceNumber} | Subject: ${subject}`, rightX, headerY, { align: 'right', lineGap: 0 });

    // 2. Invoice Table - dynamically positioned based on address height
    const baseTableY = 236; // Base positioning
    const addressBottom = addressY + addressHeight + 20; // Address end + increased spacing
    const tableY = Math.max(baseTableY, addressBottom); // Use the lower of the two positions
    const rowHeight = 30; // With 10pt padding top/bottom
    const colWidth = tableWidth / 3; // Equal widths for balanced 3-column layout: Description, Quantity, Amount

    // Headers - vertically centered in cell (cell top at tableY + 10, height rowHeight=30, text at midpoint)
    const cellMidpoint = 15; // (rowHeight / 2)
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', tableX, tableY + 10 + cellMidpoint, { align: 'center', width: colWidth });
    doc.text('Quantity', tableX + colWidth, tableY + 10 + cellMidpoint, { align: 'center', width: colWidth });
    doc.text('Amount', tableX + 2 * colWidth, tableY + 10 + cellMidpoint, { align: 'center', width: colWidth });

    // Data row - single row for this invoice
    doc.font('Helvetica').fontSize(10);
    const transWorkType = transliterate(data.work_type || 'Advertising services'); // Description: service type
    
    // Handle long work_type descriptions by wrapping text
    const maxDescriptionWidth = colWidth - 20; // Increase padding further to ensure text stays within boundaries
    const workTypeLines = doc.widthOfString(transWorkType) > maxDescriptionWidth ?
        Math.ceil(doc.widthOfString(transWorkType) / maxDescriptionWidth) : 1;
    
    // Calculate the actual row height needed for the description with more padding
    const descriptionRowHeight = Math.max(rowHeight, workTypeLines * 12 + 15); // Ensure minimum row height with more padding
    
    // Always wrap the description text to ensure it stays within boundaries
    // Center the description text vertically in the cell
    const descriptionY = tableY + 10 + rowHeight + (descriptionRowHeight - rowHeight) / 2 + 5;
    doc.text(transWorkType, tableX + 10, descriptionY, {
        align: 'center',
        width: maxDescriptionWidth
    });
    
    const quantityStr = data.quantity ? data.quantity.toString() : '1'; // Quantity: integer from data
    const amountStr = `${(data.total || 0).toFixed(1)} USDT`; // Amount: formatted to 1 decimal place
    
    // Center quantity and amount in their cells, accounting for potentially taller description row
    const quantityAmountY = tableY + 10 + rowHeight + (descriptionRowHeight - rowHeight) / 2 + cellMidpoint;
    doc.text(quantityStr, tableX + colWidth, quantityAmountY, { align: 'center', width: colWidth });
    doc.text(amountStr, tableX + 2 * colWidth, quantityAmountY, { align: 'center', width: colWidth });

    // Borders: 1pt solid black, around cells with padding (adjusted for dynamic row height)
    const borderWidth = 1;
    doc.lineWidth(borderWidth);
    // Outer border - adjust height for description row
    const totalTableHeight = rowHeight + descriptionRowHeight;
    doc.rect(tableX, tableY + 10, tableWidth, totalTableHeight).stroke();
    // Vertical lines (3 columns: 4 lines)
    let currentX = tableX;
    for (let i = 0; i <= 3; i++) { // 4 lines for 3 columns
        doc.moveTo(currentX, tableY + 10).lineTo(currentX, tableY + 10 + totalTableHeight).stroke();
        currentX += colWidth;
    }
    // Horizontal lines
    doc.moveTo(tableX, tableY + 10).lineTo(tableX + tableWidth, tableY + 10).stroke(); // Top
    doc.moveTo(tableX, tableY + 10 + rowHeight).lineTo(tableX + tableWidth, tableY + 10 + rowHeight).stroke(); // Between header/data
    doc.moveTo(tableX, tableY + 10 + totalTableHeight).lineTo(tableX + tableWidth, tableY + 10 + totalTableHeight).stroke(); // Bottom

    // 3. Total Payment Line - dynamically positioned based on table height
    // Updated: Total formatted to 1 decimal place for consistency with Amount column
    const tableBottom = tableY + 10 + totalTableHeight;
    const totalY = Math.max(380, tableBottom + 30); // Ensure at least 30pt spacing below table
    doc.font('Helvetica-Bold').fontSize(12).text('Total Payment ', tableX, totalY);
    // Dashed line spanning most width
    doc.dash(5, { space: 5 }).moveTo(tableX + 100, totalY + 5).lineTo(tableX + tableWidth - 50, totalY + 5).undash().stroke();
    doc.text(` ${(data.total || 0).toFixed(1)} USDT`, tableX + tableWidth - 80, totalY, { align: 'right' });

    // Payment details closer to total - dynamically positioned
    const paymentY = totalY + 30;
    doc.font('Helvetica').fontSize(10).text('USDT TRC-20', margin + 20, paymentY, { lineGap: 3 });
    doc.font('Courier').fontSize(10).text('TWwhE7Sa6CUPN6Lq6NwKDQNrMqFJSNMZPR', margin + 20, paymentY + 15, { lineGap: 3 }); // Monospace for wallet, aligned in footer area

    // Company footer below payment - dynamically positioned
    const companyFooterY = paymentY + 40;
    doc.font('Helvetica-Bold').fontSize(10).text('WARHOLA LTD', margin + 20, companyFooterY, { lineGap: 3 });
    doc.font('Helvetica').fontSize(10).text('27 Old Gloucester Street, London, United Kingdom, WC1N 3AX\nadv@partnerkin.com', margin + 20, companyFooterY + 15, { lineGap: 3 });

        doc.end();

        stream.on('finish', () => {
            console.log(`PDF generated and saved to ${filePath} with even vertical distribution and single-page fit.`);
        });

        stream.on('error', (streamError) => {
            console.error('Error writing PDF to file:', streamError);
            throw new Error(`Failed to write PDF to file: ${streamError.message}`);
        });

    } catch (pdfError) {
        console.error('Error in PDF generation:', pdfError);
        throw new Error(`PDF generation failed: ${pdfError.message}`);
    }
}

// ========== ФУНКЦИИ СИСТЕМЫ ОТПУСКОВ ==========

// Показать меню отпусков для сотрудника
function showVacationMenu(chatId, telegramId) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err || !user) {
                bot.sendMessage(chatId, '❌ Пользователь не найден!').catch(console.error);
                return;
            }

            // Получаем баланс отпуска на текущий год
            const currentYear = new Date().getFullYear();
            db.get("SELECT * FROM vacation_balances WHERE telegram_id = ? AND year = ?",
                   [telegramId, currentYear], (err, balance) => {
                if (!balance) {
                    // Создаём начальный баланс для нового пользователя
                    db.run("INSERT INTO vacation_balances (user_id, telegram_id, year) VALUES (?, ?, ?)",
                           [user.id, telegramId, currentYear], () => {
                        showVacationMenuWithBalance(chatId, { remaining_days: 28, used_days: 0, pending_days: 0 });
                    });
                } else {
                    showVacationMenuWithBalance(chatId, balance);
                }
            });
        });
    } catch (error) {
        console.error('❌ Show vacation menu error:', error);
        bot.sendMessage(chatId, '❌ Ошибка загрузки меню отпусков!').catch(console.error);
    }
}

function showVacationMenuWithBalance(chatId, balance) {
    const menuText =
        '🏖️ СИСТЕМА ОТПУСКОВ 📅\n\n' +
        '📊 Ваш баланс отпуска:\n' +
        `🟢 Остаток дней: ${balance.remaining_days}\n` +
        `🔵 Использовано: ${balance.used_days}\n` +
        `🟡 На рассмотрении: ${balance.pending_days}\n\n` +
        '👇 Выберите действие:';

    bot.sendMessage(chatId, menuText, vacationKeyboard).catch(console.error);
}

// Показать админское меню управления отпусками
function showAdminVacationMenu(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            bot.sendMessage(chatId,
                '🏖️ УПРАВЛЕНИЕ ОТПУСКАМИ (HR) 👨‍💼\n\n' +
                'Здесь вы можете управлять заявками на отпуск сотрудников.\n\n' +
                '👇 Выберите действие:', adminVacationKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show admin vacation menu error:', error);
    }
}

// Начать создание заявки на отпуск
function startVacationRequest(chatId, telegramId) {
    try {
        global.vacationStates[telegramId] = {
            step: 'start_date',
            request: {}
        };

        bot.sendMessage(chatId,
            '📝 ПОДАЧА ЗАЯВКИ НА ОТПУСК\n\n' +
            '📅 Укажите дату начала отпуска в формате ДД.ММ.ГГГГ\n' +
            'Например: 15.07.2024\n\n' +
            '❌ Для отмены напишите "отмена"').catch(console.error);
    } catch (error) {
        console.error('❌ Start vacation request error:', error);
    }
}

// Обработка ввода данных для заявки на отпуск
function handleVacationInput(chatId, telegramId, text) {
    try {
        const state = global.vacationStates[telegramId];
        if (!state) return false;

        if (text.toLowerCase() === 'отмена') {
            delete global.vacationStates[telegramId];
            showVacationMenu(chatId, telegramId);
            return true;
        }

        switch (state.step) {
            case 'start_date':
                if (!isValidDate(text)) {
                    bot.sendMessage(chatId, '❌ Неверный формат даты! Используйте ДД.ММ.ГГГГ').catch(console.error);
                    return true;
                }
                state.request.start_date = text;
                state.step = 'duration';
                bot.sendMessage(chatId,
                    '📅 Выберите длительность отпуска:',
                    vacationDurationKeyboard).catch(console.error);
                break;

            case 'duration':
                const durationMatch = text.match(/(\d+)/);
                if (durationMatch && ['7', '14', '28'].includes(durationMatch[1])) {
                    const duration = parseInt(durationMatch[1]);
                    const startDate = parseDate(state.request.start_date);
                    const endDate = new Date(startDate);
                    endDate.setDate(startDate.getDate() + duration - 1); // end date is inclusive

                    const day = String(endDate.getDate()).padStart(2, '0');
                    const month = String(endDate.getMonth() + 1).padStart(2, '0');
                    const year = endDate.getFullYear();
                    state.request.end_date = `${day}.${month}.${year}`;

                    state.request.days_count = duration;
                    state.step = 'vacation_type';

                    const typeKeyboard = {
                        reply_markup: {
                            keyboard: [
                                ['Основной отпуск'],
                                ['Учебный отпуск', 'Без сохранения з/п'],
                                ['Больничный'],
                                ['❌ Отмена']
                            ],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    };

                    bot.sendMessage(chatId,
                        `📊 Период: ${state.request.start_date} - ${state.request.end_date}\n` +
                        `⏰ Количество дней: ${state.request.days_count}\n\n` +
                        '📋 Выберите тип отпуска:', typeKeyboard).catch(console.error);
                } else if (text.includes('Другое')) {
                    state.step = 'end_date';
                    bot.sendMessage(chatId,
                        '📅 Укажите дату окончания отпуска в формате ДД.ММ.ГГГГ\n' +
                        'Например: 29.07.2024').catch(console.error);
                } else {
                    bot.sendMessage(chatId, '❌ Пожалуйста, выберите один из вариантов.').catch(console.error);
                }
                break;

            case 'end_date':
                if (!isValidDate(text)) {
                    bot.sendMessage(chatId, '❌ Неверный формат даты! Используйте ДД.ММ.ГГГГ').catch(console.error);
                    return true;
                }

                const startDate = parseDate(state.request.start_date);
                const endDate = parseDate(text);

                if (endDate <= startDate) {
                    bot.sendMessage(chatId, '❌ Дата окончания должна быть позже даты начала!').catch(console.error);
                    return true;
                }

                state.request.end_date = text;
                state.request.days_count = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
                state.step = 'vacation_type';

                const typeKeyboard = {
                    reply_markup: {
                        keyboard: [
                            ['Основной отпуск'],
                            ['Учебный отпуск', 'Без сохранения з/п'],
                            ['Больничный'],
                            ['❌ Отмена']
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                bot.sendMessage(chatId,
                    `📊 Период: ${state.request.start_date} - ${state.request.end_date}\n` +
                    `⏰ Количество дней: ${state.request.days_count}\n\n` +
                    '📋 Выберите тип отпуска:', typeKeyboard).catch(console.error);
                break;

            case 'vacation_type':
                const validTypes = ['Основной отпуск', 'Учебный отпуск', 'Без сохранения з/п', 'Больничный'];
                if (!validTypes.includes(text)) {
                    bot.sendMessage(chatId, '❌ Выберите тип отпуска из предложенных вариантов!').catch(console.error);
                    return true;
                }

                state.request.vacation_type = text;
                state.step = 'reason';
                bot.sendMessage(chatId,
                    '💭 Укажите причину/комментарий к заявке (необязательно):\n\n' +
                    '▶️ Для пропуска нажмите "Пропустить"').catch(console.error);
                break;

            case 'reason':
                if (text !== 'Пропустить') {
                    state.request.reason = text;
                }
                submitVacationRequest(chatId, telegramId, state.request);
                break;
        }

        return true;
    } catch (error) {
        console.error('❌ Handle vacation input error:', error);
        return false;
    }
}

// Подача заявки на отпуск
function submitVacationRequest(chatId, telegramId, request) {
    try {
        db.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId], (err, user) => {
            if (err || !user) {
                bot.sendMessage(chatId, '❌ Ошибка пользователя!').catch(console.error);
                return;
            }

            // Проверяем баланс отпуска
            const currentYear = new Date().getFullYear();
            db.get("SELECT * FROM vacation_balances WHERE telegram_id = ? AND year = ?",
                   [telegramId, currentYear], (err, balance) => {

                if (!balance || balance.remaining_days < request.days_count) {
                    bot.sendMessage(chatId,
                        `❌ Недостаточно дней отпуска!\n` +
                        `Запрашиваете: ${request.days_count} дней\n` +
                        `Остаток: ${balance ? balance.remaining_days : 0} дней`).then(() => {
                            showVacationMenu(chatId, telegramId);
                        }).catch(console.error);
                    delete global.vacationStates[telegramId];
                    return;
                }

                // Сохраняем заявку
                db.run(`INSERT INTO vacation_requests
                        (user_id, telegram_id, start_date, end_date, vacation_type, reason, days_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [user.id, telegramId, request.start_date, request.end_date,
                     request.vacation_type, request.reason, request.days_count], function() {

                    const requestId = this.lastID;

                    // Обновляем баланс (резервируем дни)
                    db.run(`UPDATE vacation_balances
                            SET pending_days = pending_days + ?, remaining_days = remaining_days - ?
                            WHERE telegram_id = ? AND year = ?`,
                        [request.days_count, request.days_count, telegramId, currentYear], () => {

                        bot.sendMessage(chatId,
                            '✅ ЗАЯВКА НА ОТПУСК ПОДАНА! 🎉\n\n' +
                            `📅 Период: ${request.start_date} - ${request.end_date}\n` +
                            `⏰ Дней: ${request.days_count}\n` +
                            `📋 Тип: ${request.vacation_type}\n` +
                            `💭 Причина: ${request.reason || 'Не указана'}\n\n` +
                            '⏳ Заявка отправлена на рассмотрение HR!\n' +
                            '📧 Вы получите уведомление о решении.', vacationKeyboard).catch(console.error);

                        // Уведомляем админов
                        notifyAdminsOfVacationRequest(requestId, user, request);

                        delete global.vacationStates[telegramId];
                    });
                });
            });
        });
    } catch (error) {
        console.error('❌ Submit vacation request error:', error);
    }
}

// Показать заявки пользователя на отпуск
function showUserVacationRequests(chatId, telegramId) {
    try {
        db.all("SELECT * FROM vacation_requests WHERE telegram_id = ? ORDER BY requested_date DESC",
               [telegramId], (err, requests) => {

            if (err || !requests || requests.length === 0) {
                bot.sendMessage(chatId,
                    '📋 У вас пока нет заявок на отпуск.\n\n' +
                    '💡 Подайте заявку через кнопку "📝 Подать заявку"', vacationKeyboard).catch(console.error);
                return;
            }

            let requestsText = '📋 ВАШИ ЗАЯВКИ НА ОТПУСК:\n\n';

            requests.forEach((req, index) => {
                const statusEmoji = {
                    'pending': '🟡',
                    'approved': '🟢',
                    'rejected': '🔴'
                };

                const statusText = {
                    'pending': 'На рассмотрении',
                    'approved': 'Одобрено',
                    'rejected': 'Отклонено'
                };

                requestsText += `${index + 1}. ${statusEmoji[req.status]} ${statusText[req.status]}\n`;
                requestsText += `📅 ${req.start_date} - ${req.end_date} (${req.days_count} дн.)\n`;
                requestsText += `📋 ${req.vacation_type}\n`;

                if (req.reviewer_comment) {
                    requestsText += `💬 Комментарий HR: ${req.reviewer_comment}\n`;
                }

                requestsText += `📄 Подано: ${new Date(req.requested_date).toLocaleDateString('ru-RU')}\n\n`;
            });

            bot.sendMessage(chatId, requestsText, vacationKeyboard).catch(console.error);
        });
    } catch (error) {
        console.error('❌ Show user vacation requests error:', error);
    }
}

// Вспомогательные функции
function isValidDate(dateStr) {
    const regex = /^\d{2}\.\d{2}\.\d{4}$/;
    if (!regex.test(dateStr)) return false;

    const [day, month, year] = dateStr.split('.').map(Number);
    const date = new Date(year, month - 1, day);

    return date.getDate() === day &&
           date.getMonth() === month - 1 &&
           date.getFullYear() === year &&
           date >= new Date();
}

function parseDate(dateStr) {
    const [day, month, year] = dateStr.split('.').map(Number);
    return new Date(year, month - 1, day);
}

// ========== HR ФУНКЦИИ УПРАВЛЕНИЯ ОТПУСКАМИ ==========

// Показать все заявки на отпуск для HR
function showAdminVacationRequests(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            db.all(`SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at
                    FROM vacation_requests vr
                    JOIN users u ON vr.telegram_id = u.telegram_id
                    ORDER BY
                        CASE vr.status
                            WHEN 'pending' THEN 1
                            WHEN 'approved' THEN 2
                            WHEN 'rejected' THEN 3
                        END,
                        vr.requested_date DESC`, (err, requests) => {

                if (err || !requests || requests.length === 0) {
                    bot.sendMessage(chatId,
                        '📋 Заявок на отпуск пока нет.\n\n' +
                        '💼 Как только сотрудники подадут заявки, они появятся здесь.',
                        adminVacationKeyboard).catch(console.error);
                    return;
                }

                let requestsText = '📋 ЗАЯВКИ НА ОТПУСК (HR)\n\n';
                let pendingCount = 0;

                requests.forEach((req, index) => {
                    const statusEmoji = {
                        'pending': '🟡',
                        'approved': '✅',
                        'rejected': '❌'
                    };

                    const statusText = {
                        'pending': 'ТРЕБУЕТ РЕШЕНИЯ',
                        'approved': 'Одобрено',
                        'rejected': 'Отклонено'
                    };

                    if (req.status === 'pending') pendingCount++;

                    requestsText += `${statusEmoji[req.status]} ${statusText[req.status]}\n`;
                    requestsText += `👤 ${getUserDisplayName(req)}\n`;
                    requestsText += `📅 ${req.start_date} - ${req.end_date} (${req.days_count} дн.)\n`;
                    requestsText += `📋 ${req.vacation_type}\n`;

                    if (req.reason) {
                        requestsText += `💭 ${req.reason}\n`;
                    }

                    requestsText += `📄 ID: ${req.id} | ${new Date(req.requested_date).toLocaleDateString('ru-RU')}\n\n`;
                });

                requestsText += `\n⚡ Ожидают решения: ${pendingCount} заявок\n`;
                requestsText += `\n💡 Для одобрения/отклонения используйте:\n`;
                requestsText += `▶️ "одобрить ID" или "отклонить ID причина"`;

                bot.sendMessage(chatId, requestsText, adminVacationKeyboard).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show admin vacation requests error:', error);
    }
}

function showPendingVacationRequestsForApproval(chatId) {
    db.all("SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at FROM vacation_requests vr JOIN users u ON vr.user_id = u.id WHERE vr.status = 'pending'", (err, requests) => {
        if (err || !requests || requests.length === 0) {
            bot.sendMessage(chatId, '✅ Нет заявок для одобрения.');
            return;
        }

        const keyboard = requests.map(req => ([{
            text: `${getUserDisplayName(req)}: ${req.start_date} - ${req.end_date}`,
            callback_data: `vac_approve_${req.id}`
        }]));

        bot.sendMessage(chatId, 'Выберите заявку для одобрения:', {
            reply_markup: { inline_keyboard: keyboard }
        });
    });
}

function showPendingVacationRequestsForRejection(chatId) {
    db.all("SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at FROM vacation_requests vr JOIN users u ON vr.user_id = u.id WHERE vr.status = 'pending'", (err, requests) => {
        if (err || !requests || requests.length === 0) {
            bot.sendMessage(chatId, '❌ Нет заявок для отклонения.');
            return;
        }

        const keyboard = requests.map(req => ([{
            text: `${getUserDisplayName(req)}: ${req.start_date} - ${req.end_date}`,
            callback_data: `vac_reject_${req.id}`
        }]));

        bot.sendMessage(chatId, 'Выберите заявку для отклонения:', {
            reply_markup: { inline_keyboard: keyboard }
        });
    });
}

// Показать календарь отпусков команды
function showTeamVacationCalendar(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            const currentDate = new Date();
            const currentMonth = currentDate.getMonth();
            const currentYear = currentDate.getFullYear();

            // Получаем одобренные отпуска на ближайшие 3 месяца
            const endDate = new Date(currentYear, currentMonth + 3, 0);

            db.all(`SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at
                    FROM vacation_requests vr
                    JOIN users u ON vr.telegram_id = u.telegram_id
                    WHERE vr.status = 'approved'
                    ORDER BY vr.start_date`, (err, approvedVacations) => {

                let calendarText = '📅 КАЛЕНДАРЬ ОТПУСКОВ КОМАНДЫ\n\n';

                if (!approvedVacations || approvedVacations.length === 0) {
                    calendarText += '🏖️ Одобренных отпусков пока нет.\n\n';
                } else {
                    calendarText += '✅ ОДОБРЕННЫЕ ОТПУСКИ:\n\n';

                    approvedVacations.forEach((vacation) => {
                        calendarText += `👤 ${getUserDisplayName(vacation)}\n`;
                        calendarText += `📅 ${vacation.start_date} - ${vacation.end_date}\n`;
                        calendarText += `⏰ ${vacation.days_count} дней (${vacation.vacation_type})\n\n`;
                    });
                }

                // Показываем также заявки на рассмотрении
                db.all(`SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at
                        FROM vacation_requests vr
                        JOIN users u ON vr.telegram_id = u.telegram_id
                        WHERE vr.status = 'pending'
                        ORDER BY vr.start_date`, (err, pendingVacations) => {

                    if (pendingVacations && pendingVacations.length > 0) {
                        calendarText += '🟡 НА РАССМОТРЕНИИ:\n\n';

                        pendingVacations.forEach((vacation) => {
                            calendarText += `👤 ${getUserDisplayName(vacation)}\n`;
                            calendarText += `📅 ${vacation.start_date} - ${vacation.end_date}\n`;
                            calendarText += `⏰ ${vacation.days_count} дней\n\n`;
                        });
                    }

                    bot.sendMessage(chatId, calendarText, adminVacationKeyboard).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Show team vacation calendar error:', error);
    }
}

// Показать балансы отпусков сотрудников
function showEmployeeBalances(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            const currentYear = new Date().getFullYear();

            db.all(`SELECT u.full_name, u.username, u.telegram_id, u.role, u.position, u.position_level, u.registration_date, u.graduated_at,
                           vb.total_days, vb.used_days, vb.pending_days, vb.remaining_days
                    FROM users u
                    LEFT JOIN vacation_balances vb ON u.telegram_id = vb.telegram_id AND vb.year = ?
                    WHERE u.is_registered = 1
                    ORDER BY u.full_name`, [currentYear], (err, employees) => {

                if (err || !employees || employees.length === 0) {
                    bot.sendMessage(chatId, '👥 Сотрудников не найдено.', adminVacationKeyboard).catch(console.error);
                    return;
                }

                let balanceText = `👥 БАЛАНСЫ ОТПУСКОВ (${currentYear})\n\n`;

                employees.forEach((emp, index) => {
                    const roleEmoji = emp.role === 'стажер' ? '👶' : '🧓';
                    const totalDays = emp.total_days || 28;
                    const usedDays = emp.used_days || 0;
                    const pendingDays = emp.pending_days || 0;
                    const remainingDays = emp.remaining_days || 28;

                    balanceText += `${index + 1}. ${roleEmoji} ${getUserDisplayName(emp)}\n`;
                    balanceText += `   📊 ${remainingDays}/${totalDays} дней`;

                    if (usedDays > 0) balanceText += ` | Использовано: ${usedDays}`;
                    if (pendingDays > 0) balanceText += ` | На рассмотрении: ${pendingDays}`;

                    balanceText += '\n\n';
                });

                balanceText += '💡 Для изменения баланса используйте:\n';
                balanceText += '"установить баланс ID количество"';

                bot.sendMessage(chatId, balanceText, adminVacationKeyboard).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Show employee balances error:', error);
    }
}

// Показать статистику отпусков
function showVacationStats(chatId, telegramId) {
    try {
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) {
                bot.sendMessage(chatId, '❌ Нет прав администратора!').catch(console.error);
                return;
            }

            const currentYear = new Date().getFullYear();

            db.all(`SELECT
                        COUNT(*) as total_requests,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_requests,
                        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_requests,
                        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_requests,
                        SUM(CASE WHEN status = 'approved' THEN days_count ELSE 0 END) as total_approved_days,
                        AVG(CASE WHEN status = 'approved' THEN days_count ELSE NULL END) as avg_vacation_days
                    FROM vacation_requests
                    WHERE EXTRACT(YEAR FROM requested_date) = ?`, [currentYear.toString()], (err, stats) => {

                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка загрузки статистики.', adminVacationKeyboard).catch(console.error);
                    return;
                }

                const stat = stats[0];

                let statsText = `📊 СТАТИСТИКА ОТПУСКОВ (${currentYear})\n\n`;

                statsText += `📋 Всего заявок: ${stat.total_requests || 0}\n`;
                statsText += `🟡 На рассмотрении: ${stat.pending_requests || 0}\n`;
                statsText += `✅ Одобрено: ${stat.approved_requests || 0}\n`;
                statsText += `❌ Отклонено: ${stat.rejected_requests || 0}\n\n`;

                statsText += `📅 Общий одобренный отпуск: ${stat.total_approved_days || 0} дней\n`;

                if (stat.avg_vacation_days) {
                    statsText += `📈 Средняя длительность: ${Math.round(stat.avg_vacation_days)} дней\n`;
                }

                // Статистика по типам отпусков
                db.all(`SELECT vacation_type, COUNT(*) as count
                        FROM vacation_requests
                        WHERE status = 'approved' AND EXTRACT(YEAR FROM requested_date) = ?
                        GROUP BY vacation_type`, [currentYear.toString()], (err, typeStats) => {

                    if (typeStats && typeStats.length > 0) {
                        statsText += '\n📋 По типам отпусков:\n';
                        typeStats.forEach(type => {
                            statsText += `▶️ ${type.vacation_type}: ${type.count}\n`;
                        });
                    }

                    bot.sendMessage(chatId, statsText, adminVacationKeyboard).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Show vacation stats error:', error);
    }
}

// Обработка админских команд для управления отпусками
function handleVacationAdminCommands(chatId, telegramId, text) {
    try {
        const lowerText = text.toLowerCase().trim();

        // Проверяем админские права
        db.get("SELECT * FROM admins WHERE telegram_id = ?", [telegramId], (err, admin) => {
            if (!admin) return false;

            // Команда одобрения: "одобрить 1"
            if (lowerText.startsWith('одобрить ')) {
                const requestId = lowerText.replace('одобрить ', '').trim();
                if (!isNaN(requestId)) {
                    approveVacationRequest(chatId, telegramId, parseInt(requestId));
                    return true;
                }
            }

            // Команда отклонения: "отклонить 1 причина отклонения"
            if (lowerText.startsWith('отклонить ')) {
                const parts = lowerText.replace('отклонить ', '').split(' ');
                const requestId = parts[0];
                const reason = parts.slice(1).join(' ') || 'Без указания причины';

                if (!isNaN(requestId)) {
                    rejectVacationRequest(chatId, telegramId, parseInt(requestId), reason);
                    return true;
                }
            }

            // Команда установки баланса: "установить баланс 123456789 30"
            if (lowerText.startsWith('установить баланс ')) {
                const parts = lowerText.replace('установить баланс ', '').split(' ');
                const userTelegramId = parts[0];
                const days = parts[1];

                if (!isNaN(userTelegramId) && !isNaN(days)) {
                    setVacationBalance(chatId, telegramId, parseInt(userTelegramId), parseInt(days));
                    return true;
                }
            }

            return false;
        });

        return false;
    } catch (error) {
        console.error('❌ Handle vacation admin commands error:', error);
        return false;
    }
}

// Одобрить заявку на отпуск
function approveVacationRequest(chatId, adminId, requestId) {
    try {
        db.get("SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at FROM vacation_requests vr JOIN users u ON vr.telegram_id = u.telegram_id WHERE vr.id = ?",
               [requestId], (err, request) => {

            if (err || !request) {
                bot.sendMessage(chatId, '❌ Заявка не найдена!').catch(console.error);
                return;
            }

            if (request.status !== 'pending') {
                bot.sendMessage(chatId, `❌ Заявка уже обработана (${request.status})!`).catch(console.error);
                return;
            }

            const currentYear = new Date().getFullYear();

            // Обновляем статус заявки
            db.run(`UPDATE vacation_requests SET status = 'approved', reviewed_date = CURRENT_TIMESTAMP, reviewer_id = ?
                    WHERE id = ?`, [adminId, requestId], () => {

                // Перемещаем дни из "на рассмотрении" в "использовано"
                db.run(`UPDATE vacation_balances
                        SET used_days = used_days + ?,
                            pending_days = pending_days - ?,
                            last_updated = CURRENT_TIMESTAMP
                        WHERE telegram_id = ? AND year = ?`,
                    [request.days_count, request.days_count, request.telegram_id, currentYear], () => {

                    // Уведомляем HR
                    bot.sendMessage(chatId,
                        `✅ ЗАЯВКА ОДОБРЕНА!\n\n` +
                        `👤 Сотрудник: ${getUserDisplayName(request)}\n` +
                        `📅 Период: ${request.start_date} - ${request.end_date}\n` +
                        `⏰ Дней: ${request.days_count}\n` +
                        `📋 Тип: ${request.vacation_type}\n\n` +
                        '✅ Сотрудник получит уведомление!',
                        adminVacationKeyboard).catch(console.error);

                    // Уведомляем сотрудника
                    bot.sendMessage(request.telegram_id,
                        `🎉 ВАША ЗАЯВКА НА ОТПУСК ОДОБРЕНА!\n\n` +
                        `📅 Период: ${request.start_date} - ${request.end_date}\n` +
                        `⏰ Дней: ${request.days_count}\n` +
                        `📋 Тип: ${request.vacation_type}\n\n` +
                        `🏖️ Приятного отдыха!`).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Approve vacation request error:', error);
    }
}

// Отклонить заявку на отпуск
function rejectVacationRequest(chatId, adminId, requestId, reason) {
    try {
        db.get("SELECT vr.*, u.full_name, u.username, u.role, u.position, u.position_level, u.registration_date, u.graduated_at FROM vacation_requests vr JOIN users u ON vr.telegram_id = u.telegram_id WHERE vr.id = ?",
               [requestId], (err, request) => {

            if (err || !request) {
                bot.sendMessage(chatId, '❌ Заявка не найдена!').catch(console.error);
                return;
            }

            if (request.status !== 'pending') {
                bot.sendMessage(chatId, `❌ Заявка уже обработана (${request.status})!`).catch(console.error);
                return;
            }

            const currentYear = new Date().getFullYear();

            // Обновляем статус заявки
            db.run(`UPDATE vacation_requests SET status = 'rejected', reviewed_date = CURRENT_TIMESTAMP,
                    reviewer_id = ?, reviewer_comment = ? WHERE id = ?`,
                   [adminId, reason, requestId], () => {

                // Возвращаем дни из "на рассмотрении" в "остаток"
                db.run(`UPDATE vacation_balances
                        SET remaining_days = remaining_days + ?,
                            pending_days = pending_days - ?,
                            last_updated = CURRENT_TIMESTAMP
                        WHERE telegram_id = ? AND year = ?`,
                    [request.days_count, request.days_count, request.telegram_id, currentYear], () => {

                    // Уведомляем HR
                    bot.sendMessage(chatId,
                        `❌ ЗАЯВКА ОТКЛОНЕНА!\n\n` +
                        `👤 Сотрудник: ${getUserDisplayName(request)}\n` +
                        `📅 Период: ${request.start_date} - ${request.end_date}\n` +
                        `💭 Причина: ${reason}\n\n` +
                        '📧 Сотрудник получит уведомление!',
                        adminVacationKeyboard).catch(console.error);

                    // Уведомляем сотрудника
                    bot.sendMessage(request.telegram_id,
                        `❌ ВАША ЗАЯВКА НА ОТПУСК ОТКЛОНЕНА\n\n` +
                        `📅 Период: ${request.start_date} - ${request.end_date}\n` +
                        `⏰ Дней: ${request.days_count}\n` +
                        `💭 Причина отклонения: ${reason}\n\n` +
                        `🔄 Дни возвращены в ваш баланс.\n` +
                        `💡 Вы можете подать новую заявку.`).catch(console.error);
                });
            });
        });
    } catch (error) {
        console.error('❌ Reject vacation request error:', error);
    }
}

// Установить баланс отпуска для сотрудника
function setVacationBalance(chatId, adminId, userTelegramId, days) {
    try {
        const currentYear = new Date().getFullYear();

        db.get("SELECT * FROM users WHERE telegram_id = ?", [userTelegramId], (err, user) => {
            if (err || !user) {
                bot.sendMessage(chatId, '❌ Сотрудник не найден!').catch(console.error);
                return;
            }

            // Создаём или обновляем баланс
            db.run(`INSERT OR REPLACE INTO vacation_balances
                    (user_id, telegram_id, year, total_days, remaining_days, used_days, pending_days)
                    VALUES (?, ?, ?, ?, ?,
                            COALESCE((SELECT used_days FROM vacation_balances WHERE telegram_id = ? AND year = ?), 0),
                            COALESCE((SELECT pending_days FROM vacation_balances WHERE telegram_id = ? AND year = ?), 0))`,
                [user.id, userTelegramId, currentYear, days, days, userTelegramId, currentYear, userTelegramId, currentYear], () => {

                bot.sendMessage(chatId,
                    `✅ БАЛАНС ОБНОВЛЁН!\n\n` +
                    `👤 Сотрудник: ${getUserDisplayName(user)}\n` +
                    `📊 Новый баланс: ${days} дней\n` +
                    `📅 Год: ${currentYear}`,
                    adminVacationKeyboard).catch(console.error);

                // Уведомляем сотрудника
                bot.sendMessage(userTelegramId,
                    `📊 ВАШ БАЛАНС ОТПУСКА ОБНОВЛЁН!\n\n` +
                    `🟢 Доступно дней: ${days}\n` +
                    `📅 Год: ${currentYear}\n\n` +
                    `💼 Обновлено администратором.`).catch(console.error);
            });
        });
    } catch (error) {
        console.error('❌ Set vacation balance error:', error);
    }
}

// Handle company info collection for conference contacts
function handleCompanyInfoCollection(chatId, telegramId, text, state) {
    try {
        if (state.step === 'awaiting_company_name') {
            // Save company name and ask for position
            global.userScreenshots[telegramId].companyName = text;
            global.userScreenshots[telegramId].step = 'awaiting_position';
            
            bot.sendMessage(chatId,
                '📝 *Добавление информации о контакте*\n\n' +
                'Отлично! Теперь введите должность контакта:',
                { parse_mode: 'Markdown' }
            );
        } else if (state.step === 'awaiting_position') {
            // Save position and ask for comment
            global.userScreenshots[telegramId].position = text;
            global.userScreenshots[telegramId].step = 'awaiting_comment';
            
            bot.sendMessage(chatId,
                '📝 *Добавление информации о контакте*\n\n' +
                'Хорошо! Теперь добавьте краткий комментарий (необязательно):',
                { parse_mode: 'Markdown' }
            );
        } else if (state.step === 'awaiting_comment') {
            // Save comment and update the contact record
            const companyName = global.userScreenshots[telegramId].companyName;
            const position = global.userScreenshots[telegramId].position;
            const comment = text;
            const scannerId = global.userScreenshots[telegramId].scannerId;
            
            // Update the conference_contacts record with company info
            db.run(`UPDATE conference_contacts
                    SET company_name = ?, position = ?, comment = ?
                    WHERE scanner_id = ? AND manager_id = (SELECT id FROM users WHERE telegram_id = ?)`,
                [companyName, position, comment, scannerId, telegramId], (err) => {
                if (err) {
                    console.error('Error updating company info:', err);
                    bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении информации.');
                    return;
                }
                
                // Get scanner info for confirmation
                db.get("SELECT full_name FROM users WHERE id = ?", [scannerId], (err, scanner) => {
                    if (err || !scanner) {
                        console.error('Error getting scanner info:', err);
                        bot.sendMessage(chatId, '✅ Информация сохранена!');
                        return;
                    }
                    
                    bot.sendMessage(chatId,
                        `✅ *Информация о контакте сохранена!*\n\n` +
                        `👤 Контакт: ${scanner.full_name}\n` +
                        `🏢 Компания: ${companyName}\n` +
                        `💼 Должность: ${position}\n` +
                        `💬 Комментарий: ${comment}\n\n` +
                        `Эта информация будет доступна в разделе "📇 Контакты с конфы"`,
                        { parse_mode: 'Markdown' }
                    );
                });
                
                // Clear the state
                delete global.userScreenshots[telegramId];
            });
        }
    } catch (error) {
        console.error('Error in handleCompanyInfoCollection:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте еще раз.');
    }
}
// Export bot and database for use in server.js
module.exports = { bot, db };

console.log('✅ Bot module loaded successfully (webhook mode)');
