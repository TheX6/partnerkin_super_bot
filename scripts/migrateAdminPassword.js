// migrateAdminPassword.js - Скрипт для миграции пароля администратора в хешированный формат

require('dotenv').config();
const bcrypt = require('bcrypt');
const db = require('../database');
const { hashPassword } = require('../security/passwordHasher');

// Количество раундов соления
const SALT_ROUNDS = 12;

/**
 * Создает таблицу для хранения хешированных паролей администраторов
 */
async function createAdminPasswordsTable() {
    try {
        console.log('🔍 Проверка таблицы admin_passwords...');
        
        // Проверяем, существует ли таблица
        const tableExists = await new Promise((resolve, reject) => {
            // Проверяем тип базы данных
            const config = require('../config');
            const dbType = config.DATABASE.type;
            
            if (dbType === 'sqlite') {
                // Для SQLite используем sqlite_master
                db.get(`
                    SELECT name FROM sqlite_master
                    WHERE type='table' AND name='admin_passwords'
                `, [], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(!!row);
                    }
                });
            } else {
                // Для других СУБД используем стандартный подход
                db.get(`
                    SELECT table_name FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'admin_passwords'
                `, [], (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(!!row);
                    }
                });
            }
        });
        
        if (!tableExists) {
            console.log('📋 Создание таблицы admin_passwords...');
            await new Promise((resolve, reject) => {
                // Проверяем тип базы данных
                const config = require('../config');
                const dbType = config.DATABASE.type;
                
                let createTableQuery;
                if (dbType === 'sqlite') {
                    // Для SQLite
                    createTableQuery = `
                        CREATE TABLE admin_passwords (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            telegram_id BIGINT UNIQUE NOT NULL,
                            password_hash TEXT NOT NULL,
                            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `;
                } else {
                    // Для других СУБД
                    createTableQuery = `
                        CREATE TABLE admin_passwords (
                            id SERIAL PRIMARY KEY,
                            telegram_id BIGINT UNIQUE NOT NULL,
                            password_hash TEXT NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `;
                }
                
                db.run(createTableQuery, [], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            console.log('✅ Таблица admin_passwords создана');
        } else {
            console.log('✅ Таблица admin_passwords уже существует');
        }
    } catch (error) {
        console.error('❌ Ошибка при создании таблицы admin_passwords:', error);
        throw error;
    }
}

/**
 * Мигрирует текущий пароль администратора в хешированный формат
 */
async function migrateAdminPassword() {
    try {
        console.log('🔄 Начало миграции пароля администратора...');
        
        // Получаем текущий пароль из конфигурации
        const currentPassword = process.env.ADMIN_PASSWORD;

        if (!currentPassword) {
            console.log('⚠️ Внимание: используется пароль по умолчанию!');
            console.log('   Рекомендуется установить надежный пароль через переменную окружения ADMIN_PASSWORD');
        }
        
        // Хешируем пароль
        console.log('🔐 Хеширование пароля...');
        const hashedPassword = await hashPassword(currentPassword);
        console.log('✅ Пароль успешно хеширован');
        
        // Получаем всех администраторов
        console.log('👥 Получение списка администраторов...');
        const admins = await new Promise((resolve, reject) => {
            db.all('SELECT telegram_id FROM admins', [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
        
        if (admins.length === 0) {
            console.log('⚠️ Администраторы не найдены');
            return;
        }
        
        console.log(`📝 Найдено администраторов: ${admins.length}`);
        
        // Обновляем пароли для всех администраторов
        for (const admin of admins) {
            console.log(`🔄 Обновление пароля для администратора ${admin.telegram_id}...`);
            
            await new Promise((resolve, reject) => {
                db.run(`
                    INSERT INTO admin_passwords (telegram_id, password_hash, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                `, [admin.telegram_id, hashedPassword], (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
            
            console.log(`✅ Пароль для администратора ${admin.telegram_id} обновлен`);
        }
        
        console.log('🎉 Миграция паролей администраторов успешно завершена!');
        console.log('');
        console.log('📋 Рекомендации по дальнейшим действиям:');
        console.log('1. Установите надежный пароль через переменную окружения ADMIN_PASSWORD');
        console.log('2. Удалите или измените пароль по умолчанию в .env файле');
        console.log('3. Перезапустите приложение для применения изменений');
        console.log('4. Проверьте работу функции входа в админку');
        
    } catch (error) {
        console.error('❌ Ошибка при миграции пароля администратора:', error);
        throw error;
    }
}

/**
 * Проверяет, хеширован ли уже пароль администратора
 */
async function checkPasswordMigration() {
    try {
        console.log('🔍 Проверка статуса миграции...');
        
        const passwordExists = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM admin_passwords', [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row.count > 0);
                }
            });
        });
        
        if (passwordExists) {
            console.log('✅ Пароли администраторов уже мигрированы');
            return true;
        } else {
            console.log('⚠️ Пароли администраторов не мигрированы');
            return false;
        }
    } catch (error) {
        console.error('❌ Ошибка при проверке статуса миграции:', error);
        return false;
    }
}

/**
 * Откатывает миграцию (удаляет хешированные пароли)
 */
async function rollbackMigration() {
    try {
        console.log('🔄 Откат миграции...');
        
        await new Promise((resolve, reject) => {
            db.run('DELETE FROM admin_passwords', [], (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        console.log('✅ Миграция успешно откачена');
    } catch (error) {
        console.error('❌ Ошибка при откате миграции:', error);
        throw error;
    }
}

/**
 * Проверяет функциональность хеширования и проверки пароля
 */
async function testPasswordHashing() {
    try {
        console.log('🧪 Тестирование функциональности хеширования...');
        
        const testPassword = 'TestPassword123!';
        
        // Хешируем пароль
        const hashedPassword = await hashPassword(testPassword);
        console.log('✅ Пароль успешно хеширован');
        
        // Проверяем пароль
        const { verifyPassword } = require('../security/passwordHasher');
        const isValid = await verifyPassword(testPassword, hashedPassword);
        
        if (isValid) {
            console.log('✅ Проверка пароля прошла успешно');
        } else {
            console.log('❌ Ошибка проверки пароля');
            return false;
        }
        
        // Проверяем неверный пароль
        const isInvalid = await verifyPassword('WrongPassword', hashedPassword);
        
        if (!isInvalid) {
            console.log('✅ Проверка неверного пароля работает корректно');
        } else {
            console.log('❌ Ошибка: неверный пароль прошел проверку');
            return false;
        }
        
        console.log('🎉 Все тесты пройдены успешно!');
        return true;
    } catch (error) {
        console.error('❌ Ошибка при тестировании:', error);
        return false;
    }
}

// Основная функция
async function main() {
    try {
        console.log('🚀 Скрипт миграции паролей администраторов');
        console.log('=====================================');
        console.log('');
        
        // Проверяем функциональность хеширования
        const testPassed = await testPasswordHashing();
        if (!testPassed) {
            console.log('❌ Тесты не пройдены, миграция отменена');
            process.exit(1);
        }
        
        // Создаем таблицу для паролей
        await createAdminPasswordsTable();
        
        // Проверяем статус миграции
        const isMigrated = await checkPasswordMigration();
        
        if (isMigrated) {
            console.log('');
            console.log('⚠️ Пароли уже мигрированы. Доступные команды:');
            console.log('  node scripts/migrateAdminPassword.js --force  - Принудительная миграция');
            console.log('  node scripts/migrateAdminPassword.js --rollback - Откат миграции');
            
            // Проверяем флаги командной строки
            const args = process.argv.slice(2);
            
            if (args.includes('--force')) {
                console.log('🔄 Выполнение принудительной миграции...');
                await migrateAdminPassword();
            } else if (args.includes('--rollback')) {
                console.log('🔄 Выполнение отката миграции...');
                await rollbackMigration();
            } else {
                console.log('👍 Используйте флаги для выполнения нужных действий');
            }
        } else {
            // Выполняем миграцию
            await migrateAdminPassword();
        }
        
        console.log('');
        console.log('✅ Скрипт завершен успешно');
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    } finally {
        // Закрываем соединение с базой данных
        if (db.end) {
            db.end();
        }
    }
}

// Запускаем скрипт
if (require.main === module) {
    main();
}

module.exports = {
    createAdminPasswordsTable,
    migrateAdminPassword,
    checkPasswordMigration,
    rollbackMigration,
    testPasswordHashing
};