require('dotenv').config();
const { Client } = require('pg');
const config = require('./config');

const client = new Client({
    host: config.DATABASE.postgres.host,
    port: config.DATABASE.postgres.port,
    database: config.DATABASE.postgres.database,
    user: config.DATABASE.postgres.user,
    password: config.DATABASE.postgres.password
});

async function addUniqueConstraint() {
    try {
        await client.connect();
        console.log('✅ Подключен к PostgreSQL');
        
        // Проверим, существует ли уже уникальное ограничение
        const constraintCheck = await client.query(`
            SELECT constraint_name 
            FROM information_schema.table_constraints 
            WHERE table_name = 'admins' 
            AND constraint_type = 'UNIQUE'
            AND constraint_name LIKE '%telegram_id%'
        `);
        
        if (constraintCheck.rows.length > 0) {
            console.log('✅ Уникальное ограничение telegram_id уже существует');
        } else {
            console.log('Добавление уникального ограничения на telegram_id...');
            // Добавим уникальное ограничение
            await client.query('ALTER TABLE admins ADD CONSTRAINT admins_telegram_id_unique UNIQUE (telegram_id);');
            console.log('✅ Уникальное ограничение добавлено');
        }
        
        console.log('🎉 Готово! Теперь команда partnerkin1212 должна работать корректно.');
    } catch (err) {
        if (err.code === '42710') { // duplicate column
            console.log('✅ Уникальное ограничение уже существует');
        } else {
            console.error('❌ Ошибка:', err);
        }
    } finally {
        await client.end();
    }
}

addUniqueConstraint();