require('dotenv').config();
const db = require('./database');
const config = require('./config');

async function testPostgreSQLFixes() {
    console.log('🧪 Testing PostgreSQL Compatibility Fixes...\n');
    
    // Проверяем, что мы используем PostgreSQL
    if (config.DATABASE.type !== 'postgresql') {
        console.error('❌ Tests should run with PostgreSQL');
        return;
    }
    
    const testUserId = 999999999; // Уникальный ID для тестов
    
    try {
        // Тест 1: Проверка подключения
        console.log('1. Testing database connection...');
        const result = await new Promise((resolve, reject) => {
            db.get('SELECT 1 as test', [], (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });
        console.log('✅ Database connection successful');
        
        // Очищаем тестовые данные
        console.log('\n2. Cleaning up test data...');
        await new Promise((resolve) => {
            db.run('DELETE FROM intern_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_id = $1)', [testUserId], resolve);
        });
        await new Promise((resolve) => {
            db.run('DELETE FROM users WHERE telegram_id = $1', [testUserId], resolve);
        });
        console.log('✅ Test data cleaned');
        
        // Тест 2: Проверка обработки boolean значений в is_registered
        console.log('\n3. Testing boolean values in is_registered field...');
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
        
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (user && user.is_registered === true) {
            console.log('✅ Boolean value in is_registered field handled correctly');
        } else {
            console.log('❌ Boolean value in is_registered field not handled correctly');
        }
        
        // Тест 3: Проверка обработки boolean значений в completed
        console.log('\n4. Testing boolean values in completed field...');
        const userRecord = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO intern_progress (user_id, test_name, completed, points_earned)
                 VALUES ($1, $2, $3, $4)`,
                [userRecord.id, 'Тестовый тест', false, 0],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        
        const progress = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM intern_progress WHERE user_id = $1', [userRecord.id], (err, progress) => {
                if (err) reject(err);
                else resolve(progress);
            });
        });
        
        if (progress && progress.completed === false) {
            console.log('✅ Boolean value in completed field handled correctly');
        } else {
            console.log('❌ Boolean value in completed field not handled correctly');
        }
        
        // Тест 4: Проверка сравнений boolean в WHERE
        console.log('\n5. Testing boolean comparisons in WHERE clauses...');
        const foundUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE telegram_id = $1 AND is_registered = true', [testUserId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (foundUser && foundUser.is_registered === true) {
            console.log('✅ Boolean comparison in WHERE clause handled correctly');
        } else {
            console.log('❌ Boolean comparison in WHERE clause not handled correctly');
        }
        
        const notFoundUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE telegram_id = $1 AND is_registered = false', [testUserId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (notFoundUser === undefined) {
            console.log('✅ Non-matching boolean comparison returns undefined');
        } else {
            console.log('❌ Non-matching boolean comparison does not return undefined');
        }
        
        // Тест 5: Проверка INSERT OR REPLACE для users
        console.log('\n6. Testing INSERT OR REPLACE INTO users...');
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
        
        const updatedUser = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE telegram_id = $1', [testUserId], (err, user) => {
                if (err) reject(err);
                else resolve(user);
            });
        });
        
        if (updatedUser && updatedUser.username === 'updateduser' && updatedUser.p_coins === 100) {
            console.log('✅ INSERT OR REPLACE INTO users converted correctly');
        } else {
            console.log('❌ INSERT OR REPLACE INTO users not converted correctly');
        }
        
        // Тест 6: Проверка INSERT OR REPLACE для intern_progress
        console.log('\n7. Testing INSERT OR REPLACE INTO intern_progress...');
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT OR REPLACE INTO intern_progress (user_id, test_name, completed, points_earned)
                 VALUES (?, ?, ?, ?)`,
                [userRecord.id, 'Тестовый тест', 1, 15],
                function(err) {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
        
        const updatedProgress = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM intern_progress WHERE user_id = $1 AND test_name = $2', [userRecord.id, 'Тестовый тест'], (err, progress) => {
                if (err) reject(err);
                else resolve(progress);
            });
        });
        
        if (updatedProgress && updatedProgress.completed === true && updatedProgress.points_earned === 15) {
            console.log('✅ INSERT OR REPLACE INTO intern_progress converted correctly');
        } else {
            console.log('❌ INSERT OR REPLACE INTO intern_progress not converted correctly');
        }
        
        // Финальная очистка
        console.log('\n8. Final cleanup...');
        await new Promise((resolve) => {
            db.run('DELETE FROM intern_progress WHERE user_id IN (SELECT id FROM users WHERE telegram_id = $1)', [testUserId], resolve);
        });
        await new Promise((resolve) => {
            db.run('DELETE FROM users WHERE telegram_id = $1', [testUserId], resolve);
        });
        console.log('✅ Cleanup completed');
        
        console.log('\n🎉 All tests completed!');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
    }
}

// Запуск тестов
testPostgreSQLFixes();