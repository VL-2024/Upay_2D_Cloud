export const CONFIG = {
  version: '0.1.39-alpha',
  currency: 'сом',
  denominations: [25, 50, 100],
  defaultDenomination: 50,
  scene: {
    backgroundImage: './assets/ref/upay_background_ground.webp',
    carpetImage: './assets/ref/upay_carpet_round.webp',
    carpetCenterX: 0.50,
    carpetCenterY: 0.466,
    carpetWidth: 0.82,
    carpetHeight: 0.46125,
    pileCenterX: 0.50,
    pileCenterY: 0.442,
    pileSpreadX: [0.12, 0.205, 0.285],
    pileSpreadY: [0.058, 0.096, 0.135],
    edgeOutset: 0.038,
    chukoScaleMultiplier: 1.16,
    khanScaleMultiplier: 1.52,
    pileSpreadScale: 0.71,
    pileSpreadHeightScale: 1.67,
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
  }
};
