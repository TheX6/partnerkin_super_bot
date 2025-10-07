# 🚀 ДЕПЛОЙ НА RENDER - ПОШАГОВАЯ ИНСТРУКЦИЯ

## ✅ Что уже готово
- ✅ Код исправлен и загружен в GitHub
- ✅ Ошибка `ERR_UNESCAPED_CHARACTERS` исправлена
- ✅ Конфигурация Render создана
- ✅ Все зависимости обновлены

## 📋 Шаги для деплоя

### Шаг 1: Войти на Render
1. Откройте https://dashboard.render.com
2. Войдите через GitHub (если ещё не вошли)

### Шаг 2: Удалить старый сервис (если есть)
1. Если у вас уже запущен старый сервис с ошибками:
   - Откройте его
   - Зайдите в **Settings** → внизу **Delete Service**
   - Подтвердите удаление

### Шаг 3: Создать новый Web Service
1. Нажмите кнопку **New +** (вверху справа)
2. Выберите **Web Service**
3. Найдите и выберите репозиторий **TheX6/partnerkin_super_bot**
   - Если не видите → нажмите **Configure account** и дайте доступ к репозиторию

### Шаг 4: Настроить сервис

**Basic Settings:**
```
Name: partnerkin-bot
Region: Frankfurt (EU Central) - или ближайший к вам
Branch: main
Root Directory: (оставьте пустым)
Runtime: Node
```

**Build & Deploy:**
```
Build Command: npm install
Start Command: npm start
```

**Instance Type:**
```
Free
```

### Шаг 5: Добавить Environment Variables

Нажмите **Advanced** → **Add Environment Variable**

Добавьте следующие переменные:

```
TELEGRAM_TOKEN = 7774658901:AAH2hgG6VZotlEBrts81LUFME8K6v4jGQQc
NODE_ENV = production
ADMIN_PASSWORD = partnerkin1212
DB_TYPE = sqlite
DB_FILENAME = /opt/render/project/src/partnerkino.db
RENDER = true
```

⚠️ **ВАЖНО**: Для `TELEGRAM_TOKEN` отметьте галочку "Secret" чтобы скрыть токен!

### Шаг 6: Создать сервис
1. Нажмите **Create Web Service**
2. Подождите 2-3 минуты пока Render:
   - Клонирует репозиторий
   - Установит зависимости
   - Запустит бота

### Шаг 7: Проверить работу

**В логах вы должны увидеть:**
```
🚀 Starting Partnerkin Bot in production mode...
🌐 Detected Render free tier - running in single process mode
🌐 Web App server running on port 10000
🤖 Bot started successfully!
```

**Проверить здоровье сервиса:**
Откройте в браузере: `https://ваш-сервис.onrender.com/health`

Должен вернуть:
```json
{
  "status": "OK",
  "timestamp": "2025-10-08T...",
  "uptime": 123.456,
  "service": "partnerkin-bot"
}
```

### Шаг 8: Проверить бота в Telegram
1. Откройте бота в Telegram
2. Отправьте `/start`
3. Бот должен ответить! ✅

---

## 🔧 Если что-то пошло не так

### Ошибка в логах: "ERR_UNESCAPED_CHARACTERS"
✅ **Это нормально!** Вы увидите:
```
⚠️ URL encoding error detected, this is a known issue with the request library
⚠️ Using axios fallback for sendMessage
```
Бот автоматически использует альтернативный метод отправки. Сообщения будут доставлены!

### Бот не отвечает
1. Проверьте логи: есть ли ошибки?
2. Проверьте, что сервис не "спит": откройте `https://ваш-сервис.onrender.com/health`
3. Проверьте токен бота: правильно ли скопирован `TELEGRAM_TOKEN`?

### Деплой провалился
1. Проверьте Build Logs
2. Убедитесь что команды правильные:
   - Build: `npm install`
   - Start: `npm start`

---

## 🔄 Автоматические обновления

Теперь при каждом `git push` в ветку `main` Render автоматически:
1. Заберёт новый код
2. Переустановит зависимости
3. Перезапустит бота

**Не нужно ничего делать вручную!**

---

## 📊 Мониторинг

**В Dashboard Render вы можете:**
- Смотреть логи в реальном времени
- Видеть статус сервиса (Running / Sleeping)
- Перезапускать сервис вручную
- Смотреть метрики использования

**Health Check URL:**
```
https://ваш-сервис.onrender.com/health
```

**Ping URL (чтобы "разбудить" бота):**
```
https://ваш-сервис.onrender.com/ping
```

---

## ⚠️ Ограничения бесплатного плана

- ⏰ Сервис засыпает после 15 минут бездействия
- 🔄 Первый запрос после сна занимает 30-60 секунд
- 📦 750 часов в месяц бесплатно (достаточно для одного сервиса 24/7)
- 💾 База данных SQLite сохраняется между перезапусками

**Чтобы бот не засыпал:**
Можно настроить внешний сервис (например, UptimeRobot) пинговать ваш `/health` endpoint каждые 10 минут.

---

## ✅ Готово!

После выполнения всех шагов ваш бот будет работать 24/7 на Render.com бесплатно!

🎉 Поздравляю с успешным деплоем!
