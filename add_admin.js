require('dotenv').config();
const db = require('./database');

async function addAdmin(telegramId, username = 'admin') {
  try {
    console.log(`Добавление администратора с telegram_id: ${telegramId}`);
    
    // Проверяем, существует ли пользователь
    const user = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
    
    if (!user) {
      console.log('Пользователь не найден. Создаю пользователя...');
      // Создаем пользователя с ролью 'старичок'
      await db.run(`
        INSERT INTO users (telegram_id, username, role, p_coins, energy, is_registered) 
        VALUES (?, ?, 'старичок', 1000, 100, 1)
      `, [telegramId, username]);
      
      // Получаем ID созданного пользователя
      const newUser = await db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId]);
      
      // Проверяем, существует ли запись, и если да - обновляем, если нет - вставляем
      const existingAdmin = await db.get('SELECT * FROM admins WHERE telegram_id = $1', [telegramId]);
      if (existingAdmin) {
        await db.run('UPDATE admins SET user_id = $1 WHERE telegram_id = $2', [newUser.id, telegramId]);
      } else {
        await db.run('INSERT INTO admins (user_id, telegram_id) VALUES ($1, $2)', [newUser.id, telegramId]);
      }
      console.log('✅ Администратор успешно добавлен!');
    } else {
      console.log(`Найден пользователь: ${user.full_name || user.username}, роль: ${user.role}`);
      
      // Если пользователь уже есть, но не 'старичок', обновим роль
      if (user.role !== 'старичок') {
        console.log('Обновление роли пользователя на "старичок"...');
        await db.run('UPDATE users SET role = ? WHERE telegram_id = ?', ['старичок', telegramId]);
      }
      
      // Проверяем, существует ли запись, и если да - обновляем, если нет - вставляем
      const existingAdmin = await db.get('SELECT * FROM admins WHERE telegram_id = $1', [telegramId]);
      if (existingAdmin) {
        await db.run('UPDATE admins SET user_id = $1 WHERE telegram_id = $2', [user.id, telegramId]);
      } else {
        await db.run('INSERT INTO admins (user_id, telegram_id) VALUES ($1, $2)', [user.id, telegramId]);
      }
      console.log('✅ Администратор успешно добавлен!');
    }
  } catch (err) {
    console.error('❌ Ошибка при добавлении администратора:', err);
  }
}

// Использование: node add_admin.js 123456789 username
// где 123456789 - telegram_id пользователя, username - имя пользователя

if (require.main === module) {
  if (process.argv.length < 3) {
    console.log('Использование: node add_admin.js <telegram_id> [username]');
    console.log('Пример: node add_admin.js 514881266 TheX6');
    process.exit(1);
  }
  
  const telegramId = parseInt(process.argv[2]);
  const username = process.argv[3] || 'admin';
  
  addAdmin(telegramId, username);
}

module.exports = addAdmin;