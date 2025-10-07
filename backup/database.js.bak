// database.js - Универсальный модуль для работы с базой данных (SQLite/PostgreSQL)

require('dotenv').config();
const config = require('./config');

let db;

// Определение типа базы данных
const dbType = config.DATABASE.type;

if (dbType === 'postgresql') {
    // Подключение к PostgreSQL
    const { Client } = require('pg');
    
    const client = new Client({
        host: config.DATABASE.postgres.host,
        port: config.DATABASE.postgres.port,
        database: config.DATABASE.postgres.database,
        user: config.DATABASE.postgres.user,
        password: config.DATABASE.postgres.password
    });

    // Подключаемся к базе данных
    client.connect()
        .then(() => {
            console.log('✅ Подключено к PostgreSQL');
        })
        .catch(err => {
            console.error('❌ Ошибка подключения к PostgreSQL:', err);
        });

    // Функция для преобразования запросов из SQLite в PostgreSQL формат
    function convertQuery(query, params) {
        let modifiedQuery = query;
        let modifiedParams = [...params];
        
        // Обработка специфических случаев для совместимости
        if (modifiedQuery.toUpperCase().includes('INSERT OR REPLACE INTO ADMINS')) {
            // Заменяем SQLite специфичный синтаксис на PostgreSQL
            modifiedQuery = modifiedQuery.replace(/INSERT OR REPLACE INTO ADMINS/gi, 'INSERT INTO admins');
            
            // Добавляем ON CONFLICT для таблицы admins
            if (!modifiedQuery.toUpperCase().includes('ON CONFLICT')) {
                modifiedQuery += ' ON CONFLICT (telegram_id) DO UPDATE SET user_id = EXCLUDED.user_id';
            }
            
            // Заменяем ? на $n
            const paramCount = (modifiedQuery.match(/\?/g) || []).length;
            for (let i = 0; i < paramCount; i++) {
                modifiedQuery = modifiedQuery.replace('?', `$${i + 1}`);
            }
            return { query: modifiedQuery, params: modifiedParams };
        }
        
        // Проверяем, есть ли в запросе ? (SQLite-плейсхолдеры)
        const questionMarkCount = (query.match(/\?/g) || []).length;
        
        if (questionMarkCount > 0) {
            // Это запрос с плейсхолдерами, заменяем ? на $n
            for (let i = 0; i < questionMarkCount; i++) {
                modifiedQuery = modifiedQuery.replace('?', `$${i + 1}`);
            }
        } else if (questionMarkCount === 0 && params.length > 0) {
            // Это запрос без ?, но с параметрами - может быть, встроенные значения в строке
            // В этой ситуации нужно быть осторожным, так как в запросе могут быть числа, 
            // которые не являются параметрами (например, в WHERE telegram_id = 12345)
            
            // Но если у нас есть параметры, и в запросе нет ?, это может быть ошибка использования
            // Поэтому просто вернем оригинальный запрос и параметры
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
    db = {
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
                            resolve(result.rows[0] || null);
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
        }
    };
} else {
    // Подключение к SQLite (по умолчанию)
    const sqlite3 = require('sqlite3').verbose();
    
    const sqlite = new sqlite3.Database(config.DATABASE.name);
    
    // Обертка для выполнения запросов
    db = {
        run: (query, params = [], callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            
            const promise = new Promise((resolve, reject) => {
                sqlite.run(query, params, function(err) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ lastID: this.lastID, changes: this.changes });
                    }
                });
            });
            
            if (callback) {
                promise.then(result => callback(null, result.lastID))
                      .catch(err => callback(err));
            }
            
            return promise;
        },
        get: (query, params = [], callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            
            const promise = new Promise((resolve, reject) => {
                sqlite.get(query, params, (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row);
                    }
                });
            });
            
            if (callback) {
                promise.then(row => callback(null, row))
                      .catch(err => callback(err, null));
            }
            
            return promise;
        },
        all: (query, params = [], callback) => {
            if (typeof params === 'function') {
                callback = params;
                params = [];
            }
            
            const promise = new Promise((resolve, reject) => {
                sqlite.all(query, params, (err, rows) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(rows);
                    }
                });
            });
            
            if (callback) {
                promise.then(rows => callback(null, rows))
                      .catch(err => callback(err, null));
            }
            
            return promise;
        },
        serialize: (callback) => {
            sqlite.serialize(callback);
        },
        end: (callback) => {
            sqlite.close(callback);
        }
    };
}

module.exports = db;