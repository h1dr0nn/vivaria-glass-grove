/**
 * Scene palette - warm Ghibli-soft. Shadows are tinted (umber/olive),
 * never neutral black. Accents stay close on the wheel.
 */
export const SCENE = {
  // the room behind the glass - warm paper light, dimmer at the bottom
  roomTop: 0xf4ecd9,
  roomMid: 0xeadfc4,
  roomBottom: 0xd9c9a8,

  glassEdge: 0xdfe8da,
  glassTint: 0xeef4ec,
  glassShadow: 0x8a7f63,

  waterSurface: 0xa8cfd8,
  waterShallow: 0x7fb2c4,
  waterDeep: 0x497d99,
  waterTintOverlay: 0x6fa7bb,
  surfaceLine: 0xe8f4f0,

  drainage: 0x6e6257,
  drainageDark: 0x5d5349,
  soil: 0x5d4734,
  soilDark: 0x4c3a2b,
  sand: 0xd9c69c,
  sandWet: 0xbfa67e,
  litter: 0x8f6c46,
  rock: 0x8d8a82,
  rockShadow: 0x6f6c64,
  wood: 0x7a5a3a,
  woodDark: 0x64482e,
  woodLit: 0x9a7a52, // rim catch-light on the upper-left lit edge
  woodCore: 0x4f3826, // deepest core-shadow on the down-right edge

  microbeGlow: 0xe9ddb4,
  algae: 0x6f9e54,
  algaeDeep: 0x517c40,
  stem: 0x4f7a3d,
  leaf: 0x76a85c,
  leafLight: 0x97c277,
  moss: 0x5f8a4a,
} as const;

/** Warm grade applied at the root - gentle amber lift, no blowout. */
export const WARM_GRADE = {
  tint: 0xfff2dd,
  saturation: 1.06,
  brightness: 1.02,
} as const;
