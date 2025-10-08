// envValidator.js - Модуль для валидации обязательных переменных окружения при запуске

/**
 * Проверяет наличие и валидность обязательных переменных окружения
 * @returns {object} - Результат валидации
 */
function validateEnvironment() {
    const result = {
        isValid: true,
        errors: [],
        warnings: [],
        missing: [],
        invalid: []
    };
    
    // Обязательные переменные окружения
    const requiredVars = [
        {
            name: 'TELEGRAM_TOKEN',
            description: 'Токен Telegram бота',
            validator: (value) => {
                if (!value || typeof value !== 'string') {
                    return false;
                }
                // Проверяем формат токена (обычно начинается с цифр и содержит двоеточие)
                return /^\d+:[a-zA-Z0-9_-]+$/.test(value);
            }
        },
        {
            name: 'ADMIN_PASSWORD',
            description: 'Пароль администратора',
            validator: (value) => {
                if (!value || typeof value !== 'string') {
                    return false;
                }
                // Проверяем минимальную длину
                return value.length >= 8;
            }
        }
    ];
    
    // Опциональные, но рекомендуемые переменные
    const recommendedVars = [
        {
            name: 'DB_TYPE',
            description: 'Тип базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                return ['postgresql'].includes(value);
            }
        },
        {
            name: 'DB_HOST',
            description: 'Хост базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                return typeof value === 'string' && value.length > 0;
            }
        },
        {
            name: 'DB_PORT',
            description: 'Порт базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                const port = parseInt(value);
                return !isNaN(port) && port > 0 && port <= 65535;
            }
        },
        {
            name: 'DB_NAME',
            description: 'Имя базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                return typeof value === 'string' && value.length > 0;
            }
        },
        {
            name: 'DB_USER',
            description: 'Пользователь базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                return typeof value === 'string' && value.length > 0;
            }
        },
        {
            name: 'DB_PASSWORD',
            description: 'Пароль базы данных',
            validator: (value) => {
                if (!value) return true; // Опционально
                return typeof value === 'string' && value.length > 0;
            }
        },
        {
            name: 'NODE_ENV',
            description: 'Режим работы приложения',
            validator: (value) => {
                if (!value) return true; // Опционально
                return ['development', 'production', 'test'].includes(value);
            }
        },
        {
            name: 'SESSION_SECRET',
            description: 'Секретный ключ для сессий',
            validator: (value) => {
                if (!value) return true; // Опционально
                return typeof value === 'string' && value.length >= 16;
            }
        },
        {
            name: 'BCRYPT_ROUNDS',
            description: 'Количество раундов для bcrypt',
            validator: (value) => {
                if (!value) return true; // Опционально
                const rounds = parseInt(value);
                return !isNaN(rounds) && rounds >= 10 && rounds <= 15;
            }
        }
    ];
    
    // Проверяем обязательные переменные
    for (const varInfo of requiredVars) {
        const value = process.env[varInfo.name];
        
        if (!value) {
            result.missing.push(varInfo.name);
            result.errors.push(`Отсутствует обязательная переменная окружения: ${varInfo.name} (${varInfo.description})`);
            result.isValid = false;
        } else if (!varInfo.validator(value)) {
            result.invalid.push({ name: varInfo.name, value });
            result.errors.push(`Невалидное значение переменной окружения: ${varInfo.name} (${varInfo.description})`);
            result.isValid = false;
        }
    }
    
    // Проверяем рекомендуемые переменные
    for (const varInfo of recommendedVars) {
        const value = process.env[varInfo.name];
        
        if (value && !varInfo.validator(value)) {
            result.invalid.push({ name: varInfo.name, value });
            result.warnings.push(`Рекомендуется проверить переменную окружения: ${varInfo.name} (${varInfo.description})`);
        }
    }
    
    // Специфические проверки безопасности
    if (process.env.ADMIN_PASSWORD === 'partnerkin1212') {
        result.warnings.push('⚠️ Используется пароль администратора по умолчанию! Рекомендуется изменить его.');
    }
    
    if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.length < 8) {
        result.warnings.push('⚠️ Пароль базы данных слишком короткий. Рекомендуется использовать надежный пароль.');
    }
    
    if (process.env.NODE_ENV === 'production') {
        // Дополнительные проверки для production
        if (!process.env.SESSION_SECRET) {
            result.warnings.push('⚠️ В production режиме рекомендуется установить SESSION_SECRET.');
        }
        
        if (process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_TOKEN.includes('test')) {
            result.warnings.push('⚠️ В production режиме используется тестовый токен Telegram.');
        }
    }
    
    return result;
}

/**
 * Выводит результаты валидации в консоль
 * @param {object} validationResult - Результат валидации
 */
function printValidationResult(validationResult) {
    console.log('🔍 Проверка переменных окружения...');
    console.log('=====================================');
    
    if (validationResult.isValid) {
        console.log('✅ Все обязательные переменные окружения настроены корректно');
    } else {
        console.log('❌ Обнаружены проблемы с переменными окружения:');
        console.log('');
        
        if (validationResult.missing.length > 0) {
            console.log('Отсутствующие переменные:');
            validationResult.missing.forEach(varName => {
                console.log(`  ❌ ${varName}`);
            });
            console.log('');
        }
        
        if (validationResult.invalid.length > 0) {
            console.log('Невалидные переменные:');
            validationResult.invalid.forEach(({ name, value }) => {
                console.log(`  ❌ ${name}: ${value ? `'${value}'` : 'пустое значение'}`);
            });
            console.log('');
        }
        
        console.log('Исправьте эти проблемы перед запуском приложения.');
    }
    
    if (validationResult.warnings.length > 0) {
        console.log('⚠️ Предупреждения безопасности:');
        validationResult.warnings.forEach(warning => {
            console.log(`  ${warning}`);
        });
        console.log('');
    }
    
    if (validationResult.isValid) {
        console.log('🎉 Готово к запуску!');
    }
}

/**
 * Проверяет переменные окружения и завершает процесс при ошибках
 */
function validateAndExit() {
    const result = validateEnvironment();
    printValidationResult(result);
    
    if (!result.isValid) {
        console.log('');
        console.log('❌ Приложение не может быть запущено из-за ошибок в конфигурации.');
        console.log('Пожалуйста, исправьте переменные окружения и попробуйте снова.');
        process.exit(1);
    }
}

/**
 * Получает информацию о конфигурации для мониторинга
 * @returns {object} - Информация о конфигурации
 */
function getConfigInfo() {
    return {
        nodeEnv: process.env.NODE_ENV || 'development',
        dbType: process.env.DB_TYPE || 'postgresql',
        hasTelegramToken: !!process.env.TELEGRAM_TOKEN,
        hasAdminPassword: !!process.env.ADMIN_PASSWORD,
        usesDefaultAdminPassword: process.env.ADMIN_PASSWORD === 'partnerkin1212',
        hasSessionSecret: !!process.env.SESSION_SECRET,
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS) || 12
    };
}

/**
 * Проверяет совместимость версий и зависимостей
 * @returns {object} - Результат проверки совместимости
 */
function checkCompatibility() {
    const result = {
        isCompatible: true,
        issues: []
    };
    
    // Проверяем версию Node.js
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    
    if (majorVersion < 14) {
        result.isCompatible = false;
        result.issues.push(`Требуется Node.js версии 14 или выше. Текущая версия: ${nodeVersion}`);
    }
    
    // Проверяем наличие необходимых пакетов
    try {
        require('bcrypt');
    } catch (error) {
        result.isCompatible = false;
        result.issues.push('Отсутствует пакет bcrypt. Установите его командой: npm install bcrypt');
    }
    
    try {
        require('validator');
    } catch (error) {
        result.isCompatible = false;
        result.issues.push('Отсутствует пакет validator. Установите его командой: npm install validator');
    }
    
    return result;
}

module.exports = {
    validateEnvironment,
    printValidationResult,
    validateAndExit,
    getConfigInfo,
    checkCompatibility
};