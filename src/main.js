import { Application, Assets, Container, Graphics, Sprite } from 'https://cdn.jsdelivr.net/npm/pixi.js@8.2.6/+esm';
import { CONFIG } from './config.js';
import { ScenarioEngine, SCENARIOS } from './scenario-engine.js';

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

const poseGroups = ['Айкүр', 'Таа', 'Бөк', 'Чик'];
const poseHelpLabels = ['Айкүр', 'Таа', 'Бөк', 'Чик'];
const poseUiColors = {
  'Айкүр': '#2b66ff',
  'Таа': '#31b84d',
  'Бөк': '#ff4fb6',
  'Чик': '#ff9d20',
};

const scenario = new ScenarioEngine();
const DEFAULT_SCENE = JSON.parse(JSON.stringify(CONFIG.scene));
const DEFAULT_PIECES = JSON.parse(JSON.stringify(CONFIG.pieces));

const state = {
  denomination: CONFIG.defaultDenomination,
  denominations: [...CONFIG.denominations],
  currency: CONFIG.currency,
  phase: 'idle',
  pieces: [],
  slots: Array(CONFIG.zones.totalSlots).fill(null),
  selectedSourceId: null,
  lastObjective: '',
  demoHasStarted: false,
  externalScenarioCode: null,
  activePoseFilter: null,
};

const host = document.getElementById('pixiHost');
const app = new Application();
await app.init({ resizeTo: host, backgroundAlpha: 0, antialias: true });
host.appendChild(app.canvas);
app.stage.sortableChildren = true;

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

setupUI();
startNewGame();
window.addEventListener('resize', () => rebuildPieceSprites(false));

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

function setupUI() {
  ensureSlots('zone1', 0);
  ensureSlots('zone2', 3);
  renderStakeMenu();
  syncStakeUI();

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

  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.status-panel')) closeStakeMenu();
  });

  document.getElementById('newGameBtn').addEventListener('click', startNewGame);
  renderPoseHelpPanel();
  setupSceneSettingsUI();
  updatePrimaryButton();
  document.getElementById('poseHelpButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.pose-help-btn');
    if (!btn) return;
    togglePoseFilter(btn.dataset.pose || null);
  });
  document.getElementById('poseHelpToggle').addEventListener('click', () => {
    const panel = document.getElementById('poseHelpPanel');
    panel.classList.toggle('collapsed');
  });
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
      flashObjective(`Параметры скопированы: ${text}`);
    } catch {
      flashObjective('Не удалось скопировать параметры');
    }
  };

  [
    'sceneChukoSize','sceneKhanSize','sceneCarpetSize','sceneCarpetY','scenePileY','scenePileHeight','sceneSpread'
  ].forEach(id => bind(id, () => apply(true)));

  document.getElementById('sceneRelayoutBtn')?.addEventListener('click', () => apply(true));
  document.getElementById('sceneResetBtn')?.addEventListener('click', reset);
  document.getElementById('sceneCopyBtn')?.addEventListener('click', copy);
  openBtn?.addEventListener('click', () => panel.classList.toggle('hidden'));
  closeBtn?.addEventListener('click', () => panel.classList.add('hidden'));

  apply(false);
}

function renderPoseHelpPanel() {
  const wrap = document.getElementById('poseHelpButtons');
  wrap.innerHTML = poseHelpLabels.map(label => `<button type="button" class="pose-help-btn" data-pose="${label}" style="--pose-color:${poseUiColors[label]}">${label}</button>`).join('');
  syncPoseHelpPanel();
}

function togglePoseFilter(label) {
  state.activePoseFilter = state.activePoseFilter === label ? null : label;
  syncPoseHelpPanel();
  resolveAllPieceOverlaps();
  refreshPieceVisuals();
}

function syncPoseHelpPanel() {
  document.querySelectorAll('.pose-help-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pose === state.activePoseFilter);
  });
}

function updatePrimaryButton() {
  const btn = document.getElementById('newGameBtn');
  if (!btn) return;
  let label = 'НОВАЯ ИГРА';
  const snap = scenario.snapshot();
  if (state.phase === 'animating') label = 'ИДЁТ УДАР';
  else if (state.phase === 'aiming' && state.selectedSourceId) label = 'БРОСОК / УДАР';
  else if (!snap.finished && state.pieces.length) label = snap.khanActive ? 'ВЫБЕЙ ХАНА' : 'ВЫБЕРИ БИТУ';
  btn.innerHTML = `${label}<small id="betLabel">${state.denomination} ${state.currency}</small>`;
  btn.classList.toggle('is-active-turn', label !== 'НОВАЯ ИГРА');
  btn.classList.toggle('is-busy', label === 'ИДЁТ УДАР');
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
}

function renderStakeMenu() {
  const menu = document.getElementById('stakeMenu');
  menu.innerHTML = state.denominations.map(v =>
    `<button type="button" class="stake-option${v === state.denomination ? ' selected' : ''}" data-value="${v}">${v} ${state.currency}</button>`
  ).join('');
}

function syncStakeUI() {
  document.getElementById('stakeValue').textContent = state.denomination;
  document.getElementById('currencyValue').textContent = state.currency;
  const betLabel = document.getElementById('betLabel');
  if (betLabel) betLabel.textContent = `${state.denomination} ${state.currency}`;
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

function startNewGame() {
  if (state.phase === 'animating') return;
  closeStakeMenu();
  state.phase = 'idle';
  state.selectedSourceId = null;
  state.slots = Array(CONFIG.zones.totalSlots).fill(null);

  const demoMode = document.getElementById('demoToggle').checked;
  if (state.externalScenarioCode) {
    scenario.setScenario(state.externalScenarioCode);
  } else if (demoMode) {
    scenario.reset({ advanceDemo: state.demoHasStarted });
    state.demoHasStarted = true;
  } else {
    state.demoHasStarted = false;
    scenario.setScenario(SCENARIOS.TWO);
  }

  buildPieces();
  resetSlotDom();
  updateProgress();
  setObjectiveFromScenario();
  rebuildPieceSprites(true);
  syncSelectorLock();
  updatePrimaryButton();
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
  for (let iter = 0; iter < 18; iter++) {
    let moved = false;
    for (let i = 0; i < active.length; i++) {
      const a = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j];
        const ra = getPieceCollisionRadius(a);
        const rb = getPieceCollisionRadius(b);
        const minDist = ra + rb * (b.type === 'khan' || a.type === 'khan' ? 0.98 : 0.94);
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
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    sprite.on('pointertap', () => onPieceTap(p));
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

function onPieceTap(piece) {
  if (piece.collected || state.phase === 'animating' || state.phase === 'settled') return;

  const snap = scenario.snapshot();
  if (piece.type === 'khan') return onKhanTap(piece, snap);

  if (snap.khanActive) {
    flashObjective('ХАН активирован — выбей Хана');
    pulseSprite(getKhanPiece()?.sprite);
    return;
  }

  const source = getSelectedSource();
  if (!source) {
    if (!canUseAsSource(piece)) {
      flashObjective('Нет пары в таком же положении — выбери другой чуко');
      pulseSprite(piece.sprite, 0.08);
      return;
    }
    state.selectedSourceId = piece.id;
    state.phase = 'aiming';
    pulseSprite(piece.sprite, 0.08);
    setObjective('Выбери чуко в таком же положении');
    refreshPieceVisuals();
    return;
  }

  if (source.id === piece.id) {
    state.selectedSourceId = null;
    state.phase = 'idle';
    setObjectiveFromScenario();
    refreshPieceVisuals();
    return;
  }

  if (!isValidTarget(source, piece)) {
    flashObjective('Бить можно только по чуко в том же положении');
    pulseSprite(piece.sprite, 0.08);
    return;
  }

  strikeTarget(source, piece, snap);
}

function onKhanTap(khanPiece, snap) {
  if (!snap.khanActive) {
    flashObjective(snap.khanRequired ? 'Сначала собери нужные чуко' : 'В этом сценарии Хан не используется');
    pulseSprite(khanPiece.sprite);
    return;
  }
  state.phase = 'settled';
  state.selectedSourceId = null;
  scenario.registerKhanHit();
  setObjective(scenario.resultText());
  syncSelectorLock();
  celebrateKhan(khanPiece);
  refreshPieceVisuals();
}

function strikeTarget(source, target, snap) {
  state.phase = 'animating';
  syncSelectorLock();
  state.selectedSourceId = null;
  refreshPieceVisuals();

  const success = !snap.failedStrikeRequired && scenario.canCollectNormal();
  const nextSlot = success ? state.slots.findIndex(v => v === null) : -1;
  if (success && nextSlot >= 0) {
    state.slots[nextSlot] = { id: target.id, type: target.type, textureKey: target.textureKey };
    scenario.registerCollection();
  }

  const shot = getShotVector(source, target);
  let sourceDone = false;
  let targetDone = false;

  const finalize = () => {
    if (!sourceDone || !targetDone) return;

    if (snap.failedStrikeRequired) {
      scenario.registerFailedStrike();
      state.phase = 'settled';
      setObjective(scenario.resultText());
      syncSelectorLock();
      refreshPieceVisuals();
      return;
    }

    if (!success || nextSlot < 0) {
      state.phase = 'idle';
      setObjectiveFromScenario();
      syncSelectorLock();
      refreshPieceVisuals();
      return;
    }

    animateToSlot(target, nextSlot, source, () => {
      target.collected = true;
      target.sprite = null;
      updateSlotDom(nextSlot, target.textureKey);
      updateProgress();
      const after = scenario.snapshot();
      if (after.finished) {
        state.phase = 'settled';
        setObjective(scenario.resultText());
      } else if (after.khanActive) {
        state.phase = 'idle';
        setObjective('ХАН активирован! Выбей Хана');
        pulseSprite(getKhanPiece()?.sprite, 0.14);
      } else if (after.failedStrikeRequired) {
        state.phase = 'idle';
        setObjective('Последний удар — попробуй выбить ещё один чуко');
      } else {
        state.phase = 'idle';
        setObjectiveFromScenario();
      }
      syncSelectorLock();
      refreshPieceVisuals();
    });
  };

  animateStrike(source, target, {
    onImpact: () => {
      impactBurst(target.sprite.x, target.sprite.y);
      nudgeNearbyPieces(target, source);
      if (success) shakeHost(2, 10);

      if (snap.failedStrikeRequired || !success) {
        animateMissReaction(target, shot, () => {
          targetDone = true;
          finalize();
        });
      } else {
        animateKickOutToEdge(target, shot, () => {
          targetDone = true;
          finalize();
        });
      }
    },
    onFinish: () => {
      sourceDone = true;
      finalize();
    }
  });
}

function canUseAsSource(piece) {
  return piece.type === 'normal' && !piece.collected && getValidTargets(piece).length > 0;
}

function isValidTarget(source, target) {
  return !!source && !!target && source.id !== target.id && source.type === 'normal' && target.type === 'normal' && !source.collected && !target.collected && source.poseIndex === target.poseIndex;
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
  const snap = scenario.snapshot();
  const source = getSelectedSource();
  const validTargetIds = new Set(source ? getValidTargets(source).map(p => p.id) : []);

  hintLayer.removeChildren();

  for (const p of state.pieces) {
    if (!p.sprite || p.collected) continue;
    const selected = p.id === state.selectedSourceId;
    const selectableSource = !source && canUseAsSource(p);
    const validTarget = validTargetIds.has(p.id);
    const inPoseFilter = !!state.activePoseFilter && p.type === 'normal' && poseNameForIndex(p.poseIndex) === state.activePoseFilter;

    const baseTint = 0xffffff;
    let displayTint = baseTint;
    if (selected) displayTint = mixHex(baseTint, 0xf4fbff, 0.14);
    else if (validTarget) displayTint = mixHex(baseTint, 0xfff3cf, 0.12);
    else if (selectableSource) displayTint = mixHex(baseTint, 0xf2fcff, 0.10);
    else if (inPoseFilter) displayTint = mixHex(baseTint, 0xffffff, 0.05);
    p.sprite.tint = displayTint;

    let alpha = 0.96;
    if (source) alpha = (selected || validTarget || p.type === 'khan') ? 1 : 0.56;
    else if (state.activePoseFilter) alpha = inPoseFilter || p.type === 'khan' ? 1 : 0.40;
    else alpha = selectableSource || p.type === 'khan' ? 1 : 0.90;
    if (p.type === 'khan' && !snap.khanActive) alpha = Math.min(alpha, 0.96);
    p.sprite.alpha = alpha;
    p.sprite.zIndex = selected ? 40 : validTarget ? 24 : (p.type === 'khan' ? 20 : 5);

    if (selectableSource) addHintMarker(p, 0x68d9ff, 0.11, 0.90);
    if (validTarget) addHintMarker(p, 0xf0c66c, 0.16, 1.08);
    if (inPoseFilter && !source) addHintMarker(p, 0xffffff, 0.08, 1.02);
  }
  updateSelectionRing();
  syncPoseHelpPanel();
  updatePrimaryButton();
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

function resetSlotDom() {
  document.querySelectorAll('.slot').forEach(slot => {
    slot.innerHTML = '';
    slot.classList.remove('filled');
  });
  document.getElementById('upayZone1').classList.remove('complete');
  document.getElementById('upayZone2').classList.remove('complete');
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
  document.getElementById('zone1Progress').textContent = `${c1}/3`;
  document.getElementById('zone2Progress').textContent = `${c2}/3`;
  document.getElementById('upayZone1').classList.toggle('complete', c1 === 3);
  document.getElementById('upayZone2').classList.toggle('complete', c2 === 3);
}

function scenarioLabel(code) {
  return code.replace('_', ' + ');
}

function setObjective(text) {
  state.lastObjective = text;
  document.getElementById('objective').textContent = text;
}

function setObjectiveFromScenario() {
  const snap = scenario.snapshot();
  let text = '';
  if (snap.finished) text = scenario.resultText();
  else if (snap.khanActive) text = 'ХАН активирован! Выбей Хана';
  else if (snap.failedStrikeRequired) text = 'Последний удар — попробуй выбить ещё один чуко';
  else if (snap.collected === 0) text = `DEMO ${scenarioLabel(snap.scenario)} • Выбери чуко-биту`;
  else text = `DEMO ${scenarioLabel(snap.scenario)} • собрано ${snap.collected}/${snap.normalLimit}`;
  setObjective(text);
}

let flashTimer = null;
function flashObjective(text) {
  if (flashTimer) clearTimeout(flashTimer);
  const current = state.lastObjective;
  document.getElementById('objective').textContent = text;
  flashTimer = setTimeout(() => {
    document.getElementById('objective').textContent = current;
    flashTimer = null;
  }, 1200);
}

function animateToSlot(piece, slotIndex, sourcePiece, onDone) {
  const sprite = piece.sprite;
  if (!sprite) return onDone?.();
  const slotEl = document.querySelector(`.slot[data-slot-index="${slotIndex}"]`);
  if (!slotEl) return onDone?.();
  const slotRect = slotEl.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const tx = slotRect.left - hostRect.left + slotRect.width / 2;
  const ty = slotRect.top - hostRect.top + slotRect.height / 2;
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

function animateStrike(source, target, { onImpact, onFinish }) {
  const sprite = source.sprite;
  const targetSprite = target.sprite;
  if (!sprite || !targetSprite) {
    onImpact?.();
    onFinish?.();
    return;
  }

  const startX = sprite.x;
  const startY = sprite.y;
  const startR = sprite.rotation;
  const dx = targetSprite.x - sprite.x;
  const dy = targetSprite.y - sprite.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;

  const back = clamp(dist * 0.10, 7, 18);
  const impactGap = Math.max(targetSprite.width * 0.13, 12);
  const impactX = targetSprite.x - ux * impactGap;
  const impactY = targetSprite.y - uy * impactGap;

  const rebound = clamp(dist * 0.09, 8, 16);
  const side = (Math.random() - 0.5) * clamp(targetSprite.width * 0.05, 2, 6);
  const reboundX = impactX - ux * rebound + (-uy) * side;
  const reboundY = impactY - uy * rebound + ux * side;
  const settleX = reboundX + ux * 2.5;
  const settleY = reboundY + uy * 1.5;

  let f = 0;
  let impacted = false;
  const duration = 28;
  app.ticker.add(tick);

  function tick() {
    f++;
    const t = Math.min(1, f / duration);

    if (t < 0.18) {
      const e = easeOutCubic(t / 0.18);
      sprite.x = startX - ux * back * e;
      sprite.y = startY - uy * back * e;
      sprite.rotation = startR - 0.10 * e + Math.sin(Math.PI * e) * 0.05;
    } else if (t < 0.58) {
      const e = easeOutCubic((t - 0.18) / 0.40);
      const fromX = startX - ux * back;
      const fromY = startY - uy * back;
      sprite.x = fromX + (impactX - fromX) * e;
      sprite.y = fromY + (impactY - fromY) * e - Math.sin(Math.PI * e) * 5.5;
      sprite.rotation = startR - 0.10 + 0.55 * e + Math.sin(Math.PI * e) * 0.08;
      if (!impacted && e >= 0.80) {
        impacted = true;
        onImpact?.();
      }
    } else if (t < 0.82) {
      const e = easeOutCubic((t - 0.58) / 0.24);
      sprite.x = impactX + (reboundX - impactX) * e;
      sprite.y = impactY + (reboundY - impactY) * e - Math.sin(Math.PI * e) * 6;
      sprite.rotation = startR + 0.45 - 0.34 * e + Math.sin(Math.PI * e) * 0.10;
    } else {
      const e = easeOutCubic((t - 0.82) / 0.18);
      sprite.x = reboundX + (settleX - reboundX) * e;
      sprite.y = reboundY + (settleY - reboundY) * e;
      sprite.rotation = startR + 0.11 - 0.05 * e;
    }

    if (t >= 1) {
      sprite.x = settleX;
      sprite.y = settleY;
      sprite.rotation = startR + 0.06;
      separateFromOverlaps(source, [target.id]);
      app.ticker.remove(tick);
      if (!impacted) onImpact?.();
      onFinish?.();
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
  return Math.max(16, Math.min(sprite.width, sprite.height) * 0.28);
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

  for (let iter = 0; iter < 6; iter++) {
    let moved = false;
    for (const other of state.pieces) {
      if (!other?.sprite || other.id === primaryPiece.id || other.collected || ignore.has(other.id)) continue;
      const minDist = baseRadius + getPieceCollisionRadius(other) * (other.type === 'khan' ? 0.96 : 0.92);
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

function poseNameForIndex(index) {
  return poseGroups[index] || 'Чуко';
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
    if (!Object.values(SCENARIOS).includes(code)) return false;
    state.externalScenarioCode = code;
    startNewGame();
    return true;
  },
  clearScenarioOverride() {
    state.externalScenarioCode = null;
  },
  getScenario() {
    return scenario.snapshot();
  },
};
