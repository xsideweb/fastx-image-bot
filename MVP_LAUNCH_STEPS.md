# Запуск MVP — AI Image Bot (Telegram Mini App)

Пошаговый план от текущего состояния до работающего MVP в Telegram.

---

## Этап 1. Подготовка репозитория и окружения

### 1.1 Создать репозиторий на GitHub
- [GitHub](https://github.com/new) → New repository (например, `ai-image-bot`).
- Не добавлять README/.gitignore, если код уже есть локально.

### 1.2 Инициализировать Git и залить код (если ещё не сделано)
```bash
cd "c:\Work\AI Image Bot"
git init
git add .
git commit -m "Initial: Mini App + Nano Banana backend"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/ai-image-bot.git
git push -u origin main
```

### 1.3 Не коммитить секреты
- Убедиться, что `backend/.env` в `.gitignore`.
- Создать `backend/.env.example` с подсказками (без реальных ключей):
  ```
  NANO_BANANA_API_KEY=your_key_from_nanobananaapi.ai
  BASE_URL=https://your-app.up.railway.app
  PORT=3000
  ```

---

## Этап 2. Telegram-бот и Mini App

### 2.1 Создать бота (если ещё нет)
- Открыть [@BotFather](https://t.me/BotFather) в Telegram.
- `/newbot` → имя и username (например, `Xside AI Bot` → `xside_ai_bot`).
- Сохранить **токен** (например, `7123456789:AAH...`).

### 2.2 Привязать Mini App к боту
- В BotFather: `/mybots` → выбрать бота → **Bot Settings** → **Menu Button** или **Configure**.
- Либо команда: `/setmenubutton` → выбрать бота → ввести URL (см. шаг 3.4) и текст кнопки, например «Открыть приложение».

После деплоя на Railway URL будет вида: `https://ваш-проект.up.railway.app`.

---

## Этап 3. Деплой на Railway

### 3.1 Регистрация и проект
- Зайти на [railway.app](https://railway.app), войти через GitHub.
- **New Project** → **Deploy from GitHub repo**.
- Выбрать репозиторий `ai-image-bot` (или как назвали).

### 3.2 Настройка сервиса
- Railway создаст сервис по репозиторию. Нужно указать:
  - **Root Directory:** оставить корень или указать папку, где лежит `package.json` бэкенда.
  - Если фронт и бэк в одном репо: корень — там, где есть и `server.js`, и `index.html`. Тогда в проекте должен быть один `package.json` в корне с `"main": "backend/server.js"` или скрипт старта из `backend/`.

Лучший вариант для текущей структуры:
- **Root Directory:** оставить пустым (корень репо).
- В корне репо должен быть `package.json` с зависимостями бэкенда и скриптом `"start": "node backend/server.js"` (см. ниже).

### 3.3 Добавить корневой package.json (если его нет)
Чтобы Railway запускал бэкенд и отдавал статику из корня, в корне проекта нужен `package.json`:
- `"main": "backend/server.js"` или `"start": "node backend/server.js"`.
- Зависимости: те же, что в `backend/package.json` (express, cors, dotenv, multer, uuid), либо `"start": "cd backend && node server.js"` и тогда Railway будет использовать `backend/package.json`.

Проще всего: в настройках сервиса Railway указать **Start Command:** `node backend/server.js` и **Root Directory:** пусто. Тогда установка зависимостей — из корня; если в корне нет `package.json`, добавить минимальный с `scripts.start` и перенести зависимости в корень или оставить два package.json и в Railway задать **Build Command:** `cd backend && npm install` и **Start Command:** `cd backend && node server.js` (зависит от того, как Railway видит репо). Рекомендация: один корневой `package.json`, который в `start` запускает `node backend/server.js`, а зависимости лежат в `backend/` — тогда в Railway: **Root Directory** пусто, **Build:** `npm install --prefix backend`, **Start:** `node backend/server.js`.

### 3.4 Переменные окружения в Railway
В проекте → сервис → **Variables** добавить:

| Переменная | Значение |
|------------|----------|
| `NANO_BANANA_API_KEY` | Ключ с [nanobananaapi.ai](https://nanobananaapi.ai) |
| `BASE_URL` | После первого деплоя — выданный Railway URL (например `https://ai-image-bot-production.up.railway.app`) **без** слэша в конце |
| `PORT` | Оставить пустым или `3000` (Railway подставит свой порт) |

После первого деплоя скопировать **Public URL** сервиса и подставить в `BASE_URL`, затем сделать **Redeploy**.

### 3.5 Домен и HTTPS
- Railway по умолчанию даёт HTTPS. Этого достаточно для Mini App.
- При желании можно настроить свой домен в настройках сервиса.

---

## Этап 4. Проверка initData (безопасность MVP)

Чтобы только пользователи, открывшие приложение из Telegram, могли вызывать API:

- На бэкенде проверять заголовок или тело запроса с `initData` от Telegram.
- Использовать библиотеку, например `@telegram-apps/init-data-node`: проверка подписи с помощью `BOT_TOKEN`.

Шаги:
1. В `backend` установить: `npm i @telegram-apps/init-data-node`.
2. В `.env` и в Railway Variables добавить `BOT_TOKEN=...` (токен от BotFather).
3. В Express: middleware для `/api/generate` и при необходимости для `/api/gallery`, который читает `initData` (из заголовка или body), проверяет через `isValid(initData, botToken)` и возвращает 401 при неверных данных.
4. Во фронте при запросах к API передавать `initData`: например заголовок `X-Telegram-Init-Data` со значением `Telegram.WebApp.initData`.

Этот шаг можно сделать сразу после первого рабочего деплоя.

---

## Этап 5. MVP без реальных платежей (тестовый режим)

Чтобы быстро запустить и проверить воронку:

- Оставить текущую логику «монет» на фронте (например, 450 стартовых или меньше).
- На бэкенде **не** проверять баланс — только проверять initData и лимиты по запросам (опционально), чтобы избежать злоупотреблений.
- Кнопка «Пополнить» в меню может вести на канал/чат или показывать «Скоро» до подключения Telegram Stars.

Цель MVP: убедиться, что из Telegram открывается приложение, генерация идёт через Nano Banana, галерея и превью работают.

---

## Этап 6. Проверка перед объявлением MVP

- [ ] Бот создан, Menu Button ведёт на URL приложения.
- [ ] Открытие по кнопке в Telegram загружает интерфейс (заголовок, промпт, монеты, галерея).
- [ ] Генерация по тексту (TEXTTOIAMGE) возвращает картинку.
- [ ] Генерация по тексту + фото (IMAGETOIAMGE) работает.
- [ ] В галерее отображаются сгенерированные изображения.
- [ ] `BASE_URL` в Railway совпадает с реальным URL и без слэша в конце (важно для callback Nano Banana).

---

## Краткий чек-лист по порядку

1. Репозиторий на GitHub, код запушен, `.env` не в репо.
2. Бот в BotFather, токен сохранён.
3. Railway: New Project → Deploy from GitHub → выбран репо.
4. В Railway задать Build/Start так, чтобы запускался `backend/server.js`, отдавалась статика из корня.
5. В Railway Variables: `NANO_BANANA_API_KEY`, `BASE_URL` (после деплоя подставить URL), при необходимости `PORT`.
6. В BotFather выставить URL Mini App (адрес Railway).
7. Открыть бота в Telegram, нажать кнопку приложения — проверить генерацию и галерею.
8. (Рекомендуется) Добавить проверку initData на бэкенде и `BOT_TOKEN` в env.

После этого MVP считается запущенным. Дальше: монеты в БД, Telegram Stars, пакеты пополнения — отдельные этапы после MVP.
