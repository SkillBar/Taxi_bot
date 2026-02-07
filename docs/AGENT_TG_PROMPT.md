# Агент управляет из Telegram: анализ и промпт на доработку

## 1. Что сейчас показывает пользователю

После перехода на главный экран или при первом открытии Mini App пользователь видит:

- **«Не удалось загрузить интерфейс.»**
- **«Откройте кабинет в упрощённом режиме.»**
- Кнопка **«Открыть кабинет»** (переход в SimpleHomeScreen без telegram-ui).

То есть основной интерфейс (AppRoot, List, Section из `@telegram-apps/telegram-ui`) не рендерится и ловится UIErrorBoundary.

---

## 2. Причина падения (разбор «по молекулам»)

### 2.1 Две разные инициализации Telegram

В проекте используются **одновременно**:

1. **Legacy Web App**  
   - Скрипт: `https://telegram.org/js/telegram-web-app.js` в `index.html`.  
   - Объект: `window.Telegram.WebApp`.  
   - Наш код: `telegramWebApp.ts` — `ready()`, `expand()`, `setHeaderColor` / `setBackgroundColor` из `themeParams`.  
   - Этого достаточно для: `requestContact`, `MainButton`, `initData`, открытия ссылок.

2. **Новый SDK (@telegram-apps/sdk + sdk-react + telegram-ui)**  
   - Пакеты: `@telegram-apps/sdk-react`, `@telegram-apps/telegram-ui`.  
   - В коде **нигде не вызывался** `init()` из `@telegram-apps/sdk`.  
   - В документации явно: *«Without calling this function, most package functions will not work and will throw errors.»*  
   - Для темы нужны: `themeParams.mountSync()` и `themeParams.bindCssVars()`, иначе нет переменных `--tg-theme-*`.

### 2.2 Почему падает telegram-ui

- `AppRoot`, `List`, `Section`, `Cell` из `@telegram-apps/telegram-ui` завязаны на **новый SDK** и его тему.
- Без вызова `init()` и без смонтированной темы (mountSync + bindCssVars) обращение к теме/контексту даёт ошибку при первом рендере.
- В итоге при монтировании экранов с telegram-ui (Onboarding, AgentHome, ManagerDashboard) происходит throw → срабатывает UIErrorBoundary → показ «Не удалось загрузить интерфейс» и кнопки «Открыть кабинет».

### 2.3 Что сделано в коде (фикс) — применено

В `webapp/src/main.tsx` перед рендером React добавлено:

1. `initSDK()` — инициализация `@telegram-apps/sdk` (из `@telegram-apps/sdk-react`).
2. `themeParams.mountSync()` (если `themeParams.mountSync?.isAvailable?.()`) — синхронный монтаж темы.
3. `themeParams.bindCssVars()` (если `themeParams.bindCssVars?.isAvailable?.()`) — привязка темы к CSS-переменным `--tg-theme-*`.

Всё в `try/catch`, чтобы вне Telegram приложение не падало. После этого telegram-ui получает тему и не должен падать при рендере; при ошибке остаётся fallback: UIErrorBoundary + SimpleHomeScreen.

---

## 3. Как агент должен «всё управлять» из Telegram (целевая картина)

С точки зрения продукта и документации (Telegram Mini Apps + Yandex Fleet):

1. **Вход и привязка**  
   - Агент открывает Mini App из бота (кнопка «Регистрация исполнителя» / аналог).  
   - Онбординг: подтверждение номера через `requestContact` → бот получает контакт → `link-from-bot` → при следующем открытии Mini App агент уже `linked`.

2. **Подключение парка (Fleet)**  
   - Один раз: ввод API-ключа и Park ID из кабинета fleet.yandex.ru.  
   - Сохранение в Manager по `telegramId` (текущая реализация).

3. **Управление из TG**  
   - **Список исполнителей** — из `GET /api/manager/drivers` (данные из БД + Yandex Fleet).  
   - **Добавление водителя** — телефон → `POST /api/manager/link-driver` → поиск в Fleet по парку менеджера, создание DriverLink.  
   - **Регистрация водителя/курьера** — многошаговая форма (черновик, отправка).  
   - **Кабинет менеджера** — полный список + привязка, при необходимости детали водителя (звонок, баланс, статус).  
   - Всё это — внутри одного Mini App в Telegram, без перехода во внешние веб-кабинеты для рутинных действий.

4. **Данные и авторизация**  
   - Каждый запрос к API с `x-telegram-init-data`; бэкенд по нему определяет пользователя и его Manager.  
   - Fleet-запросы идут с учётными данными этого менеджера (API key + Park ID из БД).  
   - Агент «управляет» только своим парком и своими привязанными водителями.

Итого: агент может «всё управлять из TG», если:  
- Mini App стабильно открывается и показывает кабинет (без падения в «Не удалось загрузить интерфейс»);  
- онбординг (контакт + Fleet) и все экраны (главная, список, добавление, регистрация, кабинет менеджера) работают внутри того же приложения.

---

## 4. Чего не хватало (взгляд сеньора)

- **Инициализация нового SDK**  
  Вызов `init()` и монтаж темы (mountSync + bindCssVars) до первого рендера — обязательны для telegram-ui; без этого интерфейс падает с текущей ошибкой.

- **Единая точка входа по теме**  
  Либо полностью переходим на новый SDK (init + themeParams) и используем только его, либо не используем telegram-ui и рисуем свой UI. Смешение без инициализации SDK — источник падений.

- **Поведение вне Telegram**  
  При открытии ссылки в обычном браузере (без TG) SDK может быть недоступен — нужен аккуратный try/catch и сохранение fallback (упрощённый кабинет / сообщение «Откройте в Telegram»).

- **Документация**  
  В README или ARCHITECTURE стоит явно описать:  
  - что используется и legacy Web App, и новый SDK;  
  - что перед рендером обязательно вызываются init, themeParams.mountSync, themeParams.bindCssVars;  
  - зачем нужны UIErrorBoundary и SimpleHomeScreen (падение telegram-ui или работа вне TG).

---

## 5. Промпт для следующего шага (вставить сюда / передать ассистенту)

Ниже — готовый промпт, который можно вставить в чат с AI или использовать как ТЗ.

---

**Промпт:**

«Проект: Telegram Mini App для агентов такси (монорепо: webapp + api + bot).

**Проблема:** При открытии Mini App в Telegram пользователь видит экран «Не удалось загрузить интерфейс» и кнопку «Открыть кабинет» (упрощённый режим). Основной интерфейс на `@telegram-apps/telegram-ui` (AppRoot, List, Section) не рендерится.

**Уже сделано:**  
- В `webapp/src/main.tsx` перед рендером добавлены: `init()` из `@telegram-apps/sdk-react`, затем `themeParams.mountSync()` и `themeParams.bindCssVars()` (если доступны), в try/catch.  
- Цель: чтобы telegram-ui получал инициализированный SDK и тему и перестал падать при первом рендере.

**Нужно от тебя:**  
1. Проверить, что вызовы init, themeParams.mountSync и themeParams.bindCssVars действительно выполняются до `ReactDOM.createRoot().render()` и что импорты из `@telegram-apps/sdk-react` корректны (в т.ч. для themeParams).  
2. Если в этой версии SDK API отличается (например, другой способ монтажа темы или другой экспорт) — подстроить код под актуальную документацию @telegram-apps/sdk и telegram-ui.  
3. Убедиться, что приложение не падает при открытии в обычном браузере (вне Telegram): оставить fallback (UIErrorBoundary + SimpleHomeScreen) и не ломать его.  
4. Кратко описать в комментарии в `main.tsx` или в `docs/AGENT_TG_PROMPT.md`, почему без init() и themeParams падает интерфейс и что именно исправлено.

**Контекст:** Агент должен полностью управлять из Telegram: онбординг по контакту, подключение Yandex Fleet (API key + Park ID), список исполнителей, добавление водителя по телефону, регистрация водителя/курьера, кабинет менеджера. Всё это уже реализовано в экранах и API; сейчас блокер — падение основного UI из‑за неинициализированного SDK/темы.»

---

Конец промпта.

---

## 6. Ссылки

- [Telegram Mini Apps — Theming](https://docs.telegram-mini-apps.com/platform/theming)  
- [@telegram-apps/sdk — Theme Params](https://docs.telegram-mini-apps.com/packages/telegram-apps-sdk/3-x/components/theme-params)  
- [@telegram-apps/sdk-react](https://docs.telegram-mini-apps.com/packages/telegram-apps-sdk-react/3-x)  
- [Yandex Fleet API (парк, driver-profiles/list)](https://fleet.yandex.ru/docs/api/ru/)  
- Внутри репозитория: `ARCHITECTURE.md`, `docs/YANDEX_FLEET_INTEGRATION_PROMPT.md`
