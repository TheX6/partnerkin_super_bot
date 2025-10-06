// inputValidator.js - Модуль для валидации входных данных и защиты от SQL-инъекций

const validator = require('validator');

/**
 * Очищает строку от потенциально опасных символов
 * @param {string} input - Входная строка
 * @returns {string} - Очищенная строка
 */
function sanitizeString(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    // Удаляем потенциально опасные символы
    return input
        .replace(/[\x00-\x1F\x7F]/g, '') // Удаляем управляющие символы
        .replace(/--/g, '') // Удаляем комментарии SQL
        .replace(/\/\*/g, '') // Удаляем начало многострочных комментариев
        .replace(/\*\//g, '') // Удаляем конец многострочных комментариев
        .replace(/;/g, '') // Удаляем разделитель запросов
        .replace(/'/g, "''") // Экранируем кавычки
        .replace(/"/g, '""') // Экранируем двойные кавычки
        .trim();
}

/**
 * Проверяет, является ли строка безопасной для SQL-запроса
 * @param {string} input - Входная строка
 * @returns {boolean} - Результат проверки
 */
function isSqlSafe(input) {
    if (typeof input !== 'string') {
        return false;
    }
    
    // Проверяем на наличие опасных SQL-паттернов
    const dangerousPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b)/i,
        /(--|\/\*|\*\/|;)/,
        /(\b(OR|AND)\s+\d+\s*=\s*\d+)/i,
        /(\b(OR|AND)\s+['"]?\w+['"]?\s*=\s*['"]?\w+['"]?)/i,
        /(\b(OR|AND)\s+['"]?\w+['"]?\s*LIKE\s*['"]?%?['"]?)/i
    ];
    
    return !dangerousPatterns.some(pattern => pattern.test(input));
}

/**
 * Валидирует и очищает ID пользователя Telegram
 * @param {number|string} telegramId - ID пользователя Telegram
 * @returns {object} - Результат валидации
 */
function validateTelegramId(telegramId) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    // Преобразуем в число, если это строка
    const id = typeof telegramId === 'string' ? parseInt(telegramId, 10) : telegramId;
    
    if (isNaN(id) || id <= 0) {
        result.error = 'ID пользователя Telegram должен быть положительным числом';
        return result;
    }
    
    // Проверяем, что ID не слишком большой (Telegram ID обычно до 2^53)
    if (id > Number.MAX_SAFE_INTEGER) {
        result.error = 'ID пользователя Telegram слишком большой';
        return result;
    }
    
    result.isValid = true;
    result.value = id;
    return result;
}

/**
 * Валидирует и очищает имя пользователя
 * @param {string} username - Имя пользователя
 * @returns {object} - Результат валидации
 */
function validateUsername(username) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    if (typeof username !== 'string') {
        result.error = 'Имя пользователя должно быть строкой';
        return result;
    }
    
    // Очищаем и проверяем имя пользователя
    const cleanUsername = sanitizeString(username);
    
    if (cleanUsername.length < 1) {
        result.error = 'Имя пользователя не может быть пустым';
        return result;
    }
    
    if (cleanUsername.length > 64) {
        result.error = 'Имя пользователя слишком длинное (максимум 64 символа)';
        return result;
    }
    
    // Проверяем на безопасность
    if (!isSqlSafe(cleanUsername)) {
        result.error = 'Имя пользователя содержит недопустимые символы';
        return result;
    }
    
    result.isValid = true;
    result.value = cleanUsername;
    return result;
}

/**
 * Валидирует и очищает текст сообщения
 * @param {string} text - Текст сообщения
 * @param {number} maxLength - Максимальная длина (по умолчанию 4096)
 * @returns {object} - Результат валидации
 */
function validateMessageText(text, maxLength = 4096) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    if (typeof text !== 'string') {
        result.error = 'Текст сообщения должен быть строкой';
        return result;
    }
    
    // Очищаем текст
    const cleanText = sanitizeString(text);
    
    if (cleanText.length === 0) {
        result.error = 'Текст сообщения не может быть пустым';
        return result;
    }
    
    if (cleanText.length > maxLength) {
        result.error = `Текст сообщения слишком длинный (максимум ${maxLength} символов)`;
        return result;
    }
    
    // Проверяем на безопасность
    if (!isSqlSafe(cleanText)) {
        result.error = 'Текст сообщения содержит недопустимые символы';
        return result;
    }
    
    result.isValid = true;
    result.value = cleanText;
    return result;
}

/**
 * Валидирует и очищает сумму в P-коинах
 * @param {number|string} amount - Сумма
 * @returns {object} - Результат валидации
 */
function validatePCoinsAmount(amount) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    // Преобразуем в число, если это строка
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(numAmount) || numAmount < 0) {
        result.error = 'Сумма должна быть неотрицательным числом';
        return result;
    }
    
    // Проверяем, что сумма не слишком большая
    if (numAmount > 1000000) {
        result.error = 'Сумма слишком большая (максимум 1000000 P-коинов)';
        return result;
    }
    
    // Проверяем, что сумма имеет не более 2 знаков после запятой
    if (numAmount * 100 !== Math.floor(numAmount * 100)) {
        result.error = 'Сумма может иметь не более 2 знаков после запятой';
        return result;
    }
    
    result.isValid = true;
    result.value = numAmount;
    return result;
}

/**
 * Валидирует и очищает дату
 * @param {string} dateString - Строка с датой
 * @returns {object} - Результат валидации
 */
function validateDate(dateString) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    if (typeof dateString !== 'string') {
        result.error = 'Дата должна быть строкой';
        return result;
    }
    
    // Проверяем формат даты (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        result.error = 'Дата должна быть в формате YYYY-MM-DD';
        return result;
    }
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
        result.error = 'Недействительная дата';
        return result;
    }
    
    // Проверяем, что дата не слишком старая или будущая
    const now = new Date();
    const minDate = new Date(now.getFullYear() - 5, 0, 1); // 5 лет назад
    const maxDate = new Date(now.getFullYear() + 5, 11, 31); // 5 лет вперед
    
    if (date < minDate || date > maxDate) {
        result.error = 'Дата выходит за допустимый диапазон';
        return result;
    }
    
    result.isValid = true;
    result.value = dateString;
    return result;
}

/**
 * Валидирует и очищает время
 * @param {string} timeString - Строка со временем
 * @returns {object} - Результат валидации
 */
function validateTime(timeString) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    if (typeof timeString !== 'string') {
        result.error = 'Время должно быть строкой';
        return result;
    }
    
    // Проверяем формат времени (HH:MM)
    if (!/^\d{2}:\d{2}$/.test(timeString)) {
        result.error = 'Время должно быть в формате HH:MM';
        return result;
    }
    
    const [hours, minutes] = timeString.split(':').map(Number);
    
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        result.error = 'Недействительное время';
        return result;
    }
    
    result.isValid = true;
    result.value = timeString;
    return result;
}

/**
 * Валидирует и очищает URL
 * @param {string} url - URL
 * @returns {object} - Результат валидации
 */
function validateUrl(url) {
    const result = {
        isValid: false,
        value: null,
        error: null
    };
    
    if (typeof url !== 'string') {
        result.error = 'URL должен быть строкой';
        return result;
    }
    
    // Проверяем с помощью validator
    if (!validator.isURL(url, { 
        protocols: ['http', 'https'],
        require_protocol: true,
        allow_underscores: false
    })) {
        result.error = 'Недействительный URL';
        return result;
    }
    
    // Проверяем длину URL
    if (url.length > 2048) {
        result.error = 'URL слишком длинный (максимум 2048 символов)';
        return result;
    }
    
    result.isValid = true;
    result.value = url;
    return result;
}

/**
 * Создает безопасный параметр для SQL-запроса
 * @param {any} value - Значение параметра
 * @returns {any} - Безопасное значение параметра
 */
function createSafeParameter(value) {
    if (value === null || value === undefined) {
        return null;
    }
    
    if (typeof value === 'string') {
        return sanitizeString(value);
    }
    
    if (typeof value === 'number') {
        if (isNaN(value) || !isFinite(value)) {
            return null;
        }
        return value;
    }
    
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    
    // Для других типов преобразуем в строку и очищаем
    return sanitizeString(String(value));
}

module.exports = {
    sanitizeString,
    isSqlSafe,
    validateTelegramId,
    validateUsername,
    validateMessageText,
    validatePCoinsAmount,
    validateDate,
    validateTime,
    validateUrl,
    createSafeParameter
};