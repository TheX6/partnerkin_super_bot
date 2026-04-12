// adminAuth.js - Модуль для безопасной аутентификации администратора

const db = require('../database');
const { verifyPassword, createAdminSessionToken, verifyAdminSessionToken } = require('./passwordHasher');
const { validateTelegramId, validateMessageText } = require('./inputValidator');

// Хранилище активных сессий администраторов
const adminSessions = new Map();

/**
 * Проверяет, является ли пользователь администратором
 * @param {number} telegramId - ID пользователя Telegram
 * @returns {Promise<boolean>} - Результат проверки
 */
async function isAdmin(telegramId) {
    try {
        // Валидируем ID
        const idValidation = validateTelegramId(telegramId);
        if (!idValidation.isValid) {
            return false;
        }
        
        // Проверяем в базе данных
        const admin = await new Promise((resolve, reject) => {
            db.get("SELECT * FROM admins WHERE telegram_id = ?", [idValidation.value], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
        
        return !!admin;
    } catch (error) {
        console.error('Ошибка при проверке администратора:', error);
        return false;
    }
}

/**
 * Проверяет пароль администратора
 * @param {number} telegramId - ID пользователя Telegram
 * @param {string} password - Пароль для проверки
 * @returns {Promise<boolean>} - Результат проверки
 */
async function verifyAdminPassword(telegramId, password) {
    try {
        // Валидируем входные данные
        const idValidation = validateTelegramId(telegramId);
        if (!idValidation.isValid) {
            console.error('Невалидный ID администратора:', idValidation.error);
            return false;
        }
        
        const passwordValidation = validateMessageText(password, 256);
        if (!passwordValidation.isValid) {
            console.error('Невалидный пароль:', passwordValidation.error);
            return false;
        }
        
        // Проверяем, является ли пользователь администратором
        const isAdminUser = await isAdmin(telegramId);
        if (!isAdminUser) {
            console.error(`Пользователь ${telegramId} не является администратором`);
            return false;
        }
        
        // Получаем хешированный пароль из базы данных
        const passwordData = await new Promise((resolve, reject) => {
            db.get("SELECT password_hash FROM admin_passwords WHERE telegram_id = ?", [idValidation.value], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
        
        if (!passwordData || !passwordData.password_hash) {
            console.error(`Хешированный пароль для администратора ${telegramId} не найден`);
            return false;
        }
        
        // Проверяем пароль
        const isValid = await verifyPassword(passwordValidation.value, passwordData.password_hash);
        
        if (isValid) {
            console.log(`✅ Администратор ${telegramId} успешно аутентифицирован`);
        } else {
            console.log(`❌ Неверный пароль для администратора ${telegramId}`);
        }
        
        return isValid;
    } catch (error) {
        console.error('Ошибка при проверке пароля администратора:', error);
        return false;
    }
}

/**
 * Создает сессию администратора
 * @param {number} telegramId - ID пользователя Telegram
 * @returns {Promise<object|null>} - Данные сессии или null в случае ошибки
 */
async function createAdminSession(telegramId) {
    try {
        // Валидируем ID
        const idValidation = validateTelegramId(telegramId);
        if (!idValidation.isValid) {
            console.error('Невалидный ID администратора:', idValidation.error);
            return null;
        }
        
        // Проверяем, является ли пользователь администратором
        const isAdminUser = await isAdmin(telegramId);
        if (!isAdminUser) {
            console.error(`Пользователь ${telegramId} не является администратором`);
            return null;
        }
        
        // Создаем токен сессии
        const tokenData = createAdminSessionToken(idValidation.value);
        
        // Сохраняем сессию
        adminSessions.set(telegramId, {
            token: tokenData.token,
            expiresAt: tokenData.expiresAt,
            createdAt: Date.now()
        });
        
        console.log(`✅ Сессия для администратора ${telegramId} создана`);
        
        return {
            telegramId: idValidation.value,
            token: tokenData.token,
            expiresAt: tokenData.expiresAt
        };
    } catch (error) {
        console.error('Ошибка при создании сессии администратора:', error);
        return null;
    }
}

/**
 * Проверяет сессию администратора
 * @param {number} telegramId - ID пользователя Telegram
 * @param {string} token - Токен сессии
 * @returns {Promise<boolean>} - Результат проверки
 */
async function verifyAdminSession(telegramId, token) {
    try {
        // Валидируем входные данные
        const idValidation = validateTelegramId(telegramId);
        if (!idValidation.isValid) {
            return false;
        }
        
        if (!token || typeof token !== 'string') {
            return false;
        }
        
        // Проверяем сессию в хранилище
        const session = adminSessions.get(telegramId);
        if (!session) {
            return false;
        }
        
        // Проверяем, что токены совпадают
        if (session.token !== token) {
            return false;
        }
        
        // Проверяем, что сессия не истекла
        const currentTime = Date.now();
        if (currentTime > session.expiresAt) {
            // Удаляем истекшую сессию
            adminSessions.delete(telegramId);
            return false;
        }
        
        // Проверяем токен
        const tokenData = verifyAdminSessionToken(token);
        if (!tokenData || tokenData.adminId !== telegramId.toString()) {
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('Ошибка при проверке сессии администратора:', error);
        return false;
    }
}

/**
 * Удаляет сессию администратора
 * @param {number} telegramId - ID пользователя Telegram
 * @returns {boolean} - Результат операции
 */
function destroyAdminSession(telegramId) {
    try {
        const idValidation = validateTelegramId(telegramId);
        if (!idValidation.isValid) {
            return false;
        }
        
        const deleted = adminSessions.delete(idValidation.value);
        
        if (deleted) {
            console.log(`✅ Сессия для администратора ${idValidation.value} удалена`);
        }
        
        return deleted;
    } catch (error) {
        console.error('Ошибка при удалении сессии администратора:', error);
        return false;
    }
}

/**
 * Очищает истекшие сессии администраторов
 */
function cleanupExpiredSessions() {
    try {
        const currentTime = Date.now();
        let cleanedCount = 0;
        
        for (const [telegramId, session] of adminSessions.entries()) {
            if (currentTime > session.expiresAt) {
                adminSessions.delete(telegramId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`🧹 Очищено ${cleanedCount} истекших сессий администраторов`);
        }
        
        return cleanedCount;
    } catch (error) {
        console.error('Ошибка при очистке истекших сессий:', error);
        return 0;
    }
}

/**
 * Получает информацию о всех активных сессиях администраторов
 * @returns {Array} - Массив с информацией о сессиях
 */
function getActiveSessions() {
    try {
        const sessions = [];
        const currentTime = Date.now();
        
        for (const [telegramId, session] of adminSessions.entries()) {
            sessions.push({
                telegramId,
                createdAt: session.createdAt,
                expiresAt: session.expiresAt,
                timeLeft: Math.max(0, session.expiresAt - currentTime),
                isActive: currentTime <= session.expiresAt
            });
        }
        
        return sessions;
    } catch (error) {
        console.error('Ошибка при получении активных сессий:', error);
        return [];
    }
}

/**
 * Проверяет права администратора для выполнения действия
 * @param {number} telegramId - ID пользователя Telegram
 * @param {string} action - Действие для проверки
 * @returns {Promise<boolean>} - Результат проверки
 */
async function checkAdminPermission(telegramId, action = 'general') {
    try {
        // Проверяем, является ли пользователь администратором
        const isAdminUser = await isAdmin(telegramId);
        if (!isAdminUser) {
            return false;
        }
        
        // Здесь можно добавить дополнительную логику проверки прав
        // Например, проверку конкретных разрешений для разных действий
        
        // Пока разрешаем все действия для администраторов
        return true;
    } catch (error) {
        console.error('Ошибка при проверке прав администратора:', error);
        return false;
    }
}

/**
 * Получает статистику по администраторам
 * @returns {Promise<object>} - Статистика
 */
async function getAdminStats() {
    try {
        // Количество администраторов
        const adminCount = await new Promise((resolve, reject) => {
            db.get("SELECT COUNT(*) as count FROM admins", [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count);
                }
            });
        });
        
        // Количество активных сессий
        const activeSessionsCount = adminSessions.size;
        
        // Количество истекших сессий (будет очищено при следующем вызове cleanup)
        const expiredSessionsCount = cleanupExpiredSessions();
        
        return {
            totalAdmins: adminCount,
            activeSessions: activeSessionsCount,
            expiredSessions: expiredSessionsCount,
            lastCleanup: new Date().toISOString()
        };
    } catch (error) {
        console.error('Ошибка при получении статистики администраторов:', error);
        return {
            totalAdmins: 0,
            activeSessions: 0,
            expiredSessions: 0,
            lastCleanup: null,
            error: error.message
        };
    }
}

// Автоматическая очистка истекших сессий каждые 30 минут
setInterval(cleanupExpiredSessions, 30 * 60 * 1000);

module.exports = {
    isAdmin,
    verifyAdminPassword,
    createAdminSession,
    verifyAdminSession,
    destroyAdminSession,
    cleanupExpiredSessions,
    getActiveSessions,
    checkAdminPermission,
    getAdminStats
};