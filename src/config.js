export const CONFIG = {
  version: '0.3.0-alpha',
  currency: 'сом',
  denominations: [25, 50, 100],
  defaultDenomination: 50,
  autoPlayCounts: [5, 10, 20, 50],
  scene: {
    backgroundImage: './assets/ref/upay_background_ground.webp',
    carpetImage: './assets/ref/upay_carpet_round.webp',
    carpetCenterX: 0.50,
    carpetCenterY: 0.442,
    carpetWidth: 0.902,
    carpetHeight: 0.507375,
    pileCenterX: 0.50,
    pileCenterY: 0.442,
    pileSpreadX: [0.12, 0.205, 0.285],
    pileSpreadY: [0.058, 0.096, 0.135],
    edgeOutset: 0.038,
    chukoScaleMultiplier: 1.33,
    khanScaleMultiplier: 1,
    pileSpreadScale: 0.79,
    pileSpreadHeightScale: 0.94,
  },
  pieces: {
    normalCount: 15,
    scaleMin: 0.135,
    scaleMax: 0.172,
    khanScale: 0.26,
  },
  zones: {
    totalSlots: 6,
    slotsPerUpay: 3,
  },
  ui: {
    selectedTint: 0xdaf6ff,
    selectedGlow: 0x6ac7ff,
  },
  throwTuning: {
    maxPull: 110,
    minPowerToAim: 0.08,
    aimToleranceDeg: 46,
    arcHeight: 120,
    arcScaleBoost: 0.14,
    flightDurationFrames: 26,
    rotationPerPull: 0.0026,
    aimedColor: 0xdbe63c,
    unaimedGuideColor: 0x8fb3d6,
  },

  // LMS integration (same "X2" postMessage/PayTicket contract as the
  // sibling Khan1_2D_Cloud game — see docs/LMS-Integration-spec.md and
  // docs/PayTicket-API-spec-for-backend.md). mock:true keeps the game fully
  // playable standalone; flip to false (or pass ?mock=false) once the real
  // LMS endpoint/gameId below are confirmed.
  lms: {
    gameId: 'UPAY',
    currencyCode: 'KGS', // ISO code sent to PayTicket; distinct from CONFIG.currency (UI display label)
    mock: true,
    apiBase: '',
    endpoints: {
      // TODO: no confirmed dev/prod endpoint for UPAY yet — placeholder
      // mirrors Khan1's dev URL shape so payTicketMethod/GET wiring can be
      // tested; replace before any real (non-mock) embed.
      lms: 'https://dev.superloto.kg/api/Lotto.Users.cls',
    },
    payTicketMethod: 'GET',
    initMode: 'postMessage',
    sessionMode: 'postMessage',
    sessionQueryParam: 'session',
    sessionHeader: 'X-Session-ID',
    // SECURITY: must be a concrete list of LMS domains before real embed —
    // '*' only for local/mock testing. See isAllowedOrigin() in lms-adapter.js.
    parentOrigin: '*',
    allowedParentOrigins: [],
    requestTimeoutMs: 10000,
  },
};
