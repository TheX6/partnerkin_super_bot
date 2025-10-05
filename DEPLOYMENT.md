# 🚀 Деплой П-Тапалки на Vercel

## Пошаговая инструкция:

### 1. Подготовка
```bash
# Установите Vercel CLI (если нет)
npm install -g vercel

# Войдите в аккаунт (создайте на vercel.com если нет)
vercel login
```

### 2. Деплой проекта
```bash
# В папке проекта выполните:
cd /Users/username/partnerkin_super_bot
vercel

# Vercel спросит:
# Set up and deploy? → Yes
# Which scope? → Выберите ваш аккаунт
# Link to existing project? → No
# What's your project's name? → partnerkin-tap-game (или любое другое)
# In which directory is your code located? → ./ (текущая папка)
```

### 3. После деплоя
Vercel покажет URL вашего приложения, например:
```
https://partnerkin-tap-game.vercel.app
```

### 4. Обновите URL в боте
Замените в файле `app.js`:
```javascript
// Было:
{ text: '🎮 П-Тапалка', web_app: { url: 'https://your-domain.com/webapp/index.html' } }

// Стало:
{ text: '🎮 П-Тапалка', web_app: { url: 'https://your-actual-domain.vercel.app' } }
```

### 5. Альтернативные варианты хостинга:

#### Netlify:
1. Перетащите папку `webapp` на netlify.com
2. Получите URL типа: `https://name.netlify.app`

#### GitHub Pages:
1. Создайте репозиторий на GitHub
2. Загрузите файлы
3. Включите GitHub Pages в настройках
4. URL: `https://username.github.io/repo-name`

## 🔧 Настройка переменных окружения

Если нужны переменные окружения для Vercel:
```bash
vercel env add TELEGRAM_TOKEN
vercel env add DATABASE_PATH
```

## 📱 Тестирование
1. Откройте бота в Telegram
2. Перейдите в раздел "🎮 Развлечения"
3. Нажмите "🎮 П-Тапалка"
4. Должно открыться веб-приложение

## 🆘 Если что-то не работает:
- Проверьте URL в боте
- Убедитесь, что все файлы загружены
- Проверьте логи в Vercel Dashboard