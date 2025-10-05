# 🚂 Пошаговый деплой на Railway.app

## Шаг 1: Создание аккаунта Railway

1. **Перейди на** [railway.app](https://railway.app)
2. **Нажми "Login"** и зарегистрируйся через GitHub
3. **Верифицируй email** если потребуется

## Шаг 2: Создание нового проекта

1. **Нажми "New Project"**
2. **Выбери "Deploy from GitHub repo"**
3. **Если репозитория нет - создай:**
   ```bash
   # В папке проекта
   git init
   git add .
   git commit -m "Initial commit: Partnerkin Bot"
   git branch -M main

   # Создай репозиторий на GitHub и замени URL
   git remote add origin https://github.com/твой_username/partnerkin-bot.git
   git push -u origin main
   ```

## Шаг 3: Подключение репозитория

1. **Выбери свой репозиторий** из списка
2. **Railway автоматически начнет деплой**
3. **Дождись завершения** (2-3 минуты)

## Шаг 4: Настройка Environment Variables

В разделе **Variables** добавь:

**Обязательные:**
- `BOT_TOKEN` = твой_токен_от_BotFather
- `NODE_ENV` = production

**Опциональные:**
- `PORT` = 3000 (если не указан)

## Шаг 5: Проверка деплоя

1. **Перейди во вкладку "Deployments"**
2. **Проверь логи** - должно быть:
   ```
   🚀 Starting Partnerkin Bot in production mode...
   🌐 Web App server running on port 3000
   🚀 База данных готова к работе!
   🚀 Бот "Жизнь в Партнеркине" запускается...
   ```

3. **Открой URL домена** (будет вида: `your-app.railway.app`)
4. **Проверь** `/health` endpoint

## Шаг 6: Настройка мониторинга

1. **Скопируй URL** твоего Railway приложения
2. **Перейди на** [uptimerobot.com](https://uptimerobot.com)
3. **Создай новый монитор:**
   - URL: `https://your-app.railway.app/ping`
   - Интервал: 5 минут
   - Алерты: email/telegram

## 🎯 Результат

✅ **Бот работает 24/7**
✅ **Автоперезапуск при крашах**
✅ **500 часов/месяц бесплатно**
✅ **Автодеплой при пуше в GitHub**
✅ **Мониторинг uptime**

## 🚨 Важные заметки

- **База данных**: SQLite файл будет пересоздаваться при каждом деплое
- **Для продакшена**: рекомендуется добавить PostgreSQL из Railway
- **Логи**: доступны в разделе "Logs"
- **Ресурсы**: отслеживай использование в "Metrics"

## 💡 Если что-то пошло не так

1. **Проверь логи** в Railway Dashboard
2. **Убедись что BOT_TOKEN** правильный
3. **Проверь /health** endpoint
4. **Перезапусти деплой** кнопкой "Redeploy"

---

**После успешного деплоя твой бот будет доступен 24/7!** 🎉