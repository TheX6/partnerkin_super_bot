require('dotenv').config();
const { Client } = require('pg');

// Подключение к PostgreSQL
const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  database: process.env.DB_NAME || 'partnerkino'
});

async function addUniqueConstraint() {
  try {
    await client.connect();
    console.log('✅ Подключен к PostgreSQL');

    // Добавляем уникальный констрейнт для таблицы intern_progress
    await client.query(`
      ALTER TABLE intern_progress 
      ADD CONSTRAINT intern_progress_user_id_test_name_unique 
      UNIQUE (user_id, test_name)
    `);
    console.log('✅ Уникальный констрейнт для intern_progress добавлен');

  } catch (err) {
    if (err.code === '42P07') {
      console.log('ℹ️ Констрейнт уже существует');
    } else {
      console.error('❌ Ошибка при добавлении констрейнта:', err);
    }
  } finally {
    await client.end();
  }
}

// Запуск скрипта
addUniqueConstraint();