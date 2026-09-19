import { Application, Assets, Container, Graphics, Sprite } from '../assets/vendor/pixi.min.mjs?v=0.3.0';
import { CONFIG } from './config.js?v=0.3.0';
import { ScenarioEngine, SCENARIOS, getPayoutTable, lmsIdForScenario, multiplierForScenario } from './scenario-engine.js?v=0.3.0';
import { LANGS, I18N } from './i18n.js?v=0.3.0';
import { getRulesSteps } from './rules-content.js?v=0.3.0';
import { LMS } from './lms-adapter.js?v=0.3.0';

const chukoFiles = [
  './assets/chuko/chuko_aykur.webp',
  './assets/chuko/chuko_taa.webp',
  './assets/chuko/chuko_bok.webp',
  './assets/chuko/chuko_chik.webp',
];
const khanFiles = [
  './assets/khan/khan_01.webp',
  './assets/khan/khan_02.webp',
  './assets/khan/khan_03.webp',
];

const scenario = new ScenarioEngine();
const DEFAULT_SCENE = JSON.parse(JSON.stringify(CONFIG.scene));
const DEFAULT_PIECES = JSON.parse(JSON.stringify(CONFIG.pieces));

const DEFAULT_DEMO_BALANCE = 5000;
const DEFAULT_REAL_BALANCE = 5000; // placeholder pool until LMS supplies real balance

const LS_KEYS = {
  lang: 'upay2d_lang',
  mode: 'upay2d_mode',
  balances: 'upay2d_balances',
  sound: 'upay2d_sound',
  music: 'upay2d_music',
  tickets: (mode) => `upay2d_tickets_${mode}`,
};

function loadLang() {
  const saved = localStorage.getItem(LS_KEYS.lang);
  return LANGS.includes(saved) ? saved : 'RU';
}
function loadMode() {
  return localStorage.getItem(LS_KEYS.mode) === 'real' ? 'real' : 'demo';
}
function loadBalances() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEYS.balances));
    if (saved && typeof saved.real === 'number' && typeof saved.demo === 'number') return saved;
  } catch { /* fall through to defaults */ }
  return { real: DEFAULT_REAL_BALANCE, demo: DEFAULT_DEMO_BALANCE };
}
function loadBool(key, fallback) {
  const saved = localStorage.getItem(key);
  return saved === null ? fallback : saved === '1';
}

const state = {
  denomination: CONFIG.defaultDenomination,
  denominations: [...CONFIG.denominations],
  currency: CONFIG.currency, // display label shown in UI, e.g. "сом"
  currencyCode: CONFIG.lms?.currencyCode || 'KGS', // ISO code sent to the LMS API
  phase: 'idle',
  pieces: [],
  selectedSourceId: null,
  demoHasStarted: false,
  externalScenarioCode: null,
  slots: Array(CONFIG.zones.totalSlots).fill(null),
  settled: false,
  lang: loadLang(),
  mode: loadMode(),
  balances: loadBalances(),
  soundEnabled: loadBool(LS_KEYS.sound, true),
  musicEnabled: loadBool(LS_KEYS.music, true),
  hintCollapsed: false,
  ticketId: null,
  gameId: CONFIG.lms?.gameId || 'UPAY',
  demoAllowed: true,
  lmsScenarioId: null,
  pendingWin: null,
  pendingBalance: null,
  autoPlay: { active: false, remaining: 0, stopRequested: false },
};

const host = document.getElementById('pixiHost');
const app = new Application();
await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true });
host.appendChild(app.canvas);
app.stage.sortableChildren = true;
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;

applySceneLayout();

const textures = await loadTextures();
const hintLayer = new Container();
hintLayer.sortableChildren = true;
app.stage.addChild(hintLayer);
const pieceLayer = new Container();
pieceLayer.sortableChildren = true;
app.stage.addChild(pieceLayer);
const fxLayer = new Container();
fxLayer.sortableChildren = true;
app.stage.addChild(fxLayer);

const selectionRing = new Graphics();
selectionRing.visible = false;
selectionRing.zIndex = 50;
fxLayer.addChild(selectionRing);

const aimGuide = new Graphics();
aimGuide.visible = false;
aimGuide.zIndex = 55;
fxLayer.addChild(aimGuide);

let bitaDrag = null;

const khanGlowRing = new Graphics();
khanGlowRing.visible = false;
khanGlowRing.zIndex = 15;
fxLayer.addChild(khanGlowRing);
let khanGlowTick = null;

boot();
window.addEventListener('resize', () => scheduleSceneRebuild());

async function boot() {
  let settings = {};
  try {
    settings = await LMS.getGameSettings();
  } catch (err) {
    console.error('[UPAY2D] LMS getGameSettings failed', err);
    LMS.emit('X2_GAME_ERROR', { stage: 'init', code: err.code || 'INIT_ERROR', message: err.message || String(err) });
  }
  applyLmsSettings(settings);
  setupUI();
  // No auto-purchased round on load: a ticket is only bought once the
  // player presses "Новая игра" / Автоигра (see beginRound()) — this
  // matters once PayTicket is a real, money-moving LMS call.
  LMS.emit('X2_GAME_BALANCE_LOADED', {
    gameId: state.gameId, balance: state.balances[state.mode], currency: state.currencyCode,
    currencyDisplay: state.currency, language: state.lang, denominations: state.denominations, mode: state.mode,
  });
}

let pendingRebuildTimer = null;
function scheduleSceneRebuild() {
  if (state.phase === 'animating' || bitaDrag) {
    if (pendingRebuildTimer) return;
    pendingRebuildTimer = setInterval(() => {
      if (state.phase === 'animating' || bitaDrag) return;
      clearInterval(pendingRebuildTimer);
      pendingRebuildTimer = null;
      rebuildPieceSprites(false);
    }, 50);
    return;
  }
  rebuildPieceSprites(false);
}

async function loadTextures() {
  const loaded = {};
  for (const path of [...chukoFiles, ...khanFiles, CONFIG.scene.backgroundImage, CONFIG.scene.carpetImage]) {
    loaded[path] = await Assets.load(path);
  }
  return loaded;
}

function applySceneLayout() {
  const shell = document.getElementById('appShell');
  const bg = document.getElementById('backgroundLayer');
  const carpet = document.getElementById('carpetLayer');
  if (bg) bg.style.backgroundImage = `url(${CONFIG.scene.backgroundImage.replace('./', '')})`;
  if (carpet) {
    carpet.style.backgroundImage = `url(${CONFIG.scene.carpetImage.replace('./', '')})`;
    carpet.style.setProperty('--carpet-x', `${CONFIG.scene.carpetCenterX * 100}%`);
    carpet.style.setProperty('--carpet-y', `${CONFIG.scene.carpetCenterY * 100}%`);
  }
  if (shell) {
    shell.style.setProperty('--carpet-x', `${CONFIG.scene.carpetCenterX * 100}%`);
    shell.style.setProperty('--carpet-y', `${CONFIG.scene.carpetCenterY * 100}%`);
    shell.style.setProperty('--carpet-w', `${CONFIG.scene.carpetWidth * 100}%`);
  }
}

function getSceneMetrics() {
  return {
    cx: CONFIG.scene.pileCenterX,
    cy: CONFIG.scene.pileCenterY,
    spreadX: CONFIG.scene.pileSpreadX.map(v => v * (CONFIG.scene.pileSpreadScale ?? 1)),
    spreadY: CONFIG.scene.pileSpreadY.map(v => v * (CONFIG.scene.pileSpreadScale ?? 1) * (CONFIG.scene.pileSpreadHeightScale ?? 1)),
    carpetCenterX: CONFIG.scene.carpetCenterX,
    carpetCenterY: CONFIG.scene.carpetCenterY,
    carpetWidth: CONFIG.scene.carpetWidth,
    carpetHeight: CONFIG.scene.carpetHeight,
    edgeOutset: CONFIG.scene.edgeOutset,
  };
}

// ---------- i18n ----------
function tr(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || I18N.RU[key] || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = tr(el.dataset.i18n);
  });
  document.getElementById('langCurrentCode').textContent = state.lang;
  renderLangMenu();
}

function renderLangMenu() {
  const menu = document.getElementById('langMenu');
  menu.innerHTML = LANGS.map(l =>
    `<button type="button" class="lang-option${l === state.lang ? ' selected' : ''}" data-lang="${l}">${l}</button>`
  ).join('');
}

function setLanguage(lang) {
  if (!LANGS.includes(lang) || lang === state.lang) return;
  state.lang = lang;
  localStorage.setItem(LS_KEYS.lang, lang);
  applyTranslations();
  syncStakeUI();
  updateBalanceUI();
  updateRoundStatus();
  renderHint();
  updateAutoBtnLabel();
}

function closeLangMenu() {
  const menu = document.getElementById('langMenu');
  if (menu) menu.hidden = true;
  document.getElementById('langSelect')?.setAttribute('aria-expanded', 'false');
}

// ---------- money / balance ----------
function formatMoney(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

function saveBalances() {
  localStorage.setItem(LS_KEYS.balances, JSON.stringify(state.balances));
}

function updateBalanceUI() {
  const el = document.getElementById('balanceValue');
  if (el) el.textContent = `${formatMoney(state.balances[state.mode])} ${state.currency}`;
}

// ---------- LMS settings ----------
// Applies X2_LMS_INIT (or its mock/query-param equivalent from
// lms-adapter.getGameSettings()) onto local state. Only overwrites a field
// when the settings actually supply it — see docs/LMS-Integration-spec.md.
function applyLmsSettings(settings = {}) {
  if (settings.gameId) state.gameId = String(settings.gameId);

  const requestedLang = String(settings.language || state.lang || 'RU').toUpperCase();
  state.lang = LANGS.includes(requestedLang) ? requestedLang : 'RU';
  localStorage.setItem(LS_KEYS.lang, state.lang);

  state.currency = settings.currencyDisplay || CONFIG.currency;
  if (settings.currency) state.currencyCode = String(settings.currency).toUpperCase();

  if (Array.isArray(settings.denominations) && settings.denominations.length) {
    state.denominations = settings.denominations.map(Number).filter(n => Number.isFinite(n) && n > 0);
  }
  const preferredDenom = Number(settings.denomination ?? state.denomination);
  state.denomination = state.denominations.includes(preferredDenom) ? preferredDenom : state.denominations[0];

  state.demoAllowed = settings.demoAllowed !== undefined ? Boolean(settings.demoAllowed) : true;
  if (Number.isFinite(Number(settings.demoBalance))) state.balances.demo = Number(settings.demoBalance);
  // Real balance: contract has no "get balance" endpoint — only
  // X2_LMS_INIT.balance at boot and PayTicket's own `balance` afterwards.
  if (Number.isFinite(Number(settings.balance))) state.balances.real = Number(settings.balance);

  const requestedMode = String(settings.mode || state.mode || 'demo').toLowerCase() === 'real' ? 'real' : 'demo';
  state.mode = state.demoAllowed ? requestedMode : 'real';
  localStorage.setItem(LS_KEYS.mode, state.mode);

  saveBalances();
}

// ---------- mode (real/demo) ----------
function applyModeUI() {
  document.querySelectorAll('#modeSwitch button[data-mode]').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === state.mode);
  });
  document.getElementById('modeSwitch').classList.toggle('disabled', !state.demoAllowed);
}

function switchMode(mode) {
  if (!state.demoAllowed) return;
  if ((mode !== 'real' && mode !== 'demo') || mode === state.mode) return;
  if (state.phase === 'animating') return;
  if (bitaDrag) cancelBitaDrag();
  if (state.autoPlay.active) stopAutoplay();
  state.mode = mode;
  localStorage.setItem(LS_KEYS.mode, mode);
  applyModeUI();
  updateBalanceUI();
  updateTicketNumberUI();
  LMS.emit('X2_GAME_MODE_CHANGED', { gameId: state.gameId, mode: state.mode, currency: state.currencyCode, language: state.lang, denomination: state.denomination });
  LMS.emit('X2_GAME_BALANCE_LOADED', {
    gameId: state.gameId, balance: state.balances[state.mode], currency: state.currencyCode,
    currencyDisplay: state.currency, language: state.lang, denominations: state.denominations, mode: state.mode,
  });
}

// ---------- tickets ----------
function updateTicketNumberUI() {
  const el = document.getElementById('ticketNumber');
  if (el) el.textContent = `№ ${state.ticketId || '—'}`;
}

function loadTickets(mode) {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEYS.tickets(mode)));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveTicket(mode, ticket) {
  const list = loadTickets(mode);
  list.unshift(ticket);
  localStorage.setItem(LS_KEYS.tickets(mode), JSON.stringify(list.slice(0, 5)));
}

function renderTicketsList() {
  const list = document.getElementById('ticketsList');
  const tickets = loadTickets(state.mode);
  if (!tickets.length) {
    list.innerHTML = `<div class="tickets-empty">${tr('noRecentTickets')}</div>`;
    return;
  }
  list.innerHTML = tickets.map(t =>
    `<div class="ticket-history-row"><div class="ticket-history-id">${t.id}</div><div class="ticket-history-win">${formatMoney(t.win)} ${state.currency}</div></div>`
  ).join('');
}

// ---------- sound / music ----------
function applyAudioUI() {
  const soundBtn = document.getElementById('soundBtn');
  const musicBtn = document.getElementById('musicBtn');
  soundBtn.classList.toggle('on', state.soundEnabled);
  musicBtn.classList.toggle('on', state.musicEnabled);
  document.getElementById('soundIcon').textContent = state.soundEnabled ? '🔊' : '🔇';
  document.getElementById('musicIcon').textContent = state.musicEnabled ? '♫' : '♫×';
}

// ---------- hint ----------
function applyHintCollapsed() {
  document.getElementById('hint').classList.toggle('collapsed', state.hintCollapsed);
  document.getElementById('hintToggle').textContent = state.hintCollapsed ? '?' : '×';
}

function resultHintText(snap) {
  const revealed = computeRevealedMultiplier(snap);
  const amount = formatMoney(state.denomination * (revealed ?? 0));
  if (snap.stage === 'khan') {
    const outcome = snap.khanHit ? tr('knockedOut') : tr('stood');
    return `${tr('khan')}: ${outcome}. ${tr('scoreWin')} ${amount} ${state.currency}`;
  }
  return `${tr('scoreWin')}: ${amount} ${state.currency}`;
}

function renderHint() {
  const snap = scenario.snapshot();
  let text;
  if (snap.finished) {
    text = resultHintText(snap);
  } else if (state.phase === 'aiming' && state.selectedSourceId) {
    text = tr('aimThrow');
  } else if (snap.stage === 'khan') {
    text = tr('hintKhan');
  } else if (!state.pieces.length) {
    text = tr('hintStart');
  } else {
    text = tr('hintChoose');
  }
  document.getElementById('hintText').textContent = text;
}

let flashTimer = null;
function flashHint(text, ms = 1600) {
  if (flashTimer) clearTimeout(flashTimer);
  document.getElementById('hintText').textContent = text;
  flashTimer = setTimeout(() => {
    flashTimer = null;
    renderHint();
  }, ms);
}

// ---------- modals ----------
function openModal(id) { document.getElementById(id).hidden = false; }
function closeModal(id) { document.getElementById(id).hidden = true; }

function renderPayoutTable() {
  const grid = document.getElementById('payoutGrid');
  grid.innerHTML = getPayoutTable().map(row => {
    if (row.khan) {
      return `<div class="payout-item payout-khan"><span>${tr('khan')}</span><strong>×${formatMultiplier(row.multiplier)}</strong></div>`;
    }
    return `<div class="payout-item"><span>${row.count}</span><strong>×${formatMultiplier(row.multiplier)}</strong></div>`;
  }).join('');
}

function renderHelpSteps() {
  const container = document.getElementById('helpSteps');
  container.innerHTML = getRulesSteps(state.lang).map((text, i) =>
    `<div class="help-step"><div class="help-num">${i + 1}</div><div>${text}</div></div>`
  ).join('');
}

function setupModals() {
  document.getElementById('infoPayoutBtn').addEventListener('click', () => {
    closeInfoMenu();
    renderPayoutTable();
    openModal('payoutModal');
  });
  document.getElementById('infoHowBtn').addEventListener('click', () => {
    closeInfoMenu();
    renderHelpSteps();
    openModal('helpModal');
    LMS.emit('X2_GAME_HELP_REQUEST', { gameId: state.gameId, language: state.lang, mode: state.mode });
  });
  document.getElementById('infoTicketsBtn').addEventListener('click', () => {
    closeInfoMenu();
    renderTicketsList();
    openModal('ticketsModal');
  });

  ['payout', 'help', 'tickets'].forEach(prefix => {
    const modalId = `${prefix}Modal`;
    document.getElementById(`${prefix}Close`).addEventListener('click', () => closeModal(modalId));
    document.getElementById(`${prefix}Ok`).addEventListener('click', () => closeModal(modalId));
    document.getElementById(modalId).addEventListener('click', (e) => {
      if (e.target.id === modalId) closeModal(modalId);
    });
  });
}

// ---------- info menu (bottom bar) ----------
function closeInfoMenu() {
  const menu = document.getElementById('infoMenu');
  if (menu) menu.hidden = true;
}

// ---------- autoplay ----------
function renderAutoplayCounts() {
  const wrap = document.getElementById('autoplayCounts');
  wrap.innerHTML = (CONFIG.autoPlayCounts || [5, 10, 20, 50]).map(n =>
    `<button type="button" class="autoplay-count" data-count="${n}">${n}</button>`
  ).join('');
}

function closeAutoplayMenu() {
  const menu = document.getElementById('autoplayMenu');
  if (menu) menu.hidden = true;
}

function updateAutoBtnLabel() {
  const btn = document.getElementById('autoBtn');
  if (!state.autoPlay.active) {
    btn.textContent = tr('autoPlay');
    return;
  }
  btn.textContent = state.autoPlay.stopRequested
    ? tr('autoStopping')
    : `${tr('autoStop')} (${state.autoPlay.remaining})`;
}

function startAutoplay(count) {
  if (state.phase === 'animating' || bitaDrag || state.autoPlay.active) return;
  state.autoPlay.active = true;
  state.autoPlay.remaining = count;
  state.autoPlay.stopRequested = false;
  document.getElementById('autoBtn').classList.add('active');
  updateAutoBtnLabel();
  runAutoplayRound();
}

function stopAutoplay() {
  if (!state.autoPlay.active) return;
  state.autoPlay.stopRequested = true;
  updateAutoBtnLabel();
}

function endAutoplay() {
  state.autoPlay.active = false;
  state.autoPlay.remaining = 0;
  state.autoPlay.stopRequested = false;
  document.getElementById('autoBtn').classList.remove('active');
  updateAutoBtnLabel();
  updatePrimaryButton();
}

async function runAutoplayRound() {
  if (!state.autoPlay.active) return;
  if (state.autoPlay.stopRequested || state.autoPlay.remaining <= 0) {
    endAutoplay();
    return;
  }
  if (state.phase === 'animating' || state.phase === 'requesting') {
    setTimeout(runAutoplayRound, 150);
    return;
  }
  const started = await beginRound();
  if (!state.autoPlay.active) return; // stopped while the ticket request was in flight
  if (!started) {
    endAutoplay();
    return;
  }
  state.autoPlay.remaining -= 1;
  updateAutoBtnLabel();
  autoplayStrikeLoop();
}

function findAutoSource() {
  return state.pieces.find(p => p.type === 'normal' && !p.collected && canUseAsSource(p)) || null;
}

function autoStrike(source, target) {
  if (!source.sprite) return;
  strikeTargetWithArc(source, target, source.sprite.x, source.sprite.y);
}

// "Бросок N/3" tap: throws one random chuko that actually has a pair to
// strike (canUseAsSource() already requires getValidTargets().length > 0),
// so a piece with no matching partner is never picked. Lets the player
// alternate freely between dragging manually and just tapping the button.
function strikeRandomPiece() {
  if (state.phase !== 'idle') return;
  if (bitaDrag) cancelBitaDrag();
  const candidates = state.pieces.filter(p => p.type === 'normal' && !p.collected && canUseAsSource(p));
  if (!candidates.length) return;
  const source = candidates[Math.floor(Math.random() * candidates.length)];
  const targets = getValidTargets(source);
  if (!targets.length || !source.sprite) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  strikeTargetWithArc(source, target, source.sprite.x, source.sprite.y);
}

function autoplayStrikeLoop() {
  if (!state.autoPlay.active) return;
  if (state.phase === 'animating' || bitaDrag) {
    setTimeout(autoplayStrikeLoop, 150);
    return;
  }
  const snap = scenario.snapshot();
  if (snap.finished) {
    setTimeout(runAutoplayRound, 500);
    return;
  }
  const source = findAutoSource();
  const target = source ? getValidTargets(source)[0] : null;
  if (!source || !target) {
    setTimeout(autoplayStrikeLoop, 150);
    return;
  }
  autoStrike(source, target);
  setTimeout(autoplayStrikeLoop, 150);
}

// ---------- generic menu close-on-outside-click ----------
function closeAllMenus() {
  closeStakeMenu();
  closeLangMenu();
  closeInfoMenu();
  closeAutoplayMenu();
}

function setupUI() {
  ensureSlots('zone1', 0);
  ensureSlots('zone2', 3);
  renderStakeMenu();
  syncStakeUI();
  applyTranslations();
  applyModeUI();
  applyAudioUI();
  applyHintCollapsed();
  updateBalanceUI();
  updateTicketNumberUI();
  renderAutoplayCounts();
  updateAutoBtnLabel();
  setupModals();
  renderHint();

  document.getElementById('stakeSelect').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!selectorInteractive()) return;
    const menu = document.getElementById('stakeMenu');
    menu.hidden = !menu.hidden;
    document.getElementById('stakeSelect').setAttribute('aria-expanded', String(!menu.hidden));
  });

  document.getElementById('stakeMenu').addEventListener('click', (e) => {
    const option = e.target.closest('.stake-option');
    if (!option || !selectorInteractive()) return;
    selectDenomination(Number(option.dataset.value));
  });

  document.getElementById('langSelect').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('langMenu');
    menu.hidden = !menu.hidden;
    document.getElementById('langSelect').setAttribute('aria-expanded', String(!menu.hidden));
  });

  document.getElementById('langMenu').addEventListener('click', (e) => {
    const opt = e.target.closest('.lang-option');
    if (!opt) return;
    setLanguage(opt.dataset.lang);
    closeLangMenu();
  });

  document.getElementById('hintToggle').addEventListener('click', () => {
    state.hintCollapsed = !state.hintCollapsed;
    applyHintCollapsed();
  });

  document.getElementById('depositBtn').addEventListener('click', () => {
    LMS.emit('X2_GAME_DEPOSIT_REQUEST', { gameId: state.gameId, mode: state.mode, currency: state.currencyCode, denomination: state.denomination, language: state.lang, balance: state.balances[state.mode] });
    // Standalone/mock: no LMS parent to open a top-up form, so tell the player directly.
    if (window.parent === window) flashHint(tr('depositSoon'), 2600);
  });

  document.getElementById('modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    switchMode(btn.dataset.mode);
  });

  document.getElementById('infoBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = document.getElementById('infoMenu');
    menu.hidden = !menu.hidden;
  });

  document.getElementById('soundBtn').addEventListener('click', () => {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem(LS_KEYS.sound, state.soundEnabled ? '1' : '0');
    applyAudioUI();
  });

  document.getElementById('musicBtn').addEventListener('click', () => {
    state.musicEnabled = !state.musicEnabled;
    localStorage.setItem(LS_KEYS.music, state.musicEnabled ? '1' : '0');
    applyAudioUI();
  });

  document.getElementById('autoBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.autoPlay.active) {
      stopAutoplay();
      return;
    }
    const menu = document.getElementById('autoplayMenu');
    menu.hidden = !menu.hidden;
  });

  document.getElementById('autoplayCounts').addEventListener('click', (e) => {
    const btn = e.target.closest('.autoplay-count');
    if (!btn) return;
    closeAutoplayMenu();
    startAutoplay(Number(btn.dataset.count));
  });

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.stake-select, .stake-menu')) closeStakeMenu();
    if (!e.target.closest('.lang-switch')) closeLangMenu();
    if (!e.target.closest('.info-wrap')) closeInfoMenu();
    if (!e.target.closest('.autoplay-wrap')) closeAutoplayMenu();
  });

  document.getElementById('newGameBtn').addEventListener('click', startNewGame);
  setupSceneSettingsUI();
  setupTypeSettingsUI();
  updatePrimaryButton();
}

function setupSceneSettingsUI() {
  const panel = document.getElementById('sceneSettingsPanel');
  const openBtn = document.getElementById('sceneSettingsToggle');
  const closeBtn = document.getElementById('sceneSettingsClose');
  const bind = (id, handler) => document.getElementById(id)?.addEventListener('input', handler);

  const apply = (reroll = true) => {
    CONFIG.scene.chukoScaleMultiplier = Number(document.getElementById('sceneChukoSize').value);
    CONFIG.scene.khanScaleMultiplier = Number(document.getElementById('sceneKhanSize').value);
    const carpetSize = Number(document.getElementById('sceneCarpetSize').value);
    CONFIG.scene.carpetWidth = DEFAULT_SCENE.carpetWidth * carpetSize;
    CONFIG.scene.carpetHeight = DEFAULT_SCENE.carpetHeight * carpetSize;
    CONFIG.scene.carpetCenterY = DEFAULT_SCENE.carpetCenterY + Number(document.getElementById('sceneCarpetY').value);
    CONFIG.scene.pileCenterY = DEFAULT_SCENE.pileCenterY + Number(document.getElementById('scenePileY').value);
    CONFIG.scene.pileSpreadHeightScale = Number(document.getElementById('scenePileHeight').value);
    CONFIG.scene.pileSpreadScale = Number(document.getElementById('sceneSpread').value);

    document.getElementById('valChukoSize').textContent = `${Math.round(CONFIG.scene.chukoScaleMultiplier * 100)}%`;
    document.getElementById('valKhanSize').textContent = `${Math.round(CONFIG.scene.khanScaleMultiplier * 100)}%`;
    document.getElementById('valCarpetSize').textContent = `${Math.round(carpetSize * 100)}%`;
    document.getElementById('valCarpetY').textContent = `${((CONFIG.scene.carpetCenterY - DEFAULT_SCENE.carpetCenterY) * 100).toFixed(1)}%`;
    document.getElementById('valPileY').textContent = `${((CONFIG.scene.pileCenterY - DEFAULT_SCENE.pileCenterY) * 100).toFixed(1)}%`;
    document.getElementById('valPileHeight').textContent = `${CONFIG.scene.pileSpreadHeightScale.toFixed(2)}×`;
    document.getElementById('valSpread').textContent = `${CONFIG.scene.pileSpreadScale.toFixed(2)}×`;

    applySceneLayout();
    if (reroll) randomizeLayout();
    rebuildPieceSprites(false);
  };

  const reset = () => {
    document.getElementById('sceneChukoSize').value = 1;
    document.getElementById('sceneKhanSize').value = 1;
    document.getElementById('sceneCarpetSize').value = 1;
    document.getElementById('sceneCarpetY').value = 0;
    document.getElementById('scenePileY').value = 0;
    document.getElementById('scenePileHeight').value = 1;
    document.getElementById('sceneSpread').value = 1;
    apply(true);
  };

  const copy = async () => {
    const payload = {
      chukoScale: Number(document.getElementById('sceneChukoSize').value),
      khanScale: Number(document.getElementById('sceneKhanSize').value),
      carpetScale: Number(document.getElementById('sceneCarpetSize').value),
      carpetYOffset: Number(document.getElementById('sceneCarpetY').value),
      pileYOffset: Number(document.getElementById('scenePileY').value),
      pileHeight: Number(document.getElementById('scenePileHeight').value),
      spread: Number(document.getElementById('sceneSpread').value),
    };
    const text = JSON.stringify(payload);
    try {
      await navigator.clipboard.writeText(text);
      flashHint(`Параметры скопированы: ${text}`);
    } catch {
      flashHint('Не удалось скопировать параметры');
    }
  };

  [
    'sceneChukoSize','sceneKhanSize','sceneCarpetSize','sceneCarpetY','scenePileY','scenePileHeight','sceneSpread'
  ].forEach(id => bind(id, () => apply(true)));

  document.getElementById('sceneRelayoutBtn')?.addEventListener('click', () => apply(true));
  document.getElementById('sceneResetBtn')?.addEventListener('click', reset);
  document.getElementById('sceneCopyBtn')?.addEventListener('click', copy);
  openBtn?.addEventListener('click', () => {
    document.getElementById('typeSettingsPanel')?.classList.add('hidden');
    panel.classList.toggle('hidden');
  });
  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

  // Sync the sliders FROM config.js before the first apply(), so the panel's
  // hardcoded HTML defaults never silently override CONFIG.scene on load.
  document.getElementById('sceneChukoSize').value = DEFAULT_SCENE.chukoScaleMultiplier;
  document.getElementById('sceneKhanSize').value = DEFAULT_SCENE.khanScaleMultiplier;
  document.getElementById('sceneCarpetSize').value = 1;
  document.getElementById('sceneCarpetY').value = 0;
  document.getElementById('scenePileY').value = 0;
  document.getElementById('scenePileHeight').value = DEFAULT_SCENE.pileSpreadHeightScale;
  document.getElementById('sceneSpread').value = DEFAULT_SCENE.pileSpreadScale;

  apply(false);
}

// Temporary "Aa" panel: live-tunes the --v-* CSS custom properties that
// drive font sizes and row heights for the info-panel / controls /
// bottom-tools rows, so sizing can be picked by eye on a real device and
// copied back as the final values (see :root in styles.css).
const TYPE_VARS = [
  { id: 'typeWalletFont', label: 'valWalletFont', varName: '--v-wallet-font' },
  { id: 'typeInfoLabel', label: 'valInfoLabel', varName: '--v-info-label' },
  { id: 'typeInfoValue', label: 'valInfoValue', varName: '--v-info-value' },
  { id: 'typeControlsFont', label: 'valControlsFont', varName: '--v-controls-font' },
  { id: 'typeControlsHeight', label: 'valControlsHeight', varName: '--v-controls-height' },
  { id: 'typeBottomFont', label: 'valBottomFont', varName: '--v-bottom-font' },
  { id: 'typeBottomHeight', label: 'valBottomHeight', varName: '--v-bottom-height' },
  { id: 'typeHintFont', label: 'valHintFont', varName: '--v-hint-font' },
  { id: 'typeHintShift', label: 'valHintShift', varName: '--v-hint-shift' },
  { id: 'typeInfoPanelShift', label: 'valInfoPanelShift', varName: '--v-info-panel-shift' },
  { id: 'typeUpayZonesShift', label: 'valUpayZonesShift', varName: '--v-upay-zones-shift' },
  { id: 'typeControlsShift', label: 'valControlsShift', varName: '--v-controls-shift' },
  { id: 'typeBottomShift', label: 'valBottomShift', varName: '--v-bottom-shift' },
];

function setupTypeSettingsUI() {
  const panel = document.getElementById('typeSettingsPanel');
  const scenePanel = document.getElementById('sceneSettingsPanel');
  const openBtn = document.getElementById('typeSettingsToggle');
  const closeBtn = document.getElementById('typeSettingsClose');
  const root = document.documentElement;

  const currentPx = (varName) => parseFloat(getComputedStyle(root).getPropertyValue(varName)) || 0;

  const syncSlidersFromCurrent = () => {
    TYPE_VARS.forEach(({ id, label, varName }) => {
      const px = Math.round(currentPx(varName));
      document.getElementById(id).value = px;
      document.getElementById(label).textContent = `${px}px`;
    });
  };

  TYPE_VARS.forEach(({ id, label, varName }) => {
    document.getElementById(id).addEventListener('input', (e) => {
      const px = Number(e.target.value);
      root.style.setProperty(varName, `${px}px`);
      document.getElementById(label).textContent = `${px}px`;
    });
  });

  document.getElementById('typeResetBtn')?.addEventListener('click', () => {
    TYPE_VARS.forEach(({ varName }) => root.style.removeProperty(varName));
    syncSlidersFromCurrent();
  });

  document.getElementById('typeCopyBtn')?.addEventListener('click', async () => {
    const lines = TYPE_VARS.map(({ varName }) => `  ${varName}:${Math.round(currentPx(varName))}px;`);
    // Which set this is depends on the CSS breakpoint active right now
    // (styles.css splits desktop :root from @media(max-width:700px):root),
    // not just the raw window width — label it so a pasted block is
    // unambiguous about where it belongs.
    const isMobileSet = window.matchMedia('(max-width:700px)').matches;
    const header = isMobileSet
      ? '/* MOBILE set — goes inside @media(max-width:700px){ :root{...} } */'
      : '/* DESKTOP set — goes in the top-level :root{...} */';
    const text = `${header}\n:root{\n${lines.join('\n')}\n}`;
    try {
      await navigator.clipboard.writeText(text);
      flashHint(`Скопировано (${isMobileSet ? 'мобильный' : 'десктопный'} набор)`, 2400);
    } catch {
      flashHint(text, 4000);
    }
  });

  openBtn?.addEventListener('click', () => {
    scenePanel?.classList.add('hidden');
    syncSlidersFromCurrent();
    panel.classList.toggle('hidden');
  });
  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

  syncSlidersFromCurrent();
}

function updatePrimaryButton() {
  const btn = document.getElementById('newGameBtn');
  if (!btn) return;
  const snap = scenario.snapshot();
  const roundActive = state.pieces.length > 0 && !snap.finished;
  const busy = state.phase === 'animating' || state.phase === 'requesting';
  let label;
  if (busy) {
    label = `${tr('makeThrow')}…`;
  } else if (roundActive) {
    const stageTotal = snap.stage === 'khan' ? 1 : 3;
    const stageDone = snap.stage === 'khan' ? 0 : snap.strikeIndex;
    label = `${tr('makeThrow')} ${stageDone + 1}/${stageTotal}`;
  } else {
    label = tr('newGame');
  }
  btn.textContent = label;
  btn.classList.toggle('is-active-turn', roundActive || busy);
  btn.classList.toggle('is-busy', busy);
}

function selectorInteractive() {
  return state.phase === 'idle' || state.phase === 'settled';
}

function selectDenomination(value) {
  const n = Number(value);
  if (!selectorInteractive() || !state.denominations.includes(n)) return;
  state.denomination = n;
  syncStakeUI();
  closeStakeMenu();
  LMS.emit('X2_GAME_DENOMINATION_CHANGED', { gameId: state.gameId, denomination: state.denomination, currency: state.currencyCode, language: state.lang, mode: state.mode });
}

function renderStakeMenu() {
  const menu = document.getElementById('stakeMenu');
  menu.innerHTML = state.denominations.map(v =>
    `<button type="button" class="stake-option${v === state.denomination ? ' selected' : ''}" data-value="${v}">${v} ${state.currency}</button>`
  ).join('');
}

function syncStakeUI() {
  document.getElementById('stakeValue').textContent = `${state.denomination} ${state.currency}`;
  renderStakeMenu();
  syncSelectorLock();
  updatePrimaryButton();
}

function syncSelectorLock() {
  const locked = !selectorInteractive();
  document.getElementById('stakeSelect').classList.toggle('locked', locked);
  if (locked) closeStakeMenu();
}

function closeStakeMenu() {
  const menu = document.getElementById('stakeMenu');
  menu.hidden = true;
  document.getElementById('stakeSelect').setAttribute('aria-expanded', 'false');
}

function lmsErrorMessage(code) {
  if (code === 'INSUFFICIENT_FUNDS') return tr('insufficientFunds');
  if (code === 'SESSION_EXPIRED' || code === 'SESSION_MISSING' || code === 'SESSION_TIMEOUT') return tr('sessionEnded');
  return tr('lmsStartError');
}

// The game never picks its own outcome: PayTicket's `scenario` (mapped to
// our SCENARIOS code) and `win`/`balance` are authoritative. The only local
// exception is window.UPAY2D.setScenario() — a QA/dev hook that bypasses
// the network call entirely for deterministic testing.
async function fetchTicket(preRoundBalance) {
  if (state.externalScenarioCode) {
    await new Promise(r => setTimeout(r, 40));
    const multiplier = multiplierForScenario(state.externalScenarioCode);
    const win = state.denomination * multiplier;
    return {
      ticketId: `DBG-${Date.now()}`,
      lmsScenario: lmsIdForScenario(state.externalScenarioCode),
      scenarioCode: state.externalScenarioCode,
      win,
      balance: preRoundBalance - state.denomination + win,
    };
  }
  return state.mode === 'demo'
    // demoBalance is the PRE-stake balance — createDemoTicket() itself
    // subtracts the stake and adds the win, so passing the already
    // client-side-decremented state.balances.demo here would double-count
    // the stake.
    ? LMS.createDemoTicket({ gameId: state.gameId, denomination: state.denomination, currency: state.currencyCode, currencyDisplay: state.currency, language: state.lang, demoBalance: preRoundBalance })
    : LMS.createTicket({ gameId: state.gameId, denomination: state.denomination, currency: state.currencyCode, language: state.lang });
}

async function beginRound() {
  if (state.phase === 'animating' || state.phase === 'requesting') return false;
  if (bitaDrag) cancelBitaDrag();
  closeAllMenus();

  // Optimistic stake deduction on the display so the click feels immediate;
  // rolled back below if PayTicket fails (mirrors the sibling Khan1 game).
  const preRoundBalance = state.balances[state.mode];
  if (preRoundBalance < state.denomination) {
    flashHint(tr('insufficientFunds'));
    return false;
  }
  state.balances[state.mode] = preRoundBalance - state.denomination;
  // 'requesting' locks the stake/mode selectors and busies the main button
  // while PayTicket is in flight, so a second click can't buy two tickets.
  state.phase = 'requesting';
  updateBalanceUI();
  updatePrimaryButton();
  syncSelectorLock();

  let data;
  try {
    data = await fetchTicket(preRoundBalance);
  } catch (err) {
    state.balances[state.mode] = preRoundBalance;
    state.phase = 'idle';
    updateBalanceUI();
    updatePrimaryButton();
    syncSelectorLock();
    const code = err.code || 'GAME_START_ERROR';
    flashHint(lmsErrorMessage(code));
    LMS.emit('X2_GAME_ERROR', { stage: 'newGame', code, message: err.message || String(err) });
    return false;
  }

  if (!data.scenarioCode) {
    state.balances[state.mode] = preRoundBalance;
    state.phase = 'idle';
    updateBalanceUI();
    updatePrimaryButton();
    syncSelectorLock();
    flashHint(tr('lmsStartError'));
    LMS.emit('X2_GAME_ERROR', { stage: 'newGame', code: 'LMS_BAD_RESPONSE', message: `Unknown scenario id: ${data.lmsScenario}` });
    return false;
  }

  state.ticketId = data.ticketId;
  state.lmsScenarioId = data.lmsScenario;
  state.pendingWin = Number(data.win) || 0;
  state.pendingBalance = Number(data.balance);
  updateTicketNumberUI();
  state.settled = false;

  state.phase = 'idle';
  state.selectedSourceId = null;
  state.slots = Array(CONFIG.zones.totalSlots).fill(null);
  scenario.setScenario(data.scenarioCode);

  buildPieces();
  resetSlotDom();
  updateProgress();
  updateRoundStatus();
  renderHint();
  rebuildPieceSprites(true);
  syncSelectorLock();
  updatePrimaryButton();

  LMS.emit('X2_GAME_TICKET_READY', {
    gameId: state.gameId, ticketId: state.ticketId, scenario: state.lmsScenarioId, denomination: state.denomination,
    currency: state.currencyCode, currencyDisplay: state.currency, language: state.lang, mode: state.mode,
  });
  return true;
}

async function startNewGame() {
  if (state.phase === 'animating' || state.phase === 'requesting') return false;
  if (state.autoPlay.active) return false;
  // newGameBtn doubles as the "Бросок N/3" progress readout while a round
  // is in play — it must NOT buy a new ticket on every click then. Instead
  // it throws one random valid chuko for the player (same strike a manual
  // drag would make, just auto-aimed) — a round is only actually over once
  // the scenario is finished.
  const snap = scenario.snapshot();
  if (state.pieces.length > 0 && !snap.finished) {
    strikeRandomPiece();
    return false;
  }
  return beginRound();
}

function buildPieces() {
  state.pieces = [];
  const total = CONFIG.pieces.normalCount;
  const poseBag = [];
  const fullRounds = Math.floor(total / chukoFiles.length);
  for (let r = 0; r < fullRounds; r++) {
    poseBag.push(...shuffle([0, 1, 2, 3]));
  }
  const remainder = total % chukoFiles.length;
  if (remainder) poseBag.push(...shuffle([0, 1, 2, 3]).slice(0, remainder));

  poseBag.forEach((poseIndex, idx) => {
    state.pieces.push({
      id: `C${idx + 1}`,
      type: 'normal',
      poseIndex,
      textureKey: chukoFiles[poseIndex],
      xNorm: 0,
      yNorm: 0,
      rotation: 0,
      scaleBase: 0.16,
      spawnDelay: idx * 2,
      collected: false,
      sprite: null,
    });
  });

  state.pieces.push({
    id: 'KHAN',
    type: 'khan',
    textureKey: khanFiles[Math.floor(Math.random() * khanFiles.length)],
    xNorm: CONFIG.scene.pileCenterX,
    yNorm: CONFIG.scene.pileCenterY,
    rotation: (Math.random() - 0.5) * 0.18,
    scaleBase: CONFIG.pieces.khanScale,
    spawnDelay: 10,
    collected: false,
    sprite: null,
  });
  randomizeLayout();
}

function randomizeLayout() {
  const normal = state.pieces.filter(p => p.type === 'normal');
  const scene = getSceneMetrics();
  const ringDefs = [
    { radiusX: scene.spreadX[0], radiusY: scene.spreadY[0], offset: -86 },
    { radiusX: scene.spreadX[1], radiusY: scene.spreadY[1], offset: -48 },
    { radiusX: scene.spreadX[2], radiusY: scene.spreadY[2], offset: -12 },
  ];
  const baseSectorAngles = [0, 72, 144, 216, 288];
  const positions = [];

  ringDefs.forEach((ring, ringIndex) => {
    const sectorOrder = shuffle([0, 1, 2, 3, 4]);
    sectorOrder.forEach((sector, localIndex) => {
      const angleDeg = ring.offset + baseSectorAngles[sector] + (Math.random() - 0.5) * 16;
      const angle = angleDeg * Math.PI / 180;
      positions.push({
        ringIndex,
        sectorIndex: sector,
        xNorm: scene.cx + Math.cos(angle) * ring.radiusX + (Math.random() - 0.5) * 0.014,
        yNorm: scene.cy + Math.sin(angle) * ring.radiusY + (Math.random() - 0.5) * 0.014,
        rotation: (Math.random() - 0.5) * 0.72,
        scaleBase: CONFIG.pieces.scaleMin + Math.random() * (CONFIG.pieces.scaleMax - CONFIG.pieces.scaleMin),
        zBias: localIndex,
      });
    });
  });

  const shuffledPositions = shuffle(positions);
  const shuffledPieces = shuffle(normal);
  shuffledPieces.forEach((piece, i) => {
    const pos = shuffledPositions[i % shuffledPositions.length];
    piece.xNorm = clamp(pos.xNorm, 0.18, 0.82);
    piece.yNorm = clamp(pos.yNorm, 0.30, 0.64);
    piece.rotation = pos.rotation;
    piece.scaleBase = pos.scaleBase;
    piece.ringIndex = pos.ringIndex;
    piece.sectorIndex = pos.sectorIndex;
  });

  const khan = getKhanPiece();
  if (khan) {
    khan.xNorm = scene.cx;
    khan.yNorm = scene.cy;
    khan.rotation = (Math.random() - 0.5) * 0.12;
  }
}

function resolveAllPieceOverlaps() {
  const active = state.pieces.filter(p => p?.sprite && !p.collected);
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const ra = getPieceCollisionRadius(a);
        const rb = getPieceCollisionRadius(b);
        const minDist = (ra + rb) * (b.type === 'khan' || a.type === 'khan' ? 1.10 : 1.08);
        const dx = b.sprite.x - a.sprite.x;
        const dy = b.sprite.y - a.sprite.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist >= minDist) continue;
        moved = true;
        const overlap = (minDist - dist) + 0.8;
        const ux = dx / dist;
        const uy = dy / dist;
        if (a.type === 'khan' && b.type !== 'khan') {
          b.sprite.x += ux * overlap;
          b.sprite.y += uy * overlap;
        } else if (b.type === 'khan' && a.type !== 'khan') {
          a.sprite.x -= ux * overlap;
          a.sprite.y -= uy * overlap;
        } else {
          a.sprite.x -= ux * overlap * 0.5;
          a.sprite.y -= uy * overlap * 0.5;
          b.sprite.x += ux * overlap * 0.5;
          b.sprite.y += uy * overlap * 0.5;
        }
      }
    }
    for (const p of active) {
      if (p.type === 'khan') continue;
      const inside = keepPointInsideCarpet(p.sprite.x, p.sprite.y, getPieceCollisionRadius(p) * 0.45);
      p.sprite.x = inside.x;
      p.sprite.y = inside.y;
    }
    const kh = getKhanPiece();
    if (kh?.sprite) {
      kh.sprite.x = CONFIG.scene.pileCenterX * app.renderer.width;
      kh.sprite.y = CONFIG.scene.pileCenterY * app.renderer.height;
    }
    if (!moved) break;
  }
  active.forEach(p => {
    p.xNorm = p.sprite.x / app.renderer.width;
    p.yNorm = p.sprite.y / app.renderer.height;
  });
}


function rebuildPieceSprites(animate) {
  hintLayer.removeChildren();
  pieceLayer.removeChildren();
  selectionRing.visible = false;
  for (const p of state.pieces) {
    if (p.collected) continue;
    const sprite = new Sprite(textures[p.textureKey]);
    sprite.anchor.set(0.5);
    if (p.type === 'normal') {
      sprite.eventMode = 'static';
      sprite.cursor = 'pointer';
      sprite.on('pointerdown', () => onPiecePointerDown(p));
    } else {
      sprite.eventMode = 'none';
    }
    p.sprite = sprite;
    pieceLayer.addChild(sprite);
    positionSprite(p);
    if (animate) animateScatterIn(p);
  }
  resolveAllPieceOverlaps();
  refreshPieceVisuals();
}

function positionSprite(p) {
  if (!p.sprite) return;
  const w = app.renderer.width;
  const h = app.renderer.height;
  p.sprite.x = p.xNorm * w;
  p.sprite.y = p.yNorm * h;
  p.sprite.rotation = p.rotation;
  const responsive = w / 941;
  const sizeMul = p.type === 'khan' ? (CONFIG.scene.khanScaleMultiplier ?? 1) : (CONFIG.scene.chukoScaleMultiplier ?? 1);
  p.sprite.scale.set(p.scaleBase * responsive * sizeMul);
  p.sprite.zIndex = p.type === 'khan' ? 20 : 5;
}

function onPiecePointerDown(piece) {
  if (piece.collected || state.phase === 'animating' || state.phase === 'settled') return;
  if (bitaDrag) return;
  if (piece.type !== 'normal') return;

  const source = getSelectedSource();
  if (!source) {
    if (!canUseAsSource(piece)) {
      flashHint(tr('noValidPair'));
      pulseSprite(piece.sprite, 0.08);
      return;
    }
    state.selectedSourceId = piece.id;
    state.phase = 'aiming';
    renderHint();
    refreshPieceVisuals();
    startBitaDrag(piece);
    return;
  }

  if (source.id === piece.id) {
    startBitaDrag(source);
    return;
  }

  flashHint(tr('dragSelected'));
}

function nextSlotIndexForStage(stage) {
  if (stage === 'stage1') return state.slots.slice(0, 3).findIndex(v => v === null);
  if (stage === 'stage2') {
    const idx = state.slots.slice(3, 6).findIndex(v => v === null);
    return idx === -1 ? -1 : 3 + idx;
  }
  return -1;
}

function strikeTargetWithArc(source, target, launchX, launchY) {
  state.phase = 'animating';
  syncSelectorLock();
  state.selectedSourceId = null;
  clearAimGuide();
  refreshPieceVisuals();

  const stageAtStrike = scenario.snapshot().stage;
  const { hit } = scenario.resolveStrike();
  const isKhanTarget = target.type === 'khan';
  const slotIndex = (hit && !isKhanTarget) ? nextSlotIndexForStage(stageAtStrike) : -1;

  const shot = getShotVector(source, target);
  let sourceDone = false;
  let targetDone = false;

  const finalize = () => {
    if (!sourceDone || !targetDone) return;
    const after = scenario.snapshot();
    state.phase = after.finished ? 'settled' : 'idle';
    updateRoundStatus();
    renderHint();
    syncSelectorLock();
    refreshPieceVisuals();
  };

  animateArcFlight(source, launchX, launchY, target.sprite.x, target.sprite.y, () => {
    impactBurst(target.sprite.x, target.sprite.y);
    nudgeNearbyPieces(target, source);
    if (hit) shakeHost(2, 10);

    if (hit && isKhanTarget) {
      celebrateKhan(target);
      animateKickOutToEdge(target, shot, () => {
        target.collected = true;
        targetDone = true;
        finalize();
      });
    } else if (hit && slotIndex >= 0) {
      animateKickOutToEdge(target, shot, () => {
        // Brief pause so the "landing" at the carpet edge reads clearly
        // before the piece lifts off again toward the УПАЙ plaque.
        setTimeout(() => {
          animateToSlot(target, slotIndex, source, () => {
            target.collected = true;
            target.sprite = null;
            state.slots[slotIndex] = { textureKey: target.textureKey };
            updateSlotDom(slotIndex, target.textureKey);
            updateProgress();
            targetDone = true;
            finalize();
          });
        }, 260);
      });
    } else {
      animateMissReaction(target, shot, () => {
        targetDone = true;
        finalize();
      });
    }

    animateSourceSettleAfterArc(source, [target.id], () => {
      sourceDone = true;
      finalize();
    });
  });
}

function startBitaDrag(piece) {
  if (!piece?.sprite) return;
  bitaDrag = {
    piece,
    startX: piece.sprite.x,
    startY: piece.sprite.y,
    baseRotation: piece.sprite.rotation,
    guide: null,
    power: 0,
    aimedTargetId: null,
  };
  app.stage.on('pointermove', onBitaPointerMove);
  piece.sprite.on('pointerup', onBitaPointerUp);
  piece.sprite.on('pointerupoutside', onBitaPointerUp);
  refreshPieceVisuals();
}

function onBitaPointerMove(event) {
  if (!bitaDrag) return;
  const sprite = bitaDrag.piece.sprite;
  if (!sprite) return;
  const tuning = CONFIG.throwTuning;
  const p = event.global;
  const pullX = p.x - bitaDrag.startX;
  const pullY = p.y - bitaDrag.startY;
  const pullLen = Math.hypot(pullX, pullY);

  if (pullLen < 1) {
    bitaDrag.guide = null;
    bitaDrag.power = 0;
    sprite.x = bitaDrag.startX;
    sprite.y = bitaDrag.startY;
    sprite.rotation = bitaDrag.baseRotation;
  } else {
    const guide = { x: -pullX / pullLen, y: -pullY / pullLen };
    const capped = Math.min(tuning.maxPull, pullLen);
    bitaDrag.guide = guide;
    bitaDrag.power = capped / tuning.maxPull;
    sprite.x = bitaDrag.startX - guide.x * capped;
    sprite.y = bitaDrag.startY - guide.y * capped;
    sprite.rotation = bitaDrag.baseRotation + (bitaDrag.startX - sprite.x) * tuning.rotationPerPull;
  }

  updateAimHighlight();
  drawAimGuide();
  updateSelectionRing();
}

function updateAimHighlight() {
  if (!bitaDrag) return;
  const tuning = CONFIG.throwTuning;
  const targets = getValidTargets(bitaDrag.piece);
  let aimedId = null;

  if (bitaDrag.guide && bitaDrag.power >= tuning.minPowerToAim && targets.length) {
    let best = null;
    let bestAngle = Infinity;
    for (const t of targets) {
      if (!t.sprite) continue;
      const dx = t.sprite.x - bitaDrag.startX;
      const dy = t.sprite.y - bitaDrag.startY;
      const dist = Math.hypot(dx, dy) || 1;
      const dot = clamp((dx / dist) * bitaDrag.guide.x + (dy / dist) * bitaDrag.guide.y, -1, 1);
      const angleDeg = Math.acos(dot) * 180 / Math.PI;
      if (angleDeg < bestAngle) {
        bestAngle = angleDeg;
        best = t;
      }
    }
    if (best && bestAngle <= tuning.aimToleranceDeg) aimedId = best.id;
  }

  if (bitaDrag.aimedTargetId !== aimedId) {
    bitaDrag.aimedTargetId = aimedId;
    refreshPieceVisuals();
  }
}

function drawAimGuide() {
  aimGuide.clear();
  if (!bitaDrag || !bitaDrag.guide || bitaDrag.power < CONFIG.throwTuning.minPowerToAim) {
    aimGuide.visible = false;
    return;
  }
  const tuning = CONFIG.throwTuning;
  aimGuide.visible = true;
  const startX = bitaDrag.startX;
  const startY = bitaDrag.startY;
  const aimedTarget = bitaDrag.aimedTargetId ? state.pieces.find(p => p.id === bitaDrag.aimedTargetId) : null;
  const color = aimedTarget ? tuning.aimedColor : tuning.unaimedGuideColor;
  const len = aimedTarget?.sprite
    ? Math.hypot(aimedTarget.sprite.x - startX, aimedTarget.sprite.y - startY)
    : 150 + bitaDrag.power * 90;
  const ux = bitaDrag.guide.x;
  const uy = bitaDrag.guide.y;
  const dash = 14;
  const gap = 9;
  for (let d = 0; d < len; d += dash + gap) {
    const d2 = Math.min(len, d + dash);
    aimGuide.moveTo(startX + ux * d, startY + uy * d).lineTo(startX + ux * d2, startY + uy * d2);
  }
  aimGuide.stroke({ color, width: 4, alpha: 0.85, cap: 'round' });
  if (aimedTarget) {
    aimGuide.circle(startX + ux * len, startY + uy * len, 5).fill({ color, alpha: 0.9 });
  }
}

function clearAimGuide() {
  aimGuide.clear();
  aimGuide.visible = false;
}

function onBitaPointerUp() {
  if (!bitaDrag) return;
  const drag = bitaDrag;
  bitaDrag = null;
  app.stage.off('pointermove', onBitaPointerMove);
  drag.piece.sprite?.off('pointerup', onBitaPointerUp);
  drag.piece.sprite?.off('pointerupoutside', onBitaPointerUp);
  clearAimGuide();

  const source = drag.piece;
  if (!source?.sprite) {
    refreshPieceVisuals();
    return;
  }

  const tuning = CONFIG.throwTuning;
  const target = drag.aimedTargetId ? state.pieces.find(p => p.id === drag.aimedTargetId && !p.collected) : null;

  if (!target || drag.power < tuning.minPowerToAim) {
    animateSnapBack(source, drag.startX, drag.startY, drag.baseRotation);
    state.selectedSourceId = null;
    state.phase = 'idle';
    renderHint();
    refreshPieceVisuals();
    return;
  }

  const launchX = source.sprite.x;
  const launchY = source.sprite.y;
  strikeTargetWithArc(source, target, launchX, launchY);
}

function cancelBitaDrag() {
  if (!bitaDrag) return;
  app.stage.off('pointermove', onBitaPointerMove);
  bitaDrag.piece.sprite?.off('pointerup', onBitaPointerUp);
  bitaDrag.piece.sprite?.off('pointerupoutside', onBitaPointerUp);
  bitaDrag = null;
  clearAimGuide();
}

function animateSnapBack(piece, x, y, rotation) {
  const sprite = piece.sprite;
  if (!sprite) return;
  const sx = sprite.x, sy = sprite.y, sr = sprite.rotation;
  let f = 0;
  const duration = 10;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const e = easeOutCubic(t);
    sprite.x = sx + (x - sx) * e;
    sprite.y = sy + (y - sy) * e;
    sprite.rotation = sr + (rotation - sr) * e;
    if (t >= 1) {
      sprite.x = x;
      sprite.y = y;
      sprite.rotation = rotation;
      app.ticker.remove(tick);
    }
  }
}

function canUseAsSource(piece) {
  return piece.type === 'normal' && !piece.collected && getValidTargets(piece).length > 0;
}

function isValidTarget(source, target) {
  if (!source || !target || source.id === target.id) return false;
  if (source.type !== 'normal' || source.collected || target.collected) return false;
  const stage = scenario.snapshot().stage;
  if (stage === 'khan') return target.type === 'khan';
  return target.type === 'normal' && source.poseIndex === target.poseIndex;
}

function getValidTargets(source) {
  return state.pieces.filter(p => isValidTarget(source, p));
}

function getSelectedSource() {
  return state.pieces.find(p => p.id === state.selectedSourceId && !p.collected) || null;
}

function getKhanPiece() {
  return state.pieces.find(p => p.type === 'khan' && !p.collected) || null;
}

function refreshPieceVisuals() {
  const source = getSelectedSource();
  const dragging = !!bitaDrag;
  const aimedId = bitaDrag?.aimedTargetId || null;
  const validTargetIds = new Set(source && !dragging ? getValidTargets(source).map(p => p.id) : []);

  hintLayer.removeChildren();

  for (const p of state.pieces) {
    if (!p.sprite || p.collected) continue;
    const selected = p.id === state.selectedSourceId;
    const selectableSource = !source && canUseAsSource(p);
    const validTarget = validTargetIds.has(p.id);
    const aimed = dragging && p.id === aimedId;

    const baseTint = 0xffffff;
    let displayTint = baseTint;
    if (selected) displayTint = mixHex(baseTint, 0xf4fbff, 0.14);
    else if (aimed) displayTint = mixHex(baseTint, 0xf5ffb0, 0.16);
    else if (validTarget) displayTint = mixHex(baseTint, 0xfff3cf, 0.12);
    else if (selectableSource) displayTint = mixHex(baseTint, 0xf2fcff, 0.10);
    if (!(p.type === 'khan' && khanGlowTick)) p.sprite.tint = displayTint;

    let alpha = 0.96;
    if (source) alpha = (selected || validTarget || aimed || p.type === 'khan') ? 1 : (dragging ? 0.5 : 0.56);
    else alpha = selectableSource || p.type === 'khan' ? 1 : 0.90;
    p.sprite.alpha = alpha;
    p.sprite.zIndex = selected ? 40 : (validTarget || aimed) ? 24 : (p.type === 'khan' ? 20 : 5);

    if (selectableSource) addHintMarker(p, 0x68d9ff, 0.11, 0.90);
    if (aimed) addHintMarker(p, CONFIG.throwTuning.aimedColor, 0.24, 1.22);
    else if (validTarget) addHintMarker(p, 0xf0c66c, 0.16, 1.08);
  }
  updateSelectionRing();
  updatePrimaryButton();
  updateKhanGlowState();
}

function addHintMarker(piece, color, alpha = 0.2, scaleBoost = 1) {
  if (!piece.sprite) return;
  const g = new Graphics();
  g.zIndex = 2;
  g.position.set(piece.sprite.x, piece.sprite.y);
  g.rotation = piece.sprite.rotation;
  const rw = piece.sprite.width * 0.34 * scaleBoost;
  const rh = piece.sprite.height * 0.29 * scaleBoost;
  g.ellipse(0, 0, rw, rh);
  g.fill({ color, alpha });
  g.ellipse(0, 0, rw * 1.05, rh * 1.05);
  g.stroke({ color, width: 2, alpha: Math.min(0.95, alpha + 0.35) });
  hintLayer.addChild(g);
}

function updateSelectionRing() {
  const source = getSelectedSource();
  selectionRing.clear();
  if (!source?.sprite) {
    selectionRing.visible = false;
    return;
  }
  const sprite = source.sprite;
  const w = sprite.width;
  const h = sprite.height;
  selectionRing.visible = true;
  selectionRing.position.set(sprite.x, sprite.y);
  selectionRing.rotation = sprite.rotation;
  selectionRing.ellipse(0, 0, w * 0.44, h * 0.40);
  selectionRing.stroke({ color: CONFIG.ui.selectedGlow, width: 4, alpha: 0.95 });
  selectionRing.ellipse(0, 0, w * 0.52, h * 0.48);
  selectionRing.stroke({ color: 0xffffff, width: 1.5, alpha: 0.85 });
}

function ensureSlots(zoneId, startIndex) {
  const zone = document.getElementById(zoneId);
  zone.innerHTML = '';
  for (let i = 0; i < CONFIG.zones.slotsPerUpay; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.slotIndex = String(startIndex + i);
    zone.appendChild(slot);
  }
}

function resetSlotDom() {
  document.querySelectorAll('.slot').forEach(slot => {
    slot.innerHTML = '';
    slot.classList.remove('filled');
  });
}

function updateSlotDom(slotIndex, textureKey) {
  const slot = document.querySelector(`.slot[data-slot-index="${slotIndex}"]`);
  if (!slot) return;
  const img = document.createElement('img');
  img.src = textureKey.replace('./', '');
  slot.innerHTML = '';
  slot.appendChild(img);
  slot.classList.add('filled');
}

function updateProgress() {
  const c1 = state.slots.slice(0, 3).filter(Boolean).length;
  const c2 = state.slots.slice(3, 6).filter(Boolean).length;
  document.getElementById('infoUpay1').textContent = `${c1}/3`;
  document.getElementById('infoUpay2').textContent = `${c2}/3`;
}

// Only ever reveals a multiplier the player has actually earned the right to
// see (a stage that has fully resolved) — never the pre-scripted final
// outcome, which stays hidden until the round is actually over.
function computeRevealedMultiplier(snap) {
  const c1 = snap.stage1Total;
  if (snap.stage === 'stage1') {
    if (!snap.finished) return null;
    if (c1 === 0) return 0;
    if (c1 === 1) return 0.2;
    return 0.5;
  }
  if (snap.stage === 'stage2') {
    if (!snap.finished) return 1.5;
    const total = c1 + snap.stage2Total;
    if (total === 3) return 1.5;
    if (total === 4) return 3;
    return 5;
  }
  if (snap.stage === 'khan') {
    if (!snap.finished) return 10;
    return snap.khanHit ? 500 : 10;
  }
  return snap.multiplier ?? 0;
}

function formatMultiplier(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ',');
}

function settleRoundIfNeeded(snap, revealed) {
  if (state.settled) return;
  state.settled = true;
  // Money moves exactly as PayTicket said it would — `win`/`balance` here
  // are LMS-authoritative (state.pendingWin/pendingBalance), never
  // recomputed locally. `revealed` only drives what's shown mid-round.
  const winAmount = state.pendingWin ?? (state.denomination * (revealed ?? 0));
  state.balances[state.mode] = state.pendingBalance != null ? state.pendingBalance : state.balances[state.mode] + winAmount;
  saveBalances();
  updateBalanceUI();
  saveTicket(state.mode, {
    id: state.ticketId,
    denomination: state.denomination,
    multiplier: revealed ?? 0,
    win: winAmount,
    ts: Date.now(),
  });
  LMS.emit('X2_GAME_ROUND_COMPLETE', {
    gameId: state.gameId, ticketId: state.ticketId, scenario: state.lmsScenarioId, win: winAmount,
    balance: state.balances[state.mode], denomination: state.denomination, currency: state.currencyCode,
    currencyDisplay: state.currency, language: state.lang, mode: state.mode,
  });
}

function updateRoundStatus() {
  const snap = scenario.snapshot();

  const khanEl = document.getElementById('infoKhan');
  khanEl.textContent = (snap.stage === 'khan' && snap.finished)
    ? (snap.khanHit ? tr('knockedOut') : tr('stood'))
    : '—';

  const revealed = computeRevealedMultiplier(snap);
  document.getElementById('infoWin').textContent = revealed === null
    ? '0'
    : formatMoney(state.denomination * revealed);

  if (snap.finished) settleRoundIfNeeded(snap, revealed);
}

function animateScatterIn(piece) {
  const sprite = piece.sprite;
  if (!sprite) return;
  const tx = sprite.x, ty = sprite.y, ts = sprite.scale.x, tr = sprite.rotation;
  const w = app.renderer.width, h = app.renderer.height;
  const startX = (0.14 + Math.random() * 0.06) * w;
  const startY = (0.33 + Math.random() * 0.05) * h;
  sprite.x = startX;
  sprite.y = startY;
  sprite.scale.set(ts * 0.30);
  sprite.rotation = tr + (Math.random() - 0.5) * 1.2;
  sprite.alpha = 0;
  let f = 0;
  const delay = piece.spawnDelay ?? 0;
  const duration = 22 + Math.floor(Math.random() * 6);
  app.ticker.add(tick);
  function tick() {
    f++;
    if (f <= delay) return;
    const t = Math.min(1, (f - delay) / duration);
    const e = easeOutCubic(t);
    sprite.x = startX + (tx - startX) * e;
    sprite.y = startY + (ty - startY) * e - Math.sin(Math.PI * e) * (piece.type === 'khan' ? 18 : 12);
    sprite.scale.set(ts * (0.30 + 0.70 * e));
    sprite.rotation = tr + (1 - e) * 0.25;
    sprite.alpha = Math.min(1, e * 1.5);
    if (t >= 1) {
      sprite.rotation = tr;
      app.ticker.remove(tick);
    }
  }
}

function animateToSlot(piece, slotIndex, sourcePiece, onDone) {
  const sprite = piece.sprite;
  if (!sprite) return onDone?.();
  const slotEl = document.querySelector(`.slot[data-slot-index="${slotIndex}"]`);
  if (!slotEl) return onDone?.();
  const slotRect = slotEl.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  // slotRect/hostRect are in visual CSS pixels (post CSS transform on desktop),
  // while sprite coordinates live in PIXI's internal render resolution (which
  // does not shrink with the shell's transform:scale). Convert into that space.
  const scaleX = app.renderer.width / hostRect.width;
  const scaleY = app.renderer.height / hostRect.height;
  const tx = (slotRect.left - hostRect.left + slotRect.width / 2) * scaleX;
  const ty = (slotRect.top - hostRect.top + slotRect.height / 2) * scaleY;
  const sx = sprite.x, sy = sprite.y, ss = sprite.scale.x, sr = sprite.rotation;
  const targetScale = ss * 0.42;
  const apex = Math.max(52, Math.min(96, Math.abs(ty - sy) * 0.36 + 46));
  let f = 0;
  const pauseFrames = 4;
  const duration = 38;
  app.ticker.add(tick);
  function tick() {
    f++;
    if (f <= pauseFrames) {
      sprite.rotation = sr + Math.sin((f / pauseFrames) * Math.PI) * 0.018;
      return;
    }
    const t = Math.min(1, (f - pauseFrames) / duration);
    const e = easeOutCubic(t);
    sprite.x = sx + (tx - sx) * e;
    sprite.y = sy + (ty - sy) * e - Math.sin(Math.PI * e) * apex;
    sprite.rotation = sr + e * 0.9;
    sprite.scale.set(ss + (targetScale - ss) * e);
    sprite.alpha = 1 - e * 0.88;
    if (t >= 1) {
      app.ticker.remove(tick);
      sprite.destroy();
      onDone?.();
    }
  }
}

function animateArcFlight(piece, startX, startY, targetX, targetY, onImpact) {
  const sprite = piece.sprite;
  if (!sprite) return onImpact?.();

  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const impactGap = Math.max(sprite.width * 0.16, 14);
  const impactX = targetX - ux * impactGap;
  const impactY = targetY - uy * impactGap;

  const tuning = CONFIG.throwTuning;
  const arcCx = (startX + impactX) / 2;
  const arcCy = Math.min(startY, impactY) - tuning.arcHeight;
  const baseScale = sprite.scale.x;
  const startRotation = piece.rotation;
  const origZ = sprite.zIndex;

  sprite.x = startX;
  sprite.y = startY;
  sprite.rotation = startRotation;
  sprite.zIndex = 60;

  let f = 0;
  const duration = tuning.flightDurationFrames;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const omt = 1 - t;
    sprite.x = omt * omt * startX + 2 * omt * t * arcCx + t * t * impactX;
    sprite.y = omt * omt * startY + 2 * omt * t * arcCy + t * t * impactY;
    const lift = Math.sin(Math.PI * t);
    sprite.scale.set(baseScale * (1 + lift * tuning.arcScaleBoost));
    sprite.rotation = startRotation + t * 1.05;
    if (t >= 1) {
      app.ticker.remove(tick);
      sprite.x = impactX;
      sprite.y = impactY;
      sprite.scale.set(baseScale);
      sprite.zIndex = origZ;
      onImpact?.();
    }
  }
}

function animateSourceSettleAfterArc(piece, ignoreIds, onDone) {
  const sprite = piece.sprite;
  if (!sprite) return onDone?.();
  const sr = sprite.rotation;
  let f = 0;
  const duration = 14;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const e = easeOutCubic(t);
    sprite.rotation = sr + Math.sin(Math.PI * e) * 0.08;
    if (t >= 1) {
      sprite.rotation = sr;
      separateFromOverlaps(piece, ignoreIds);
      app.ticker.remove(tick);
      onDone?.();
    }
  }
}

function getShotVector(source, target) {
  const sx = source.sprite?.x ?? (source.xNorm * app.renderer.width);
  const sy = source.sprite?.y ?? (source.yNorm * app.renderer.height);
  const tx = target.sprite?.x ?? (target.xNorm * app.renderer.width);
  const ty = target.sprite?.y ?? (target.yNorm * app.renderer.height);
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.max(1, Math.hypot(dx, dy));
  return { ux: dx / dist, uy: dy / dist };
}

function getCarpetBoundaryPoint(ux, uy, padding = 0) {
  const w = app.renderer.width;
  const h = app.renderer.height;
  const cx = CONFIG.scene.carpetCenterX * w;
  const cy = CONFIG.scene.carpetCenterY * h;
  const rx = (CONFIG.scene.carpetWidth * w * 0.5) * 0.90 + padding;
  const ry = (CONFIG.scene.carpetHeight * h * 0.5) * 0.90 + padding;
  const denom = Math.sqrt((ux * ux) / (rx * rx) + (uy * uy) / (ry * ry));
  const dist = denom > 0 ? 1 / denom : 0;
  return { x: cx + ux * dist, y: cy + uy * dist };
}


function getPieceCollisionRadius(piece) {
  const sprite = piece?.sprite;
  if (!sprite) return 22;
  return Math.max(16, Math.min(sprite.width, sprite.height) * 0.33);
}

function keepPointInsideCarpet(x, y, padding = 0) {
  const w = app.renderer.width;
  const h = app.renderer.height;
  const cx = CONFIG.scene.carpetCenterX * w;
  const cy = CONFIG.scene.carpetCenterY * h;
  const rx = (CONFIG.scene.carpetWidth * w * 0.5) * 0.88 - padding;
  const ry = (CONFIG.scene.carpetHeight * h * 0.5) * 0.88 - padding;
  const nx = (x - cx) / Math.max(1, rx);
  const ny = (y - cy) / Math.max(1, ry);
  const norm = Math.hypot(nx, ny);
  if (norm <= 1) return { x, y };
  const k = 0.985 / norm;
  return { x: cx + (x - cx) * k, y: cy + (y - cy) * k };
}

function separateFromOverlaps(primaryPiece, ignoreIds = []) {
  const sprite = primaryPiece?.sprite;
  if (!sprite) return;
  const ignore = new Set(ignoreIds);
  const baseRadius = getPieceCollisionRadius(primaryPiece);

  for (let iter = 0; iter < 16; iter++) {
    let moved = false;
    for (const other of state.pieces) {
      if (!other?.sprite || other.id === primaryPiece.id || other.collected || ignore.has(other.id)) continue;
      const minDist = (baseRadius + getPieceCollisionRadius(other)) * (other.type === 'khan' ? 1.08 : 1.06);
      const dx = sprite.x - other.sprite.x;
      const dy = sprite.y - other.sprite.y;
      const dist = Math.hypot(dx, dy) || 0.0001;
      if (dist >= minDist) continue;
      const push = (minDist - dist) + 0.8;
      const ux = dx / dist;
      const uy = dy / dist;
      sprite.x += ux * push;
      sprite.y += uy * push;
      moved = true;
    }
    const inside = keepPointInsideCarpet(sprite.x, sprite.y, baseRadius * 0.45);
    sprite.x = inside.x;
    sprite.y = inside.y;
    if (!moved) break;
  }

  primaryPiece.xNorm = sprite.x / app.renderer.width;
  primaryPiece.yNorm = sprite.y / app.renderer.height;
}

function animateKickOutToEdge(piece, shot, onDone) {
  const sprite = piece?.sprite;
  if (!sprite) return onDone?.();
  const sx = sprite.x, sy = sprite.y, sr = sprite.rotation, ss = sprite.scale.x;
  const padding = Math.max(sprite.width, sprite.height) * 0.10;
  const boundary = getCarpetBoundaryPoint(shot.ux, shot.uy, padding);
  const extra = Math.max(14, Math.min(28, Math.max(sprite.width, sprite.height) * 0.22));
  const edgeX = boundary.x + shot.ux * extra;
  const edgeY = boundary.y + shot.uy * extra;
  const clampMargin = 10;
  const targetX = clamp(edgeX, clampMargin, app.renderer.width - clampMargin);
  const targetY = clamp(edgeY, clampMargin, app.renderer.height - clampMargin);
  const preX = sx + shot.ux * Math.max(10, Math.min(20, sprite.width * 0.18));
  const preY = sy + shot.uy * Math.max(8, Math.min(16, sprite.height * 0.14));
  const lift = Math.min(14, Math.max(5, sprite.height * 0.06));
  let f = 0;
  const duration = 34;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    if (t < 0.16) {
      const e = easeOutCubic(t / 0.16);
      sprite.x = sx + (preX - sx) * e;
      sprite.y = sy + (preY - sy) * e;
      sprite.rotation = sr + 0.10 * e * (shot.ux >= 0 ? 1 : -1);
      sprite.scale.set(ss * (1 + 0.02 * e));
    } else {
      const e = easeOutCubic((t - 0.16) / 0.84);
      sprite.x = preX + (targetX - preX) * e;
      sprite.y = preY + (targetY - preY) * e - Math.sin(Math.PI * e) * lift;
      sprite.rotation = sr + (0.10 + 0.18 * e) * (shot.ux >= 0 ? 1 : -1);
      const scalePulse = 1 + Math.sin(Math.PI * e) * 0.025;
      sprite.scale.set(ss * scalePulse);
    }
    if (t >= 1) {
      sprite.x = targetX;
      sprite.y = targetY;
      sprite.rotation = sr + 0.28 * (shot.ux >= 0 ? 1 : -1);
      sprite.scale.set(ss);
      separateFromOverlaps(piece);
      app.ticker.remove(tick);
      onDone?.();
    }
  }
}

function animateMissReaction(piece, shot, onDone) {
  const sprite = piece?.sprite;
  if (!sprite) return onDone?.();
  const sx = sprite.x, sy = sprite.y, sr = sprite.rotation;
  const push = Math.max(14, sprite.width * 0.18);
  const kickX = sx + shot.ux * push;
  const kickY = sy + shot.uy * push * 0.75;
  let f = 0;
  const duration = 16;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    if (t < 0.40) {
      const e = easeOutCubic(t / 0.40);
      sprite.x = sx + (kickX - sx) * e;
      sprite.y = sy + (kickY - sy) * e - Math.sin(Math.PI * e) * 3;
      sprite.rotation = sr + 0.12 * e;
    } else {
      const e = easeOutCubic((t - 0.40) / 0.60);
      sprite.x = kickX + (sx - kickX) * e;
      sprite.y = kickY + (sy - kickY) * e;
      sprite.rotation = sr + 0.12 * (1 - e);
    }
    if (t >= 1) {
      sprite.x = sx;
      sprite.y = sy;
      sprite.rotation = sr;
      separateFromOverlaps(piece);
      app.ticker.remove(tick);
      onDone?.();
    }
  }
}

function pulseSprite(sprite, intensity = 0.12) {
  if (!sprite) return;
  if (sprite.__pulseTick) {
    app.ticker.remove(sprite.__pulseTick);
    sprite.scale.set(sprite.__pulseBase);
  }
  const base = sprite.__pulseBase ?? sprite.scale.x;
  sprite.__pulseBase = base;
  let f = 0;
  const duration = 16;
  sprite.__pulseTick = tick;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const amp = Math.sin(t * Math.PI) * intensity;
    sprite.scale.set(base * (1 + amp));
    if (t >= 1) {
      sprite.scale.set(base);
      app.ticker.remove(tick);
      if (sprite.__pulseTick === tick) {
        sprite.__pulseTick = null;
        sprite.__pulseBase = null;
      }
    }
  }
}

function nudgeNearbyPieces(targetPiece, sourcePiece) {
  if (!targetPiece?.sprite || !sourcePiece?.sprite) return;
  const tx = targetPiece.sprite.x;
  const ty = targetPiece.sprite.y;
  const dx = tx - sourcePiece.sprite.x;
  const dy = ty - sourcePiece.sprite.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const w = app.renderer.width;
  const h = app.renderer.height;

  state.pieces.forEach(p => {
    if (!p.sprite || p.type === 'khan' || p.id === targetPiece.id || p.id === sourcePiece.id || p.collected) return;

    const rx = p.sprite.x - tx;
    const ry = p.sprite.y - ty;
    const d = Math.hypot(rx, ry);
    if (d > 148) return;

    const nx = d > 0.001 ? rx / d : ux;
    const ny = d > 0.001 ? ry / d : uy;
    const alignment = Math.max(0, nx * ux + ny * uy);
    const falloff = 1 - d / 148;
    const baseKick = 4.5 + 12.5 * falloff;
    const directionalPush = 1 + alignment * 0.62;
    const amp = baseKick * directionalPush;
    const driftX = (ux * amp * 0.44) + (nx * amp * 0.52);
    const driftY = (uy * amp * 0.30) + (ny * amp * 0.40);

    const sx = p.sprite.x, sy = p.sprite.y, sr = p.sprite.rotation;
    let settleX = clamp(sx + driftX * 0.34, 16, w - 16);
    let settleY = clamp(sy + driftY * 0.34, 16, h - 16);
    const inside = keepPointInsideCarpet(settleX, settleY, getPieceCollisionRadius(p) * 0.45);
    settleX = inside.x;
    settleY = inside.y;

    const turnDir = Math.sign((ux * ny - uy * nx) || (Math.random() - 0.5)) || 1;
    const peakRot = sr + turnDir * (0.22 + amp * 0.020 + Math.random() * 0.10);
    const settleRot = sr + turnDir * (0.11 + amp * 0.010 + Math.random() * 0.05);

    let f = 0;
    const duration = 18;
    function tick() {
      f++;
      const t = Math.min(1, f / duration);
      if (t < 0.42) {
        const e = easeOutCubic(t / 0.42);
        p.sprite.x = sx + driftX * e;
        p.sprite.y = sy + driftY * e - Math.sin(Math.PI * e) * Math.max(1.6, amp * 0.10);
        p.sprite.rotation = sr + (peakRot - sr) * e;
      } else {
        const e = easeOutCubic((t - 0.42) / 0.58);
        p.sprite.x = sx + driftX + (settleX - (sx + driftX)) * e;
        p.sprite.y = sy + driftY + (settleY - (sy + driftY)) * e;
        p.sprite.rotation = peakRot + (settleRot - peakRot) * e;
      }
      if (t >= 1) {
        p.sprite.x = settleX;
        p.sprite.y = settleY;
        separateFromOverlaps(p, [sourcePiece.id, targetPiece.id]);
        p.rotation = settleRot;
        p.sprite.rotation = settleRot;
        p.xNorm = p.sprite.x / w;
        p.yNorm = p.sprite.y / h;
        app.ticker.remove(tick);
      }
    }
    app.ticker.add(tick);
  });
}

function impactBurst(x, y) {
  const burst = new Graphics();
  burst.zIndex = 90;
  burst.position.set(x, y);
  fxLayer.addChild(burst);
  let f = 0;
  const duration = 12;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const r = 8 + 28 * t;
    burst.clear();
    burst.circle(0, 0, r);
    burst.stroke({ color: 0xffffff, width: 2.5, alpha: 1 - t });
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 / 6) * i;
      burst.moveTo(Math.cos(a) * (r * 0.35), Math.sin(a) * (r * 0.35));
      burst.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
      burst.stroke({ color: i % 2 ? 0xf0c66c : 0xffffff, width: 2, alpha: 0.95 - t });
    }
    burst.alpha = 1 - t;
    if (t >= 1) {
      app.ticker.remove(tick);
      burst.destroy();
    }
  }
}

function shakeHost(amplitude = 2, duration = 10) {
  const stage = pieceLayer;
  let f = 0;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const amp = amplitude * (1 - t);
    stage.x = (Math.random() - 0.5) * amp * 2;
    stage.y = (Math.random() - 0.5) * amp * 2;
    hintLayer.x = stage.x;
    hintLayer.y = stage.y;
    if (t >= 1) {
      stage.x = 0;
      stage.y = 0;
      hintLayer.x = 0;
      hintLayer.y = 0;
      app.ticker.remove(tick);
    }
  }
}

function celebrateKhan(piece) {
  if (!piece?.sprite) return;
  pulseSprite(piece.sprite, 0.18);
  const burst = new Graphics();
  burst.zIndex = 100;
  burst.position.set(piece.sprite.x, piece.sprite.y);
  fxLayer.addChild(burst);
  let f = 0;
  const duration = 28;
  app.ticker.add(tick);
  function tick() {
    f++;
    const t = Math.min(1, f / duration);
    const r = 30 + 70 * t;
    burst.clear();
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 / 10) * i;
      burst.moveTo(0, 0);
      burst.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      burst.stroke({ color: i % 2 ? 0xffffff : 0xf0c66c, width: 3, alpha: 1 - t });
    }
    burst.alpha = 1 - t;
    if (t >= 1) {
      app.ticker.remove(tick);
      burst.destroy();
    }
  }
}

function updateKhanGlowState() {
  const khan = getKhanPiece();
  const shouldGlow = khan?.sprite && scenario.snapshot().stage === 'khan' && !scenario.snapshot().finished;

  if (shouldGlow) {
    if (!khanGlowTick) {
      let t = 0;
      khanGlowTick = () => {
        t += 0.10;
        const wave = (Math.sin(t) + 1) / 2;
        const flash = Math.pow(wave, 1.6); // sharper, punchier peak than a plain sine
        if (!khan.sprite) return;
        khan.sprite.tint = mixHex(0xffffff, 0xffb020, 0.20 + flash * 0.80);
        const w = app.renderer.width;
        const responsive = w / 941;
        const baseScale = khan.scaleBase * responsive * (CONFIG.scene.khanScaleMultiplier ?? 1);
        khan.sprite.scale.set(baseScale * (1 + flash * 0.09));

        khanGlowRing.visible = true;
        khanGlowRing.clear();
        khanGlowRing.position.set(khan.sprite.x, khan.sprite.y);
        const rw = khan.sprite.width * (0.62 + flash * 0.34);
        const rh = khan.sprite.height * (0.56 + flash * 0.34);
        khanGlowRing.ellipse(0, 0, rw, rh);
        khanGlowRing.fill({ color: 0xffc23c, alpha: 0.14 + flash * 0.30 });
        khanGlowRing.ellipse(0, 0, rw * 1.14, rh * 1.14);
        khanGlowRing.stroke({ color: 0xfff0b0, width: 3.5 + flash * 2, alpha: 0.45 + flash * 0.55 });
        khanGlowRing.ellipse(0, 0, rw * 1.30, rh * 1.30);
        khanGlowRing.stroke({ color: 0xffd35c, width: 2, alpha: (0.15 + flash * 0.35) * 0.6 });
      };
      app.ticker.add(khanGlowTick);
    }
  } else if (khanGlowTick) {
    app.ticker.remove(khanGlowTick);
    khanGlowTick = null;
    khanGlowRing.visible = false;
    khanGlowRing.clear();
    if (khan?.sprite) khan.sprite.tint = 0xffffff;
  }
}

function mixHex(a, b, amount = 0.5) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const rr = Math.round(ar + (br - ar) * amount);
  const rg = Math.round(ag + (bg - ag) * amount);
  const rb = Math.round(ab + (bb - ab) * amount);
  return (rr << 16) | (rg << 8) | rb;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

window.UPAY2D = {
  setSceneLayout(partial = {}) {
    Object.assign(CONFIG.scene, partial || {});
    applySceneLayout();
    randomizeLayout();
    rebuildPieceSprites(false);
  },
  setSceneAssets(partial = {}) {
    if (partial.backgroundImage) CONFIG.scene.backgroundImage = partial.backgroundImage;
    if (partial.carpetImage) CONFIG.scene.carpetImage = partial.carpetImage;
    applySceneLayout();
  },
  getSceneLayout() { return { ...CONFIG.scene }; },
  setDenominations(list, selected = null) {
    const valid = [...new Set((list || []).map(Number).filter(v => Number.isFinite(v) && v > 0))];
    if (!valid.length) return;
    state.denominations = valid;
    const requested = Number(selected);
    state.denomination = valid.includes(requested) ? requested : valid[0];
    syncStakeUI();
  },
  getDenomination() { return state.denomination; },
  setScenario(code) {
    if (!Object.values(SCENARIOS).includes(code)) return Promise.resolve(false);
    state.externalScenarioCode = code;
    return startNewGame();
  },
  clearScenarioOverride() {
    state.externalScenarioCode = null;
  },
  getScenario() {
    return scenario.snapshot();
  },
};
