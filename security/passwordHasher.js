// passwordHasher.js - Модуль для безопасного хеширования паролей с использованием bcrypt

const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Количество раундов соления (рекомендуется 12 или более)
const SALT_ROUNDS = 12;

/**
 * Безопасно хеширует пароль с использованием bcrypt
 * @param {string} password - Пароль для хеширования
 * @returns {Promise<string>} - Хешированный пароль
 */
async function hashPassword(password) {
    try {
        // Проверяем, что пароль является строкой
        if (typeof password !== 'string') {
            throw new Error('Пароль должен быть строкой');
        }
        
        // Проверяем минимальную длину пароля
        if (password.length < 8) {
            throw new Error('Пароль должен содержать минимум 8 символов');
        }
        
        // Генерируем соль и хешируем пароль
        const salt = await bcrypt.genSalt(SALT_ROUNDS);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        return hashedPassword;
    } catch (error) {
        console.error('Ошибка при хешировании пароля:', error);
        throw error;
    }
}

/**
 * Проверяет соответствие пароля его хешу
 * @param {string} password - Пароль для проверки
 * @param {string} hashedPassword - Хешированный пароль
 * @returns {Promise<boolean>} - Результат проверки
 */
async function verifyPassword(password, hashedPassword) {
    try {
        // Проверяем, что оба параметра являются строками
        if (typeof password !== 'string' || typeof hashedPassword !== 'string') {
            return false;
        }
        
        // Сравниваем пароль с хешем
        const isMatch = await bcrypt.compare(password, hashedPassword);
        return isMatch;
    } catch (error) {
        console.error('Ошибка при проверке пароля:', error);
        return false;
    }
}

/**
 * Генерирует случайный токен для сброса пароля
 * @param {number} length - Длина токена (по умолчанию 32)
 * @returns {string} - Случайный токен
 */
function generateResetToken(length = 32) {
    try {
        return crypto.randomBytes(length).toString('hex');
    } catch (error) {
        console.error('Ошибка при генерации токена:', error);
        throw error;
    }
}

/**
 * Проверяет сложность пароля
 * @param {string} password - Пароль для проверки
 * @returns {object} - Результат проверки с информацией о проблемах
 */
function validatePasswordStrength(password) {
    const result = {
        isValid: true,
        errors: []
    };
    
    if (typeof password !== 'string') {
        result.isValid = false;
        result.errors.push('Пароль должен быть строкой');
        return result;
    }
    
    if (password.length < 8) {
        result.isValid = false;
        result.errors.push('Пароль должен содержать минимум 8 символов');
    }
    
    if (!/[A-Z]/.test(password)) {
        result.isValid = false;
        result.errors.push('Пароль должен содержать хотя бы одну заглавную букву');
    }
    
    if (!/[a-z]/.test(password)) {
        result.isValid = false;
        result.errors.push('Пароль должен содержать хотя бы одну строчную букву');
    }
    
    if (!/\d/.test(password)) {
        result.isValid = false;
        result.errors.push('Пароль должен содержать хотя бы одну цифру');
    }
    
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        result.isValid = false;
        result.errors.push('Пароль должен содержать хотя бы один специальный символ');
    }
    
    return result;
}

/**
 * Создает временный токен для входа в админку
 * @param {string} adminId - ID администратора
 * @param {number} expiresIn - Время жизни токена в секундах (по умолчанию 3600)
 * @returns {object} - Объект с токеном и временем истечения
 */
function createAdminSessionToken(adminId, expiresIn = 3600) {
    try {
        const timestamp = Date.now();
        const expiresAt = timestamp + (expiresIn * 1000);
        const randomData = crypto.randomBytes(16).toString('hex');
        
        const tokenData = `${adminId}:${timestamp}:${randomData}`;
        const token = Buffer.from(tokenData).toString('base64');
        
        return {
            token: token,
            expiresAt: expiresAt
        };
    } catch (error) {
        console.error('Ошибка при создании токена сессии:', error);
        throw error;
    }
}

/**
 * Проверяет валидность токена сессии администратора
 * @param {string} token - Токен сессии
 * @returns {object|null} - Данные токена или null если невалидный
 */
function verifyAdminSessionToken(token) {
    try {
        if (!token || typeof token !== 'string') {
            return null;
        }
        
        const tokenData = Buffer.from(token, 'base64').toString('utf8');
        const parts = tokenData.split(':');
        
        if (parts.length !== 3) {
            return null;
        }
        
        const [adminId, timestamp] = parts;
        const currentTime = Date.now();
        
        // Проверяем, что токен не истек (по умолчанию 1 час)
        if (currentTime - parseInt(timestamp) > 3600000) {
            return null;
        }
        
        return {
            adminId: adminId,
            timestamp: parseInt(timestamp)
        };
    } catch (error) {
        console.error('Ошибка при проверке токена сессии:', error);
        return null;
    }
}

module.exports = {
    hashPassword,
    verifyPassword,
    generateResetToken,
    validatePasswordStrength,
    createAdminSessionToken,
    verifyAdminSessionToken,
    SALT_ROUNDS
};