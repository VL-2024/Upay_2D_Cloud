// Локализация — таблица, не вложенные объекты по языкам.
// Один ключ = одна строка, колонки RU/EN/KG/ZH.
// Отсутствующая колонка у конкретной строки автоматически падает на RU
// (см. buildDict() ниже), а не на пустую строку.
export const LANGS = ['RU', 'EN', 'KG', 'ZH'];

const TABLE = [
  { key: 'balance', RU: 'Баланс', EN: 'Balance', KG: 'Баланс', ZH: '余额' },
  { key: 'stake', RU: 'Ставка', EN: 'Stake', KG: 'Коюм', ZH: '投注额' },
  { key: 'title', RU: 'УПАЙ', EN: 'UPAY', KG: 'УПАЙ', ZH: 'UPAY' },
  { key: 'subtitle', RU: 'Выбей Хана', EN: 'Knock Out the Khan', KG: 'Ханды кулат', ZH: '击倒可汗' },

  { key: 'newGame', RU: 'Новая игра', EN: 'New game', KG: 'Жаңы оюн', ZH: '开始新游戏' },
  { key: 'makeThrow', RU: 'Бросок', EN: 'Throw', KG: 'Ыргытуу', ZH: '投掷' },
  { key: 'chooseBita', RU: 'Выбери чуко-биту', EN: 'Choose a chuko bita', KG: 'Чуко-битаны тандаңыз', ZH: '选择 chuko' },
  { key: 'aimThrow', RU: 'Прицелься и отпусти для удара', EN: 'Aim and release to strike', KG: 'Кыраатап, коё бер', ZH: '瞄准后松开投掷' },
  { key: 'strikeKhan', RU: 'Финальный удар — выбей Хана!', EN: 'Final strike — knock out the Khan!', KG: 'Акыркы сокку — Ханды кулат!', ZH: '最后一击——击倒可汗！' },

  { key: 'autoPlay', RU: 'Автоигра', EN: 'Autoplay', KG: 'Автооюн', ZH: '自动游戏' },
  { key: 'autoStart', RU: 'Старт', EN: 'Start', KG: 'Старт', ZH: '开始' },
  { key: 'autoStop', RU: 'Стоп', EN: 'Stop', KG: 'Токтот', ZH: '停止' },
  { key: 'autoStopping', RU: 'Стоп...', EN: 'Stopping...', KG: 'Токтотуу...', ZH: '正在停止…' },
  { key: 'autoGames', RU: 'Количество игр', EN: 'Number of games', KG: 'Оюндун саны', ZH: '游戏局数' },

  { key: 'upay1', RU: 'УПАЙ 1', EN: 'UPAY 1', KG: 'УПАЙ 1', ZH: 'UPAY 1' },
  { key: 'upay2', RU: 'УПАЙ 2', EN: 'UPAY 2', KG: 'УПАЙ 2', ZH: 'UPAY 2' },
  { key: 'khan', RU: 'ХАН', EN: 'KHAN', KG: 'ХАН', ZH: '可汗' },
  { key: 'scoreWin', RU: 'ВЫИГРЫШ', EN: 'WIN', KG: 'УТУШ', ZH: '奖金' },
  { key: 'stood', RU: 'УСТОЯЛ', EN: 'STOOD', KG: 'КАЛДЫ', ZH: '未击中' },
  { key: 'knockedOut', RU: 'ВЫБИТ', EN: 'DOWN', KG: 'ЧЫКТЫ', ZH: '已击倒' },

  { key: 'info', RU: 'Инфо', EN: 'Info', KG: 'Инфо', ZH: '信息' },
  { key: 'payoutTable', RU: 'Таблица выплат', EN: 'Payout table', KG: 'Төлөмдөр таблицасы', ZH: '赔率表' },
  { key: 'howToPlay', RU: 'Как играть', EN: 'How to play', KG: 'Кантип ойноо керек', ZH: '游戏玩法' },
  { key: 'myTickets', RU: 'Мои билеты', EN: 'My tickets', KG: 'Менин билеттерим', ZH: '我的彩票' },

  { key: 'sound', RU: 'Звук', EN: 'Sound', KG: 'Үн', ZH: '音效' },
  { key: 'music', RU: 'Музыка', EN: 'Music', KG: 'Музыка', ZH: '音乐' },
  { key: 'ticket', RU: 'Билет', EN: 'Ticket', KG: 'Билет', ZH: '彩票' },

  { key: 'recentTickets', RU: 'Последние билеты', EN: 'Recent tickets', KG: 'Акыркы билеттер', ZH: '最近的彩票' },
  { key: 'noRecentTickets', RU: 'Пока нет завершённых билетов', EN: 'No completed tickets yet', KG: 'Азырынча аяктаган билеттер жок', ZH: '暂无已完成的彩票' },

  { key: 'real', RU: 'REAL', EN: 'REAL', KG: 'REAL', ZH: '真实' },
  { key: 'demo', RU: 'DEMO', EN: 'DEMO', KG: 'DEMO', ZH: '演示' },

  { key: 'helpTitle', RU: 'Как играть', EN: 'How to play', KG: 'Кантип ойноо керек', ZH: '游戏玩法' },
  { key: 'helpOk', RU: 'Понятно', EN: 'Got it', KG: 'Түшүнүктүү', ZH: '知道了' },

  { key: 'hintStart', RU: 'Нажми «Новая игра»', EN: 'Press "New game"', KG: '«Жаңы оюн» баскычын бас', ZH: '点击"开始新游戏"' },
  { key: 'hintChoose', RU: 'Выбери чуко-биту и перетяни для удара', EN: 'Choose a chuko and drag to strike', KG: 'Чуко тандап, сокку үчүн тарт', ZH: '选择 chuko 并拖动投掷' },
  { key: 'hintKhan', RU: 'Финальный удар — выбери биту и выбей Хана!', EN: 'Final strike — choose a bita and knock out the Khan!', KG: 'Акыркы сокку — битаны тандап, Ханды кулат!', ZH: '最后一击——选择并击倒可汗！' },
  { key: 'hintHide', RU: 'Скрыть подсказку', EN: 'Hide hint', KG: 'Кеңешти жашыруу', ZH: '隐藏提示' },

  { key: 'deposit', RU: 'Пополнить баланс', EN: 'Top up balance', KG: 'Балансты толуктоо', ZH: '充值' },
  { key: 'depositSoon', RU: 'Пополнение будет доступно после подключения к LMS', EN: 'Top-up will be available once connected to the LMS', KG: 'Толуктоо LMSге туташкандан кийин жеткиликтүү болот', ZH: '连接 LMS 后即可充值' },

  { key: 'insufficientFunds', RU: 'Недостаточно средств', EN: 'Insufficient balance', KG: 'Каражат жетишсиз', ZH: '余额不足' },
  { key: 'noValidPair', RU: 'Нет пары в таком же положении — выбери другой чуко', EN: 'No matching pair — choose another chuko', KG: 'Дал келген жуп жок — башка чукону тандаңыз', ZH: '没有匹配的一对——请选择其他 chuko' },
  { key: 'dragSelected', RU: 'Оттяни выбранную фишку и прицелься', EN: 'Drag the selected piece to aim', KG: 'Тандалган бөлүкчөнү тартып, кыраатаңыз', ZH: '拖动已选中的棋子进行瞄准' },
];

function buildDict(lang) {
  const dict = {};
  TABLE.forEach(row => {
    dict[row.key] = (row[lang] != null && row[lang] !== '') ? row[lang] : row.RU;
  });
  return dict;
}

export const I18N = { LANGS, TABLE };
LANGS.forEach(lang => { I18N[lang] = buildDict(lang); });
