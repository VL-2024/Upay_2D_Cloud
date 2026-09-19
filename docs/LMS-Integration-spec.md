# УПАЙ — интеграция с LMS: инициализация игры и события (postMessage)

> **Важно при встраивании в прод:** в репозитории `src/config.js` (блок
> `CONFIG.lms`) по умолчанию стоит `mock: true` (для тестирования без
> реального LMS). При встраивании игры в iframe LMS **обязательно
> добавляйте `?mock=false` к URL игры** — иначе она будет работать в
> локальной эмуляции и никогда не отправит реальный запрос `PayTicket`,
> даже если LMS честно пришлёт `X2_LMS_INIT`.

Тот же контракт (`postMessage`-конверт, события, PayTicket), что и в
сестринской игре `Khan1_2D_Cloud` (Ордо/Чүкө) — единственная разница:
envelope `source` здесь `"X2_UPAY"` (там — `"X2_CHUKO"`), и `scenario` —
число 1..8 по количеству выигрышных категорий УПАЙ (см.
`PayTicket-API-spec-for-backend.md`).

Дополняет `PayTicket-API-spec-for-backend.md` (тот файл — только про
HTTP-запрос покупки билета). Здесь — всё остальное общение между LMS и
игрой через `postMessage` (игра живёт в `<iframe>` внутри страницы LMS).
Payload-примеры ниже взяты прямо из кода игры (`src/main.js` /
`src/lms-adapter.js`).

## 0. Общая схема

1. LMS открывает игру в iframe и один раз присылает `X2_LMS_INIT`.
2. Игрок выбирает номинал билета внутри игры из присланного списка.
3. При запуске раунда («Новая игра» / Автоигра) игра дёргает `PayTicket`.
4. LMS списывает стоимость, определяет результат, возвращает данные билета.
5. Игра проигрывает анимацию (3+3+1 серии ударов по чуко и, если 2 УПАЙ
   собраны, финальный удар по Хану) и только затем показывает выигрыш и
   баланс, полученные от LMS.

Игра никогда не считает реальный выигрыш сама — только показывает то,
что вернул `PayTicket`. До первого нажатия «Новая игра» игра НЕ покупает
билет — стол пуст, ставка не списывается.

## 1. `X2_LMS_INIT` — LMS → игра (один раз при старте)

```js
iframe.contentWindow.postMessage({
  type: 'X2_LMS_INIT',
  gameId: 'UPAY',
  language: 'RU',
  currency: 'KGS',
  currencyDisplay: 'сом',
  denominations: [25, 50, 100],
  denomination: 50,
  balance: 1255,
  mode: 'real',
  demoAllowed: true,
  demoBalance: 5000
}, '*');
```

| Параметр | Тип | Обязательный | Описание |
|---|---|---|---|
| `type` | string | да | Всегда `'X2_LMS_INIT'`. |
| `gameId` | integer/string | да | ID игры — именно его игра дальше подставляет в `PayTicket`. |
| `language` | string | да | `RU`, `EN`, `KG` или `ZH`. Игрок может переключить язык сам внутри игры (это осознанно, не баг). |
| `currency` | string | да | ISO-код валюты, например `KGS`. Игрок валюту не меняет. |
| `currencyDisplay` | string | рекомендуется | Как показывать валюту в интерфейсе (`сом`, `₽`, `$`). |
| `denominations` | number[] | да | Список номиналов, доступных игроку. |
| `denomination` | number | нет | Номинал по умолчанию при открытии. Если не передан — берётся первый элемент `denominations`. |
| `balance` | number | да | Стартовый реальный баланс. |
| `mode` | string | да | `'real'` или `'demo'`. |
| `demoAllowed` | boolean | да | Разрешено ли переключение REAL/DEMO внутри игры. Если `false` — переключатель скрыт/заблокирован. |
| `demoBalance` | number | нет | Стартовый виртуальный баланс DEMO. |
| `session` | string | нет | ID сессии, если LMS передаёт его отдельно. |

**Важно:** `denomination` — только начальный выбор при запуске. После
того как игрок сам сменил номинал внутри игры, LMS не должна присылать
`denomination` повторно — актуальный выбор игрока уходит в `PayTicket`
как `amount`.

## 2. События игра → LMS

Все уходят через `window.parent.postMessage(...)` с общим конвертом:

```json
{ "source": "X2_UPAY", "type": "...", "...остальные поля": "..." }
```

### `X2_GAME_READY`
Игра загрузилась. Если игра ещё не top-level (не в iframe) и не в
mock-режиме — присылает это дважды: сразу при загрузке скрипта и ещё раз
при первом обращении к настройкам, если `X2_LMS_INIT` до этого не пришёл.

```json
{ "source":"X2_UPAY", "type":"X2_GAME_READY", "gameId":"UPAY", "needsInit":true, "needsSession":false }
```

### `X2_GAME_BALANCE_LOADED`
Баланс получен и показан (при загрузке и при переключении REAL/DEMO).

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_BALANCE_LOADED",
  "gameId":"UPAY", "balance":1255, "currency":"KGS", "currencyDisplay":"сом",
  "language":"RU", "denominations":[25,50,100], "mode":"real"
}
```

### `X2_GAME_DENOMINATION_CHANGED`
Игрок сменил номинал внутри игры.

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_DENOMINATION_CHANGED",
  "gameId":"UPAY", "denomination":100, "currency":"KGS", "language":"RU", "mode":"real"
}
```

### `X2_GAME_MODE_CHANGED`
Игрок переключил REAL/DEMO (если `demoAllowed:true`).

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_MODE_CHANGED",
  "gameId":"UPAY", "mode":"demo", "currency":"KGS", "language":"RU", "denomination":50
}
```

### `X2_GAME_TICKET_READY`
Билет получен от LMS, сценарий готов к показу (анимация ещё идёт).

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_TICKET_READY",
  "gameId":"UPAY", "ticketId":"123456789", "scenario":5,
  "denomination":50, "currency":"KGS", "currencyDisplay":"сом",
  "language":"RU", "mode":"real"
}
```

### `X2_GAME_ROUND_COMPLETE`
Раунд полностью доигран и показан игроку (можно использовать для
аналитики).

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_ROUND_COMPLETE",
  "gameId":"UPAY", "ticketId":"123456789", "scenario":5, "win":150, "balance":1330,
  "denomination":50, "currency":"KGS", "currencyDisplay":"сом",
  "language":"RU", "mode":"real"
}
```

### `X2_GAME_DEPOSIT_REQUEST`
Игрок нажал `+` возле баланса. `denomination` тут чисто информационное
поле (текущий выбор игрока), после события LMS сама открывает форму
пополнения.

```json
{
  "source":"X2_UPAY", "type":"X2_GAME_DEPOSIT_REQUEST",
  "gameId":"UPAY", "mode":"real", "currency":"KGS",
  "denomination":100, "language":"RU", "balance":1330
}
```

### `X2_GAME_HELP_REQUEST`
Игрок открыл экран «Как играть». Безобидно игнорировать.

```json
{ "source":"X2_UPAY", "type":"X2_GAME_HELP_REQUEST", "gameId":"UPAY", "language":"RU", "mode":"real" }
```

### `X2_GAME_ERROR`
Ошибка игры/интеграции. `stage` — где произошло (`init`, `newGame`
и т.п.), `code`/`message` — из ошибки PayTicket или внутренней логики.

```json
{ "source":"X2_UPAY", "type":"X2_GAME_ERROR", "stage":"newGame", "code":"INSUFFICIENT_FUNDS", "message":"..." }
```

## 3. Тестовые URL-параметры

Работают только в связке с `?mock=false` (иначе игра работает в
локальной эмуляции и `X2_LMS_INIT` не нужен вовсе):

| Параметр | Пример | Назначение |
|---|---|---|
| `mock` | `mock=false` | Выключает локальную эмуляцию, включает реальный LMS-режим. |
| `gameId` | `gameId=UPAY` | Тестовый ID игры. |
| `language` | `language=RU` | Тестовый язык. |
| `currency` | `currency=KGS` | Тестовая валюта (ISO-код). |
| `currencyDisplay` | `currencyDisplay=сом` | Обозначение валюты. |
| `denominations` | `denominations=25,50,100` | Список доступных номиналов. |
| `denomination` | `denomination=50` | Номинал по умолчанию. |
| `mode` | `mode=real` | Стартовый режим. |
| `demoAllowed` | `demoAllowed=true` | Разрешение переключения REAL/DEMO. |
| `demoBalance` | `demoBalance=5000` | Стартовый DEMO-баланс. |
| `balance` | `balance=1255` | Стартовый реальный баланс (замена `X2_LMS_INIT.balance` для теста). |
| `scenario` | `scenario=5` | Принудительный сценарий (1..8) — работает только в mock/demo-тикетах. |

Для боевого запуска все настройки должны приходить от LMS через
`X2_LMS_INIT`, а не через URL.

## 4. Чего в этой схеме нет

Отдельного эндпоинта «получить баланс» не существует — только
`X2_LMS_INIT.balance` при старте и `balance` в ответе `PayTicket` после
каждого билета (см. `PayTicket-API-spec-for-backend.md`).

## 5. Безопасность postMessage

`src/config.js` → `CONFIG.lms.allowedParentOrigins` **пуст по
умолчанию** — это значит игра отклоняет `X2_LMS_INIT`/`X2_LMS_SESSION` с
ЛЮБОГО origin, пока список не заполнен явно (см. `isAllowedOrigin()` в
`src/lms-adapter.js`). Перед встраиванием в прод впишите туда конкретные
домены LMS, например `['https://x2.kg']` — никогда `'*'` в проде.
