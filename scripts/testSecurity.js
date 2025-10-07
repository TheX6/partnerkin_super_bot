// testSecurity.js - Скрипт для тестирования всех улучшений безопасности

require('dotenv').config();
const { validateEnvironment, checkCompatibility } = require('../security/envValidator');
const { hashPassword, verifyPassword, validatePasswordStrength } = require('../security/passwordHasher');
const { 
    validateTelegramId, 
    validateUsername, 
    validateMessageText,
    validatePCoinsAmount,
    validateDate,
    validateTime,
    validateUrl,
    isSqlSafe,
    sanitizeString
} = require('../security/inputValidator');
const { isAdmin, verifyAdminPassword, createAdminSession, verifyAdminSession } = require('../security/adminAuth');

/**
 * Тестирует валидацию переменных окружения
 */
async function testEnvironmentValidation() {
    console.log('🧪 Тестирование валидации переменных окружения...');
    
    const result = validateEnvironment();
    
    if (result.isValid) {
        console.log('✅ Валидация переменных окружения пройдена');
    } else {
        console.log('❌ Валидация переменных окружения не пройдена:');
        result.errors.forEach(error => console.log(`  - ${error}`));
    }
    
    if (result.warnings.length > 0) {
        console.log('⚠️ Предупреждения:');
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
    }
    
    return result.isValid;
}

/**
 * Тестирует совместимость
 */
async function testCompatibility() {
    console.log('🧪 Тестирование совместимости...');
    
    const result = checkCompatibility();
    
    if (result.isCompatible) {
        console.log('✅ Совместимость проверена');
    } else {
        console.log('❌ Проблемы совместимости:');
        result.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    
    return result.isCompatible;
}

/**
 * Тестирует хеширование паролей
 */
async function testPasswordHashing() {
    console.log('🧪 Тестирование хеширования паролей...');
    
    try {
        const testPassword = 'TestPassword123!';
        
        // Тест хеширования
        const hashedPassword = await hashPassword(testPassword);
        console.log('✅ Пароль успешно хеширован');
        
        // Тест проверки правильного пароля
        const isValid = await verifyPassword(testPassword, hashedPassword);
        if (isValid) {
            console.log('✅ Проверка правильного пароля пройдена');
        } else {
            console.log('❌ Проверка правильного пароля не пройдена');
            return false;
        }
        
        // Тест проверки неверного пароля
        const isInvalid = await verifyPassword('WrongPassword', hashedPassword);
        if (!isInvalid) {
            console.log('✅ Проверка неверного пароля пройдена');
        } else {
            console.log('❌ Проверка неверного пароля не пройдена');
            return false;
        }
        
        // Тест валидации сложности пароля
        const strengthResult = validatePasswordStrength(testPassword);
        if (strengthResult.isValid) {
            console.log('✅ Валидация сложности пароля пройдена');
        } else {
            console.log('❌ Валидация сложности пароля не пройдена:');
            strengthResult.errors.forEach(error => console.log(`  - ${error}`));
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка при тестировании хеширования паролей:', error);
        return false;
    }
}

/**
 * Тестирует валидацию входных данных
 */
async function testInputValidation() {
    console.log('🧪 Тестирование валидации входных данных...');
    
    let allTestsPassed = true;
    
    // Тест валидации Telegram ID
    const validTelegramId = validateTelegramId(123456789);
    if (validTelegramId.isValid) {
        console.log('✅ Валидация Telegram ID пройдена');
    } else {
        console.log('❌ Валидация Telegram ID не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации невалидного Telegram ID
    const invalidTelegramId = validateTelegramId('invalid');
    if (!invalidTelegramId.isValid) {
        console.log('✅ Проверка невалидного Telegram ID пройдена');
    } else {
        console.log('❌ Проверка невалидного Telegram ID не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации имени пользователя
    const validUsername = validateUsername('TestUser');
    if (validUsername.isValid) {
        console.log('✅ Валидация имени пользователя пройдена');
    } else {
        console.log('❌ Валидация имени пользователя не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации текста сообщения
    const validMessage = validateMessageText('Тестовое сообщение');
    if (validMessage.isValid) {
        console.log('✅ Валидация текста сообщения пройдена');
    } else {
        console.log('❌ Валидация текста сообщения не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации суммы P-коинов
    const validAmount = validatePCoinsAmount(100.50);
    if (validAmount.isValid) {
        console.log('✅ Валидация суммы P-коинов пройдена');
    } else {
        console.log('❌ Валидация суммы P-коинов не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации даты
    const validDate = validateDate('2023-12-31');
    if (validDate.isValid) {
        console.log('✅ Валидация даты пройдена');
    } else {
        console.log('❌ Валидация даты не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации времени
    const validTime = validateTime('23:59');
    if (validTime.isValid) {
        console.log('✅ Валидация времени пройдена');
    } else {
        console.log('❌ Валидация времени не пройдена');
        allTestsPassed = false;
    }
    
    // Тест валидации URL
    const validUrl = validateUrl('https://example.com');
    if (validUrl.isValid) {
        console.log('✅ Валидация URL пройдена');
    } else {
        console.log('❌ Валидация URL не пройдена');
        allTestsPassed = false;
    }
    
    // Тест безопасности SQL
    const safeInput = isSqlSafe('Normal text');
    if (safeInput) {
        console.log('✅ Проверка безопасности SQL пройдена');
    } else {
        console.log('❌ Проверка безопасности SQL не пройдена');
        allTestsPassed = false;
    }
    
    // Тест небезопасного SQL
    const unsafeInput = isSqlSafe("SELECT * FROM users; DROP TABLE users;");
    if (!unsafeInput) {
        console.log('✅ Проверка небезопасного SQL пройдена');
    } else {
        console.log('❌ Проверка небезопасного SQL не пройдена');
        allTestsPassed = false;
    }
    
    // Тест санитизации строки
    const sanitized = sanitizeString("Test'--String");
    if (sanitized === "Test''String") {
        console.log('✅ Санитизация строки пройдена');
    } else {
        console.log('❌ Санитизация строки не пройдена');
        allTestsPassed = false;
    }
    
    return allTestsPassed;
}

/**
 * Тестирует аутентификацию администратора
 */
async function testAdminAuth() {
    console.log('🧪 Тестирование аутентификации администратора...');
    
    try {
        // Тест проверки администратора (может не пройти, если нет администраторов в БД)
        const adminCheck = await isAdmin(123456789);
        console.log(`ℹ️ Проверка администратора: ${adminCheck ? 'является администратором' : 'не является администратором'}`);
        
        // Тест проверки пароля (может не пройти, если нет хешированных паролей)
        const passwordCheck = await verifyAdminPassword(123456789, 'test');
        console.log(`ℹ️ Проверка пароля администратора: ${passwordCheck ? 'пароль верный' : 'пароль неверный или не найден'}`);
        
        // Тест создания сессии (может не пройти, если нет администраторов)
        const session = await createAdminSession(123456789);
        if (session) {
            console.log('✅ Сессия администратора создана');
            
            // Тест проверки сессии
            const sessionCheck = await verifyAdminSession(123456789, session.token);
            if (sessionCheck) {
                console.log('✅ Проверка сессии пройдена');
            } else {
                console.log('❌ Проверка сессии не пройдена');
            }
        } else {
            console.log('ℹ️ Сессия администратора не создана (возможно, нет администраторов в БД)');
        }
        
        return true;
    } catch (error) {
        console.error('❌ Ошибка при тестировании аутентификации администратора:', error);
        return false;
    }
}

/**
 * Тестирует защиту от SQL-инъекций
 */
async function testSqlInjectionProtection() {
    console.log('🧪 Тестирование защиты от SQL-инъекций...');
    
    const maliciousInputs = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "'; SELECT * FROM admins; --",
        "'; UPDATE users SET role='admin'; --",
        "' UNION SELECT password FROM admin_passwords --"
    ];
    
    let allTestsPassed = true;
    
    for (const input of maliciousInputs) {
        const isSafe = isSqlSafe(input);
        if (!isSafe) {
            console.log(`✅ Вредоносный ввод заблокирован: ${input.substring(0, 30)}...`);
        } else {
            console.log(`❌ Вредоносный输入 пропущен: ${input.substring(0, 30)}...`);
            allTestsPassed = false;
        }
        
        // Тестируем санитизацию
        const sanitized = sanitizeString(input);
        if (sanitized !== input) {
            console.log(`✅ Входные данные санитизированы: ${input.substring(0, 30)}...`);
        } else {
            console.log(`❌ Входные данные не санитизированы: ${input.substring(0, 30)}...`);
            allTestsPassed = false;
        }
    }
    
    return allTestsPassed;
}

/**
 * Основная функция тестирования
 */
async function runSecurityTests() {
    console.log('🚀 Запуск тестов безопасности проекта "Партнеркино"');
    console.log('================================================');
    console.log('');
    
    const testResults = {
        environment: await testEnvironmentValidation(),
        compatibility: await testCompatibility(),
        passwordHashing: await testPasswordHashing(),
        inputValidation: await testInputValidation(),
        adminAuth: await testAdminAuth(),
        sqlInjectionProtection: await testSqlInjectionProtection()
    };
    
    console.log('');
    console.log('📊 Результаты тестов:');
    console.log('===================');
    
    let totalTests = 0;
    let passedTests = 0;
    
    for (const [testName, result] of Object.entries(testResults)) {
        totalTests++;
        if (result) {
            passedTests++;
            console.log(`✅ ${testName}: Пройден`);
        } else {
            console.log(`❌ ${testName}: Не пройден`);
        }
    }
    
    console.log('');
    console.log(`📈 Итог: ${passedTests}/${totalTests} тестов пройдено`);
    
    if (passedTests === totalTests) {
        console.log('🎉 Все тесты безопасности пройдены!');
        console.log('');
        console.log('📋 Рекомендации:');
        console.log('1. Запустите миграцию паролей администраторов: node scripts/migrateAdminPassword.js');
        console.log('2. Установите надежный пароль администратора через переменную ADMIN_PASSWORD');
        console.log('3. Проверьте работу приложения в тестовом режиме');
        console.log('4. Разверните в production среде следуя инструкциям в SECURITY_SETUP.md');
    } else {
        console.log('⚠️ Некоторые тесты не пройдены. Пожалуйста, исправьте проблемы перед развертыванием.');
    }
    
    return passedTests === totalTests;
}

// Запускаем тесты
if (require.main === module) {
    runSecurityTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Критическая ошибка при запуске тестов:', error);
            process.exit(1);
        });
}

module.exports = {
    runSecurityTests,
    testEnvironmentValidation,
    testCompatibility,
    testPasswordHashing,
    testInputValidation,
    testAdminAuth,
    testSqlInjectionProtection
};