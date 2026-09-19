// LMS integration adapter — same "X2" postMessage/PayTicket contract as the
// sibling Khan1_2D_Cloud (Ордо/Чүкө) game, adapted to this game's ES-module
// setup and its own 8-tier scenario table. See docs/LMS-Integration-spec.md
// and docs/PayTicket-API-spec-for-backend.md for the full contract this
// file implements.
//
// The game never computes a real win itself — PayTicket's `win`/`balance`
// are authoritative. `scenario` only selects which of our 8 RULES tiers to
// visualize (see scenarioForLmsId() in scenario-engine.js).
import { CONFIG } from './config.js?v=0.3.0';
import { isValidLmsScenarioId, multiplierForScenario, scenarioForLmsId, LMS_SCENARIO_ORDER } from './scenario-engine.js?v=0.3.0';

const cfg = CONFIG.lms || {};
const params = new URLSearchParams(window.location.search);

// ?mock=true|false explicitly overrides cfg.mock (QA/test links without a rebuild).
const mockParam = params.get('mock');
const isMock = mockParam != null ? mockParam.toLowerCase() === 'true' : Boolean(cfg.mock);

let session = params.get(cfg.sessionQueryParam || 'session') || null;
let sessionResolve = null;
let sessionPromise = null;
let initResolve = null;
let runtimeInit = null;
// Origin the parent's X2_LMS_INIT actually arrived from — used as
// targetOrigin for outgoing messages instead of a static cfg.parentOrigin
// when that isn't explicitly configured.
let verifiedParentOrigin = null;

let mockCounter = 0;
const mockBalances = { KGS: 12450, RUB: 50000, USD: 150, EUR: 140 };

function armSessionPromise() {
  sessionPromise = new Promise(resolve => {
    sessionResolve = resolve;
    if (session) resolve(session);
  });
}
armSessionPromise();

function resetSession() {
  session = null;
  armSessionPromise();
}

const initPromise = new Promise(resolve => { initResolve = resolve; });

function isAllowedOrigin(origin) {
  const allowed = cfg.allowedParentOrigins || ['*'];
  return allowed.includes('*') || allowed.includes(origin);
}

function targetOrigin() {
  if (cfg.parentOrigin && cfg.parentOrigin !== '*') return cfg.parentOrigin;
  // A sandboxed/file:// parent reports event.origin as the literal string
  // "null", which postMessage() rejects as an invalid targetOrigin — fall
  // back to '*' rather than throwing.
  return (verifiedParentOrigin && verifiedParentOrigin !== 'null') ? verifiedParentOrigin : '*';
}

function emit(type, payload = {}) {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ source: 'X2_UPAY', type, ...payload }, targetOrigin());
  }
}

function parseNumbers(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value !== 'string') return null;
  return value.split(',').map(x => Number(x.trim())).filter(Number.isFinite);
}

function querySettings() {
  const denominations = parseNumbers(params.get('denominations'));
  const balanceParam = params.get('balance');

  return {
    gameId: params.get('gameId') || cfg.gameId || 'UPAY',
    denomination: Number(params.get('denomination') || CONFIG.defaultDenomination || 50),
    denominations: denominations || CONFIG.denominations || [CONFIG.defaultDenomination || 50],
    currency: String(params.get('currency') || cfg.currencyCode || 'KGS').toUpperCase(),
    currencyDisplay: params.get('currencyDisplay') || cfg.currencyDisplay || CONFIG.currency || 'сом',
    language: String(params.get('language') || cfg.language || 'RU').toUpperCase(),
    mode: String(params.get('mode') || cfg.mode || 'demo').toLowerCase(),
    demoAllowed: String(params.get('demoAllowed') ?? cfg.demoAllowed ?? true).toLowerCase() === 'true',
    demoBalance: Number(params.get('demoBalance') || cfg.demoBalance || 5000),
    balance: balanceParam != null && Number.isFinite(Number(balanceParam)) ? Number(balanceParam) : undefined,
  };
}

// Structural validation of X2_LMS_INIT — never fully fails, falls back to
// config/query defaults on bad data (same posture as Khan1_2D_Cloud).
function validateInit(data) {
  const problems = [];

  let denominations = data.denominations;
  if (!Array.isArray(denominations) || !denominations.length ||
      !denominations.every(n => Number.isFinite(Number(n)) && Number(n) > 0)) {
    if (denominations != null) problems.push('denominations must be a non-empty array of positive numbers');
    denominations = undefined;
  }

  let mode = data.mode;
  if (mode !== 'real' && mode !== 'demo') {
    if (mode != null) problems.push('mode must be "real" or "demo", got: ' + JSON.stringify(mode));
    mode = undefined;
  }

  if (problems.length) console.warn('[X2_UPAY] X2_LMS_INIT validation warnings:', problems, data);

  return { denominations, mode };
}

window.addEventListener('message', event => {
  if (!isAllowedOrigin(event.origin)) return;
  const data = event.data || {};

  if (data.type === 'X2_LMS_INIT') {
    const validated = validateInit(data);
    verifiedParentOrigin = event.origin;

    runtimeInit = {
      gameId: data.gameId || cfg.gameId || 'UPAY',
      denomination: data.denomination,
      denominations: validated.denominations,
      currency: data.currency,
      currencyDisplay: data.currencyDisplay || data.currencyLabel || data.currencySymbol,
      language: data.language,
      mode: validated.mode,
      demoAllowed: data.demoAllowed,
      demoBalance: data.demoBalance,
      balance: data.balance != null && Number.isFinite(Number(data.balance)) ? Number(data.balance) : undefined,
    };

    if (data.session) {
      session = String(data.session);
      if (sessionResolve) sessionResolve(session);
    }

    if (initResolve) initResolve(runtimeInit);
    return;
  }

  if (data.type === 'X2_LMS_SESSION' && data.session) {
    verifiedParentOrigin = event.origin;
    session = String(data.session);
    if (sessionResolve) sessionResolve(session);
  }
});

function makeError(code, message, status) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

async function getGameSettings() {
  if (isMock || cfg.initMode === 'config' || window.parent === window) {
    return querySettings();
  }

  if (runtimeInit) return { ...querySettings(), ...runtimeInit };

  emit('X2_GAME_READY', {
    gameId: params.get('gameId') || cfg.gameId || 'UPAY',
    needsInit: true,
    needsSession: cfg.sessionMode === 'postMessage',
  });

  const timeout = Number(cfg.requestTimeoutMs || 10000);
  const supplied = await Promise.race([
    initPromise,
    new Promise((_, reject) => setTimeout(
      () => reject(makeError('INIT_TIMEOUT', 'LMS did not send X2_LMS_INIT')),
      timeout
    )),
  ]);

  return { ...querySettings(), ...supplied };
}

async function waitForSession() {
  if (isMock) return null;
  if (cfg.sessionMode === 'cookie') return null;
  if (session) return session;

  if (cfg.sessionMode === 'query') {
    throw makeError('SESSION_REQUIRED', 'Session query parameter is missing');
  }

  const timeout = Number(cfg.requestTimeoutMs || 10000);
  return Promise.race([
    sessionPromise,
    new Promise((_, reject) => setTimeout(
      () => reject(makeError('SESSION_TIMEOUT', 'LMS session was not provided by parent iframe')),
      timeout
    )),
  ]);
}

async function apiRequest(path, options = {}) {
  const sessionValue = await waitForSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(cfg.requestTimeoutMs || 10000));

  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  if (sessionValue) {
    headers.Authorization = 'Bearer ' + sessionValue;
    if (cfg.sessionHeader) headers[cfg.sessionHeader] = sessionValue;
  }

  try {
    const url = /^https?:\/\//i.test(path) ? path : (cfg.apiBase || '') + path;
    const response = await fetch(url, { ...options, headers, signal: controller.signal });

    let data = {};
    try { data = await response.json(); } catch { /* non-JSON error body */ }

    if (!response.ok) {
      const code = data.code ||
        (response.status === 401 ? 'SESSION_EXPIRED' :
         response.status === 409 ? 'INSUFFICIENT_FUNDS' :
         'LMS_HTTP_' + response.status);

      if (code === 'SESSION_EXPIRED') resetSession();
      throw makeError(code, data.message || 'LMS request failed', response.status);
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw makeError('LMS_TIMEOUT', 'LMS request timed out');
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTicket(data, requested) {
  const ticketId = data.ticketId ?? data.ticket_id ?? data.ticketNumber ?? data.ticket_number;
  const lmsScenario = Number(data.scenario ?? data.scenarioId ?? data.scenario_id);
  const win = Number(data.win ?? data.prize ?? data.winAmount ?? 0);
  const balance = Number(data.balance ?? data.newBalance ?? data.balanceAfterGame);
  const currency = String(data.currency || requested.currency || cfg.currencyCode || 'KGS').toUpperCase();

  if (ticketId == null || ticketId === '') {
    throw makeError('LMS_BAD_RESPONSE', 'LMS response has no ticketId');
  }
  if (!isValidLmsScenarioId(lmsScenario)) {
    throw makeError('LMS_BAD_RESPONSE', `Unknown scenario: ${data.scenario}. Allowed: ${LMS_SCENARIO_ORDER.join(', ')}`);
  }
  if (!Number.isFinite(win) || win < 0) {
    throw makeError('LMS_BAD_RESPONSE', 'LMS response has invalid win');
  }
  if (!Number.isFinite(balance)) {
    throw makeError('LMS_BAD_RESPONSE', 'LMS ticket response has no numeric balance');
  }

  return {
    ticketId: String(ticketId),
    lmsScenario,
    scenarioCode: scenarioForLmsId(lmsScenario),
    win,
    balance,
    currency,
    currencyDisplay: data.currencyDisplay || data.currencyLabel || data.currencySymbol || requested.currencyDisplay || cfg.currencyDisplay || currency,
    language: requested.language,
    multiplier: data.multiplier != null ? Number(data.multiplier) : null,
    raw: data,
  };
}

function pickMockLmsScenario() {
  const forced = Number(params.get('scenario'));
  if (isValidLmsScenarioId(forced)) return forced;
  return LMS_SCENARIO_ORDER[mockCounter++ % LMS_SCENARIO_ORDER.length];
}

async function createTicket({ gameId, denomination, currency, language }) {
  const cur = String(currency || cfg.currencyCode || 'KGS').toUpperCase();
  const lang = String(language || cfg.language || 'RU').toUpperCase();

  if (isMock) {
    await new Promise(r => setTimeout(r, 320));

    const lmsScenario = pickMockLmsScenario();
    const multiplier = multiplierForScenario(scenarioForLmsId(lmsScenario));
    const win = Number(denomination) * multiplier;

    if (!(cur in mockBalances)) mockBalances[cur] = 1000;
    if (mockBalances[cur] < Number(denomination)) {
      throw makeError('INSUFFICIENT_FUNDS', 'Insufficient mock balance', 409);
    }
    mockBalances[cur] = mockBalances[cur] - Number(denomination) + win;

    return {
      ticketId: 'MOCK-' + Date.now(),
      lmsScenario,
      scenarioCode: scenarioForLmsId(lmsScenario),
      win,
      balance: mockBalances[cur],
      currency: cur,
      currencyDisplay: cfg.currencyDisplay || cur,
      language: lang,
      multiplier,
    };
  }

  if (!session) {
    emit('X2_GAME_ERROR', { stage: 'init', code: 'SESSION_MISSING', message: 'LMS session token was not provided yet' });
    throw makeError('SESSION_MISSING', 'LMS session token was not provided yet');
  }

  const base = cfg.endpoints.lms;
  const method = String(cfg.payTicketMethod || 'GET').toUpperCase();
  let data;

  if (method === 'POST') {
    const requestId = window.crypto?.randomUUID
      ? window.crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    data = await apiRequest(base, {
      method: 'POST',
      body: JSON.stringify({ gameId, amount: Number(denomination), requestId }),
    });
  } else {
    const query = new URLSearchParams({ Method: 'PayTicket', gameId: String(gameId), amount: String(Number(denomination)) });
    const sep = base.includes('?') ? '&' : '?';
    data = await apiRequest(base + sep + query.toString(), { method: 'GET' });
  }

  return normalizeTicket(data, { gameId, denomination, currency: cur, currencyDisplay: cfg.currencyDisplay, language: lang });
}

async function createDemoTicket({ gameId, denomination, currency, currencyDisplay, language, demoBalance }) {
  await new Promise(r => setTimeout(r, 220));

  const lmsScenario = pickMockLmsScenario();
  const multiplier = multiplierForScenario(scenarioForLmsId(lmsScenario));
  const win = Number(denomination) * multiplier;

  const startBalance = Number(demoBalance ?? cfg.demoBalance ?? 5000);
  const nextBalance = startBalance - Number(denomination) + win;

  return {
    ticketId: 'DEMO-' + Date.now(),
    lmsScenario,
    scenarioCode: scenarioForLmsId(lmsScenario),
    win,
    balance: nextBalance,
    currency: String(currency || cfg.currencyCode || 'KGS').toUpperCase(),
    currencyDisplay: currencyDisplay || cfg.currencyDisplay || currency || '',
    language: String(language || cfg.language || 'RU').toUpperCase(),
    multiplier,
    demo: true,
  };
}

setTimeout(() => {
  emit('X2_GAME_READY', {
    gameId: params.get('gameId') || cfg.gameId || 'UPAY',
    needsInit: !isMock && cfg.initMode === 'postMessage',
    needsSession: !isMock && cfg.sessionMode === 'postMessage',
  });
}, 0);

export const LMS = {
  getGameSettings,
  createTicket,
  createDemoTicket,
  emit,
  getSession: () => session,
  isMock,
};
