require('dotenv').config();
const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const config = require('./config');

// Подключение к PostgreSQL
const pgClient = new Client({
  host: config.DATABASE.postgres.host,
  port: config.DATABASE.postgres.port,
  database: config.DATABASE.postgres.database,
  user: config.DATABASE.postgres.user,
  password: config.DATABASE.postgres.password
});

// Подключение к SQLite
const sqliteDb = new sqlite3.Database(config.DATABASE.name);

async function migrateData() {
  try {
    await pgClient.connect();
    console.log('✅ Подключено к PostgreSQL');

    // Миграция пользователей
    console.log('📦 Перенос пользователей...');
    const users = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM users', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const user of users) {
      await pgClient.query(`
        INSERT INTO users (
          telegram_id, username, full_name, role, p_coins, energy, 
          registration_date, contacts, is_registered, status, status_message, last_activity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (telegram_id) DO NOTHING`,
        [
          user.telegram_id, user.username, user.full_name, user.role, 
          user.p_coins, user.energy, user.registration_date, user.contacts, 
          user.is_registered, user.status, user.status_message, user.last_activity
        ]
      );
    }
    console.log(`✅ Перенесено ${users.length} пользователей`);

    // Миграция статистики тапалки
    console.log('📦 Перенос статистики тапалки...');
    const clickerStats = await new Promise((resolve, reject) => {
      sqliteDb.all('SELECT * FROM clicker_stats', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });

    for (const stat of clickerStats) {
      // Нужно получить ID пользователя в PostgreSQL по telegram_id
      const userResult = await pgClient.query('SELECT id FROM users WHERE telegram_id = $1', [stat.user_id]);
      if (userResult.rows.length > 0) {
        await pgClient.query(`
          INSERT INTO clicker_stats (user_id, total_clicks, last_click)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id) DO UPDATE SET
          total_clicks = $2, last_click = $3`,
          [userResult.rows[0].id, stat.total_clicks, stat.last_click]
        );
      }
    }
    console.log(`✅ Перенесена статистика для ${clickerStats.length} пользователей`);

    // Миграция остальных таблиц по аналогии...

    console.log('🎉 Все данные успешно перенесены в PostgreSQL!');
  } catch (err) {
    console.error('❌ Ошибка при миграции данных:', err);
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

// Запуск миграции данных
if (require.main === module) {
  migrateData();
}

module.exports = migrateData;