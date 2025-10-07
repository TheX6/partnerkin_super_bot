# Деплой на Render.com (бесплатный план)

## Быстрый старт

### 1. Подготовка репозитория
✅ Репозиторий уже настроен и готов к деплою!

### 2. Создание сервиса на Render

1. Зайдите на [render.com](https://render.com) и авторизуйтесь через GitHub
2. Нажмите **New** → **Web Service**
3. Подключите репозиторий `TheX6/partnerkin_super_bot`
4. Настройте параметры:
   - **Name**: `partnerkin-bot` (или любое другое имя)
   - **Region**: выберите ближайший регион
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### 3. Настройка переменных окружения

В разделе **Environment Variables** добавьте:

```
TELEGRAM_TOKEN=7774658901:AAH2hgG6VZotlEBrts81LUFME8K6v4jGQQc
NODE_ENV=production
ADMIN_PASSWORD=partnerkin1212
DB_TYPE=sqlite
DB_FILENAME=/opt/render/project/src/partnerkino.db
RENDER=true
```

### 4. Деплой

Нажмите **Create Web Service** - Render автоматически:
- Склонирует репозиторий
- Установит зависимости (`npm install`)
- Запустит бота (`npm start`)

### 5. Мониторинг

После деплоя вы можете:
- Смотреть логи в реальном времени на странице сервиса
- Проверить health check по адресу `https://ваш-сервис.onrender.com/health`

## Особенности бесплатного плана

⚠️ **Важно**:
- Бесплатный сервис засыпает после 15 минут бездействия
- При первом запросе после сна сервис "просыпается" (может занять 30-60 секунд)
- База данных SQLite сохраняется между перезапусками

## Обновление бота

Render автоматически перезапускает бот при push в ветку `main`:

```bash
git add .
git commit -m "Update bot"
git push origin main
```

## Устранение неполадок

### Бот не отвечает
1. Проверьте логи в Dashboard Render
2. Убедитесь, что сервис не спит (откройте URL в браузере)
3. Проверьте переменные окружения

### Ошибки при деплое
1. Проверьте Build Logs
2. Убедитесь, что все зависимости указаны в `package.json`

### Перезапуск вручную
В Dashboard → Settings → Manual Deploy → Deploy latest commit

## Исправление ошибки ERR_UNESCAPED_CHARACTERS

✅ **Уже исправлено!** Бот использует axios как fallback для отправки кириллических сообщений.

Если видите в логах:
```
⚠️ URL encoding error detected, this is a known issue with the request library
⚠️ Using axios fallback for sendMessage
```

Это нормально - бот автоматически переключается на axios при возникновении проблемы.
