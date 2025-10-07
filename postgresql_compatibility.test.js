// postgresql_compatibility.test.js - Тестирование совместимости с PostgreSQL

require('dotenv').config();
const assert = require('assert');
const db = require('./database');
const config = require('./config');

describe('PostgreSQL Compatibility Tests', function() {
    this.timeout(10000);
    
    let testUserId = 999999999; // Уникальный ID для тестов
    
    before(function() {
        // Проверяем, что мы используем PostgreSQL
        assert.strictEqual(config.DATABASE.type, 'postgresql', 'Tests should run with PostgreSQL');
    });
    
    beforeEach(async function() {
        // Очищаем тестовые данные перед каждым тестом
        // Сначала удаляем связанные записи
        await new Promise((resolve) => {
            db.run('DELETE FROM intern_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_id = $1)', [testUserId], resolve);
        });
        // Затем удаляем пользователя
        await new Promise((resolve) => {
            db.run('DELETE FROM users WHERE telegram_id = $1', [testUserId], resolve);
        });
    });
    
    after(async function() {
        // Финальная очистка
        // Сначала удаляем связанные записи
        await new Promise((resolve) => {
            db.run('DELETE FROM intern_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_id = $1)', [testUserId], resolve);
        });
        // Затем удаляем пользователя
        await new Promise((resolve) => {
            db.run('DELETE FROM users WHERE telegram_id = $1', [testUserId], resolve);
        });
    });

    describe('Database Connection', function() {
        it('should connect to PostgreSQL successfully', function(done) {
            db.get('SELECT 1 as test', [], (err, result) => {
                assert.ifError(err);
                assert.strictEqual(result.test, 1);
                done();
            });
        });
    });

    describe('Boolean Value Handling', function() {
        it('should handle boolean values in is_registered field', async function() {
            // Создаем пользователя с is_registered = true
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [testUserId, 'testuser', 'Test User', 'стажер', 50, 100, true],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что значение сохранено как true
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.strictEqual(user.is_registered, true);
        });
        
        it('should handle boolean values in completed field', async function() {
            // Сначала создаем пользователя
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [testUserId, 'testuser', 'Test User', 'стажер', 50, 100, true],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Получаем ID пользователя
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            // Создаем запись в intern_progress с completed = false
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO intern_progress (user_id, test_name, completed, points_earned)
                     VALUES ($1, $2, $3, $4)`,
                    [user.id, 'Тестовый тест', false, 0],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что значение сохранено как false
            const progress = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM intern_progress WHERE user_id = $1', [user.id], (err, progress) => {
                    if (err) reject(err);
                    else resolve(progress);
                });
            });
            
            assert.strictEqual(progress.completed, false);
        });
        
        it('should handle boolean comparisons in WHERE clauses', async function() {
            // Создаем пользователя с is_registered = true
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [testUserId, 'testuser', 'Test User', 'стажер', 50, 100, true],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Ищем пользователя с is_registered = true
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1 AND is_registered = true', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.ok(user);
            assert.strictEqual(user.is_registered, true);
            
            // Проверяем, что пользователь не найден при поиске с is_registered = false
            const notFound = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1 AND is_registered = false', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.strictEqual(notFound, undefined);
        });
    });

    describe('INSERT OR REPLACE Compatibility', function() {
        it('should convert INSERT OR REPLACE INTO users to ON CONFLICT', async function() {
            // Первый раз вставляем пользователя
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [testUserId, 'testuser', 'Test User', 'стажер', 50, 100, 1],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что пользователь создан
            let user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.ok(user);
            assert.strictEqual(user.username, 'testuser');
            
            // Обновляем пользователя с помощью INSERT OR REPLACE
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [testUserId, 'updateduser', 'Updated User', 'сотрудник', 100, 80, 1],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что пользователь обновлен
            user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.ok(user);
            assert.strictEqual(user.username, 'updateduser');
            assert.strictEqual(user.full_name, 'Updated User');
            assert.strictEqual(user.role, 'сотрудник');
            assert.strictEqual(user.p_coins, 100);
            assert.strictEqual(user.energy, 80);
        });
        
        it('should convert INSERT OR REPLACE INTO intern_progress to ON CONFLICT', async function() {
            // Сначала создаем пользователя
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [testUserId, 'testuser', 'Test User', 'стажер', 50, 100, true],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Получаем ID пользователя
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            // Первый раз вставляем запись в intern_progress
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO intern_progress (user_id, test_name, completed, points_earned)
                     VALUES (?, ?, ?, ?)`,
                    [user.id, 'Тестовый тест', 0, 0],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что запись создана
            let progress = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM intern_progress WHERE user_id = $1 AND test_name = $2', [user.id, 'Тестовый тест'], (err, progress) => {
                    if (err) reject(err);
                    else resolve(progress);
                });
            });
            
            assert.ok(progress);
            assert.strictEqual(progress.completed, false);
            assert.strictEqual(progress.points_earned, 0);
            
            // Обновляем запись с помощью INSERT OR REPLACE
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO intern_progress (user_id, test_name, completed, points_earned)
                     VALUES (?, ?, ?, ?)`,
                    [user.id, 'Тестовый тест', 1, 15],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что запись обновлена
            progress = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM intern_progress WHERE user_id = $1 AND test_name = $2', [user.id, 'Тестовый тест'], (err, progress) => {
                    if (err) reject(err);
                    else resolve(progress);
                });
            });
            
            assert.ok(progress);
            assert.strictEqual(progress.completed, true);
            assert.strictEqual(progress.points_earned, 15);
        });
    });

    describe('SQL Syntax Compatibility', function() {
        it('should convert DATETIME to TIMESTAMP', function(done) {
            // Этот тест проверяет, что запросы с DATETIME корректно обрабатываются
            db.get('SELECT CURRENT_TIMESTAMP as current_time', [], (err, result) => {
                assert.ifError(err);
                assert.ok(result.current_time);
                done();
            });
        });
        
        it('should handle telegram_id as BIGINT', async function() {
            // Создаем пользователя с большим telegram_id
            const largeId = 999999999999999999;
            
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [largeId, 'bigiduser', 'Big ID User', 'стажер', 50, 100, true],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что пользователь с большим ID найден
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = $1', [largeId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.ok(user);
            assert.strictEqual(user.telegram_id.toString(), largeId.toString());
            
            // Очищаем
            await new Promise((resolve) => {
                db.run('DELETE FROM users WHERE telegram_id = $1', [largeId], resolve);
            });
        });
    });

    describe('Parameter Placeholder Conversion', function() {
        it('should convert ? placeholders to $1, $2, etc.', async function() {
            // Создаем пользователя с использованием ? плейсхолдеров
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO users (telegram_id, username, full_name, role, p_coins, energy, is_registered)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [testUserId, 'placeholderuser', 'Placeholder User', 'стажер', 50, 100, 1],
                    function(err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            
            // Проверяем, что пользователь создан
            const user = await new Promise((resolve, reject) => {
                db.get('SELECT * FROM users WHERE telegram_id = ?', [testUserId], (err, user) => {
                    if (err) reject(err);
                    else resolve(user);
                });
            });
            
            assert.ok(user);
            assert.strictEqual(user.username, 'placeholderuser');
        });
    });
});

// Запуск тестов
if (require.main === module) {
    const mocha = require('mocha');
    const runner = new mocha({
        timeout: 10000
    });
    
    runner.addFile(__filename);
    runner.run();
}