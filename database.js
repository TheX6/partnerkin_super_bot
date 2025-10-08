// database.js - Модуль для работы с базой данных PostgreSQL

require('dotenv').config();
const config = require('./config');
const { Client } = require('pg');

// Создаем клиент PostgreSQL
const client = new Client({
    host: config.DATABASE.host,
    port: config.DATABASE.port,
    database: config.DATABASE.database,
    user: config.DATABASE.user,
    password: config.DATABASE.password,
    ssl: config.DATABASE.ssl === 'true' ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: config.DATABASE.connectionTimeoutMillis
});

// Подключаемся к базе данных
client.connect()
    .then(() => {
        console.log('✅ Подключено к PostgreSQL');
    })
    .catch(err => {
        console.error('❌ Ошибка подключения к PostgreSQL:', err);
        process.exit(1);
    });

// Функция для преобразования запросов в PostgreSQL формат
function convertQuery(query, params) {
    let modifiedQuery = query;
    let modifiedParams = [...params];
    
    // Check if this is an INSERT or UPDATE query that needs boolean conversion
    const isInsertOrUpdate = modifiedQuery.trim().toUpperCase().startsWith('INSERT') ||
                            modifiedQuery.trim().toUpperCase().startsWith('UPDATE');
    
    // Convert boolean values in parameters for PostgreSQL compatibility
    // For INSERT/UPDATE queries, convert boolean values to 0/1 for INTEGER fields
    // For SELECT queries, keep boolean values as is for WHERE clause comparisons
    modifiedParams = modifiedParams.map((param, index) => {
        // For INSERT/UPDATE queries, convert boolean values to 0/1 for INTEGER fields
        if (isInsertOrUpdate && (param === true || param === false)) {
            return param === true ? 1 : 0;
        }
        // For SELECT queries or other cases, keep 0/1 as is
        // They will be handled in WHERE clause conversion below
        return param;
    });
    
    // Convert boolean values in WHERE clauses for PostgreSQL compatibility
    // Handle is_registered field
    modifiedQuery = modifiedQuery.replace(/\bis_registered\s*=\s*1\b/g, 'is_registered = true');
    modifiedQuery = modifiedQuery.replace(/\bis_registered\s*=\s*0\b/g, 'is_registered = false');
    
    // Handle completed field
    modifiedQuery = modifiedQuery.replace(/\bcompleted\s*=\s*1\b/g, 'completed = true');
    modifiedQuery = modifiedQuery.replace(/\bcompleted\s*=\s*0\b/g, 'completed = false');
    
    // Обработка INSERT OR REPLACE INTO для различных таблиц
    if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO')) {
        // Обработка для таблицы users
        if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO USERS')) {
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO USERS/gi, 'INSERT INTO users');
            
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (telegram_id) DO UPDATE SET ' +
                    'username = EXCLUDED.username, ' +
                    'full_name = EXCLUDED.full_name, ' +
                    'role = EXCLUDED.role, ' +
                    'p_coins = EXCLUDED.p_coins, ' +
                    'energy = EXCLUDED.energy, ' +
                    'is_registered = EXCLUDED.is_registered, ' +
                    'contacts = EXCLUDED.contacts, ' +
                    'status = EXCLUDED.status, ' +
                    'status_message = EXCLUDED.status_message, ' +
                    'last_activity = EXCLUDED.last_activity';
            }
        }
        // Обработка для таблицы admins
        else if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO ADMINS')) {
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO ADMINS/gi, 'INSERT INTO admins');
            
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (telegram_id) DO UPDATE SET ' +
                    'user_id = EXCLUDED.user_id, ' +
                    'granted_date = EXCLUDED.granted_date';
            }
        }
        // Обработка для таблицы intern_progress
        else if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO INTERN_PROGRESS')) {
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO INTERN_PROGRESS/gi, 'INSERT INTO intern_progress');
            
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (user_id, test_name) DO UPDATE SET ' +
                    'completed = EXCLUDED.completed, ' +
                    'points_earned = EXCLUDED.points_earned, ' +
                    'completed_date = EXCLUDED.completed_date';
            }
        }
        // Обработка для таблицы vacation_balances
        else if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO VACATION_BALANCES')) {
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO VACATION_BALANCES/gi, 'INSERT INTO vacation_balances');
            
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (user_id, telegram_id, year) DO UPDATE SET ' +
                    'total_days = EXCLUDED.total_days, ' +
                    'remaining_days = EXCLUDED.remaining_days, ' +
                    'used_days = EXCLUDED.used_days, ' +
                    'pending_days = EXCLUDED.pending_days';
            }
        }
        // Обработка для таблицы admin_passwords
        else if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO ADMIN_PASSWORDS')) {
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO ADMIN_PASSWORDS/gi, 'INSERT INTO admin_passwords');
            
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (telegram_id) DO UPDATE SET ' +
                    'password_hash = EXCLUDED.password_hash, ' +
                    'updated_at = EXCLUDED.updated_at';
            }
        }
        
        // Заменяем ? на $n для всех INSERT OR REPLACE случаев
        const paramCount = (modifiedQuery.match(/\?/g) || []).length;
        for (let i = 0; i < paramCount; i++) {
            modifiedQuery = modifiedQuery.replace('?', `$${i + 1}`);
        }
        return { query: modifiedQuery, params: modifiedParams };
    }
    
    // Проверяем, есть ли в запросе ? (плейсхолдеры)
    const questionMarkCount = (query.match(/\?/g) || []).length;
    
    if (questionMarkCount > 0) {
        // Это запрос с плейсхолдерами, заменяем ? на $n
        for (let i = 0; i < questionMarkCount; i++) {
            modifiedQuery = modifiedQuery.replace('?', `$${i + 1}`);
        }
    }
    
    // Заменяем SQLite-специфичные вещи
    modifiedQuery = modifiedQuery.replace(/DATETIME/g, 'TIMESTAMP');
    modifiedQuery = modifiedQuery.replace(/telegram_id INTEGER/g, 'telegram_id BIGINT');
    
    return { 
        query: modifiedQuery, 
        params: modifiedParams 
    };
}

// Обертка для выполнения запросов
const db = {
    run: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        try {
            const { query: convertedQuery, params: convertedParams } = convertQuery(query, params);
            
            // Для INSERT запросов добавляем RETURNING id при необходимости
            const isInsertQuery = convertedQuery.trim().toUpperCase().startsWith('INSERT');
            let queryWithReturning = convertedQuery;
            
            if (isInsertQuery && !convertedQuery.toUpperCase().includes('RETURNING') && 
                !convertedQuery.includes('ON CONFLICT')) {
                queryWithReturning = convertedQuery + ' RETURNING id';
            }
            
            const promise = new Promise((resolve, reject) => {
                client.query(queryWithReturning, convertedParams, (err, result) => {
                    if (err) {
                        console.error('❌ SQL Error:', err.message, '| Query:', queryWithReturning, '| Params:', convertedParams);
                        reject(err);
                    } else {
                        let lastID = null;
                        if (isInsertQuery && result?.rows?.[0]?.id !== undefined) {
                            lastID = result.rows[0].id;
                        }
                        resolve({ lastID: lastID, changes: result?.rowCount || 0 });
                    }
                });
            });
            
            if (callback) {
                promise.then(result => callback(null, result.lastID))
                      .catch(err => callback(err));
            }
            
            return promise;
        } catch (error) {
            console.error('❌ Error in db.run:', error);
            if (callback) callback(error);
            throw error;
        }
    },
    get: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        try {
            const { query: convertedQuery, params: convertedParams } = convertQuery(query, params);
            
            const promise = new Promise((resolve, reject) => {
                client.query(convertedQuery, convertedParams, (err, result) => {
                    if (err) {
                        console.error('❌ SQL Error:', err.message, '| Query:', convertedQuery, '| Params:', convertedParams);
                        reject(err);
                    } else {
                        // Convert null to undefined for consistency with SQLite behavior
                        const row = result.rows[0];
                        resolve(row || undefined);
                    }
                });
            });
            
            if (callback) {
                promise.then(row => callback(null, row))
                      .catch(err => callback(err, null));
            }
            
            return promise;
        } catch (error) {
            console.error('❌ Error in db.get:', error);
            if (callback) callback(error, null);
            throw error;
        }
    },
    all: (query, params = [], callback) => {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        
        try {
            const { query: convertedQuery, params: convertedParams } = convertQuery(query, params);
            
            const promise = new Promise((resolve, reject) => {
                client.query(convertedQuery, convertedParams, (err, result) => {
                    if (err) {
                        console.error('❌ SQL Error:', err.message, '| Query:', convertedQuery, '| Params:', convertedParams);
                        reject(err);
                    } else {
                        resolve(result.rows);
                    }
                });
            });
            
            if (callback) {
                promise.then(rows => callback(null, rows))
                      .catch(err => callback(err, null));
            }
            
            return promise;
        } catch (error) {
            console.error('❌ Error in db.all:', error);
            if (callback) callback(error, null);
            throw error;
        }
    },
    serialize: (callback) => {
        // PostgreSQL не требует сериализации, просто вызываем callback
        if (callback) callback();
    },
    end: (callback) => {
        // Закрываем соединение с PostgreSQL
        client.end(callback);
    },
    close: (callback) => {
        // Закрываем соединение с PostgreSQL (alias for end)
        client.end(callback);
    }
};

module.exports = db;