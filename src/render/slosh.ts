/**
 * Water slosh — a 2-mode damped spring (reduced-order slosh model).
 * Driven by window-move acceleration; purely cosmetic (never touches sim).
 *
 * Mode equation: s'' = -ω²·s - 2ζω·s', semi-implicit Euler. Underdamped
 * (ζ≈0.18) so the surface swings once or twice and settles in ~1.6s.
 */

const OMEGA_X = 7; // rad/s — ~0.9s period horizontal mode
const ZETA_X = 0.22;
const OMEGA_Y = 9; // vertical "plop" mode settles faster
const ZETA_Y = 0.32;
const K_IMPULSE = 0.0008; // window accel (px/s²) → mode velocity
const S_MAX = 1;
const V_MAX = 8;
/** below this energy the deflection is sub-pixel — snap to sleep */
const ENERGY_EPSILON = 8e-3;

export interface SloshReading {
  /** waterline lean in radians (apply per-x offset or container rotation) */
  readonly tilt: number;
  /** 0..1 extra traveling-wave amplitude */
  readonly wave: number;
  /** which way the crest sweeps (-1 | 0 | 1) */
  readonly waveDirection: number;
  /** -1..1 vertical bob */
  readonly bob: number;
}

const TILT_GAIN = 0.035; // ≈2° at full deflection — juicy, never violent

export interface Slosh {
  /** kick the modes with window acceleration (CSS px/s²) */
  impulse(ax: number, ay: number): void;
  /** advance by dt seconds */
  step(dtSec: number): void;
  read(): SloshReading;
  isAwake(): boolean;
}

interface Mode {
  s: number;
  v: number;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

function stepMode(mode: Mode, omega: number, zeta: number, dt: number): void {
  const accel = -omega * omega * mode.s - 2 * zeta * omega * mode.v;
  mode.v += accel * dt;
  mode.s = clamp(mode.s + mode.v * dt, S_MAX);
}

function modeEnergy(mode: Mode, omega: number): number {
  return 0.5 * (mode.v * mode.v + omega * omega * mode.s * mode.s);
}

export function createSlosh(): Slosh {
  const x: Mode = { s: 0, v: 0 };
  const y: Mode = { s: 0, v: 0 };
  let awake = false;

  return {
    impulse(ax: number, ay: number): void {
      x.v = clamp(x.v + K_IMPULSE * ax, V_MAX);
      y.v = clamp(y.v + K_IMPULSE * ay * 0.6, V_MAX);
      if (Math.abs(x.v) > 1e-3 || Math.abs(y.v) > 1e-3) {
        awake = true;
      }
    },

    step(dtSec: number): void {
      if (!awake) return;
      // sub-step for stability when the ambient tick is coarse (80ms)
      const steps = Math.max(1, Math.ceil(dtSec / 0.016));
      const dt = dtSec / steps;
      for (let i = 0; i < steps; i++) {
        stepMode(x, OMEGA_X, ZETA_X, dt);
        stepMode(y, OMEGA_Y, ZETA_Y, dt);
      }
      const energy = modeEnergy(x, OMEGA_X) + modeEnergy(y, OMEGA_Y);
      if (energy < ENERGY_EPSILON) {
        x.s = 0;
        x.v = 0;
        y.s = 0;
        y.v = 0;
        awake = false;
      }
    },

    read(): SloshReading {
      return {
        tilt: TILT_GAIN * x.s,
        wave: Math.min(1, Math.abs(x.s)),
        waveDirection: x.v > 0.01 ? 1 : x.v < -0.01 ? -1 : 0,
        bob: clamp(y.s, 1),
      };
    },

    isAwake(): boolean {
      return awake;
    },
  };
}
