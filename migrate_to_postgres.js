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

async function createTables() {
  try {
    await client.connect();
    console.log('✅ Подключен к PostgreSQL');

    // Создание таблиц
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        full_name TEXT,
        role TEXT DEFAULT 'новичок',
        p_coins INTEGER DEFAULT 0,
        energy INTEGER DEFAULT 100,
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        contacts TEXT,
        is_registered INTEGER DEFAULT 0,
        status TEXT DEFAULT 'offline',
        status_message TEXT,
        last_activity TIMESTAMP
      )
    `);
    console.log('✅ Таблица users создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS clicker_stats (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        total_clicks INTEGER DEFAULT 0,
        last_click TIMESTAMP
      )
    `);
    console.log('✅ Таблица clicker_stats создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS intern_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        test_name TEXT,
        completed INTEGER DEFAULT 0,
        points_earned INTEGER DEFAULT 0,
        completed_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица intern_progress создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS test_submissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        telegram_id BIGINT,
        username TEXT,
        test_name TEXT,
        points_claimed INTEGER,
        photo_file_id TEXT,
        status TEXT DEFAULT 'pending',
        submitted_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        admin_id INTEGER,
        reviewed_date TIMESTAMP
      )
    `);
    console.log('✅ Таблица test_submissions создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        telegram_id BIGINT,
        granted_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица admins создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS battles (
        id SERIAL PRIMARY KEY,
        attacker_id INTEGER REFERENCES users(id),
        defender_id INTEGER REFERENCES users(id),
        winner_id INTEGER,
        points_won INTEGER,
        battle_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица battles создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        item_name TEXT,
        price INTEGER,
        purchase_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица purchases создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_slots (
        id SERIAL PRIMARY KEY,
        event_name TEXT,
        category TEXT,
        date TEXT,
        time TEXT,
        location TEXT,
        max_participants INTEGER DEFAULT 10,
        current_participants INTEGER DEFAULT 0,
        points_reward INTEGER DEFAULT 5,
        status TEXT DEFAULT 'active',
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица event_slots создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        slot_id INTEGER REFERENCES event_slots(id),
        booking_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица event_bookings создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS gifts (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id),
        receiver_id INTEGER REFERENCES users(id),
        amount INTEGER,
        message TEXT,
        gift_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица gifts создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vacation_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        telegram_id BIGINT,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        vacation_type TEXT DEFAULT 'основной',
        reason TEXT,
        days_count INTEGER,
        status TEXT DEFAULT 'pending',
        requested_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_date TIMESTAMP,
        reviewer_id INTEGER,
        reviewer_comment TEXT
      )
    `);
    console.log('✅ Таблица vacation_requests создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS vacation_balances (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        telegram_id BIGINT,
        year INTEGER,
        total_days INTEGER DEFAULT 28,
        used_days INTEGER DEFAULT 0,
        pending_days INTEGER DEFAULT 0,
        remaining_days INTEGER DEFAULT 28,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, year)
      )
    `);
    console.log('✅ Таблица vacation_balances создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER REFERENCES users(id),
        assignee_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT DEFAULT 'pending',
        priority TEXT DEFAULT 'medium',
        reward_coins INTEGER DEFAULT 0,
        due_date TIMESTAMP,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_date TIMESTAMP,
        cancelled_reason TEXT,
        postponed_until TIMESTAMP,
        last_action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица tasks создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        creator_id INTEGER REFERENCES users(id),
        company_name TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        quantity INTEGER DEFAULT 1,
        description TEXT,
        file_path TEXT,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        work_type TEXT,
        org_address TEXT,
        invoice_number INTEGER,
        invoice_date DATE DEFAULT CURRENT_DATE
      )
    `);
    console.log('✅ Таблица invoices создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_contacts (
        id SERIAL PRIMARY KEY,
        company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        position TEXT,
        email TEXT,
        phone TEXT,
        telegram TEXT,
        notes TEXT,
        added_by INTEGER REFERENCES users(id),
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица company_contacts создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES tasks(id),
        user_id INTEGER REFERENCES users(id),
        comment TEXT NOT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица task_comments создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievements (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        photo_file_id TEXT,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица achievements создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievement_likes (
        id SERIAL PRIMARY KEY,
        achievement_id INTEGER REFERENCES achievements(id),
        user_id INTEGER REFERENCES users(id),
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(achievement_id, user_id)
      )
    `);
    console.log('✅ Таблица achievement_likes создана');

    await client.query(`
      CREATE TABLE IF NOT EXISTS achievement_comments (
        id SERIAL PRIMARY KEY,
        achievement_id INTEGER REFERENCES achievements(id),
        user_id INTEGER REFERENCES users(id),
        comment TEXT NOT NULL,
        created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Таблица achievement_comments создана');

    console.log('🎉 Все таблицы успешно созданы!');
  } catch (err) {
    console.error('❌ Ошибка при создании таблиц:', err);
  } finally {
    await client.end();
  }
}

// Запуск миграции
createTables();