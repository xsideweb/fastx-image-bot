# Как залить код на GitHub

Репозиторий уже инициализирован, первый коммит создан. Осталось создать репозиторий на GitHub и выполнить push.

## Шаг 1. Создать репозиторий на GitHub

1. Откройте [github.com/new](https://github.com/new).
2. **Repository name:** например `ai-image-bot`.
3. **Public.**
4. **Не** ставьте галочки "Add a README", ".gitignore", "License" — у вас уже есть код.
5. Нажмите **Create repository**.

## Шаг 2. Подключить remote и отправить код

В терминале (PowerShell или CMD) выполните, подставив **ВАШ_ЛОГИН** и **ИМЯ_РЕПО**:

```powershell
cd "c:\Work\AI Image Bot"
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

Пример: если ваш логин `johndoe` и репозиторий `ai-image-bot`:

```powershell
git remote add origin https://github.com/johndoe/ai-image-bot.git
git push -u origin main
```

При первом `git push` браузер или Git запросит авторизацию (логин/пароль или токен). Для HTTPS рекомендуется использовать [Personal Access Token](https://github.com/settings/tokens) вместо пароля.

Готово: код будет на GitHub.
