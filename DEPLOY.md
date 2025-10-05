# 🚀 Деплой Partnerkin Bot

## Быстрый деплой на Railway.app (Рекомендуется)

### 1. Подготовка
```bash
# Установи Railway CLI
npm install -g @railway/cli

# Логин в Railway
railway login
```

### 2. Деплой
```bash
# В папке проекта
railway deploy

# Установи переменные окружения
railway env set BOT_TOKEN=ваш_токен_бота
railway env set NODE_ENV=production
```

### 3. Настройка автодеплоя из GitHub
1. Создай репозиторий на GitHub
2. Залей код: `git push origin main`
3. В Railway подключи GitHub репозиторий
4. Включи автодеплой

## Альтернатива: Render.com

### 1. Создай новый Web Service на render.com
### 2. Подключи GitHub репозиторий
### 3. Настройки:
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**:
  - `BOT_TOKEN=ваш_токен`
  - `NODE_ENV=production`

### 4. Настрой keep-alive (опционально)
Создай бесплатный мониторинг на uptimerobot.com:
- URL: `https://your-app.onrender.com/ping`
- Интервал: 5 минут

## 📊 Мониторинг

### Health Check
- URL: `/health`
- Статус: JSON с информацией о сервисе

### Keep-Alive
- URL: `/ping`
- Ответ: `{"pong": timestamp}`

## 🔧 Переменные окружения

Обязательные:
- `BOT_TOKEN` - токен Telegram бота
- `NODE_ENV=production`

Опциональные:
- `PORT` - порт сервера (default: 3000)
- `DATABASE_URL` - URL базы данных (для PostgreSQL)

## 🗄️ База данных

По умолчанию используется SQLite файл.
Для продакшена рекомендуется PostgreSQL.

### Миграция на PostgreSQL:
1. Установи `pg`: `npm install pg`
2. Обнови `DATABASE_URL` в env
3. Адаптируй SQL запросы под PostgreSQL

## 🔄 Автоперезапуск

Встроен graceful shutdown и error handling.
Hosting платформы автоматически перезапускают при крашах.

## 📈 Масштабирование

При росте нагрузки:
1. Перейди на платный план хостинга
2. Используй внешнюю PostgreSQL
3. Добавь Redis для кеширования
4. Рассмотри микросервисную архитектуру