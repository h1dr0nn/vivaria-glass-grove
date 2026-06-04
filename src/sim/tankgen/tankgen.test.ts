import { describe, expect, test } from "vitest";
import { MATERIAL, ZONE, cellIndex, generateTank } from "./index";
import { fbm1D, valueNoise1D } from "./noise";
import { emergentLandFraction } from "./terrain";

describe("noise", () => {
  test("valueNoise1D is deterministic and in [0,1)", () => {
    for (let x = 0; x < 50; x += 0.7) {
      const v = valueNoise1D(42, x);
      expect(v).toBe(valueNoise1D(42, x));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("noise is continuous (no jumps between close samples)", () => {
    for (let x = 0; x < 20; x += 0.01) {
      const a = fbm1D(7, x);
      const b = fbm1D(7, x + 0.01);
      expect(Math.abs(a - b)).toBeLessThan(0.1);
    }
  });

  test("different seeds give different noise", () => {
    const a = Array.from({ length: 20 }, (_, i) => fbm1D(1, i * 0.3));
    const b = Array.from({ length: 20 }, (_, i) => fbm1D(2, i * 0.3));
    expect(a).not.toEqual(b);
  });
});

describe("generateTank - determinism", () => {
  test("same (seed, landPercent) produces byte-identical tanks", () => {
    const a = generateTank(12345, 30);
    const b = generateTank(12345, 30);
    expect(a.terrainHeight).toEqual(b.terrainHeight);
    expect(a.waterlineY).toBe(b.waterlineY);
    expect(a.materials).toEqual(b.materials);
    expect(a.zones).toEqual(b.zones);
    expect(a.hardscape).toEqual(b.hardscape);
    expect(a.env).toEqual(b.env);
  });

  test("different seeds produce different terrain", () => {
    const a = generateTank(1, 50);
    const b = generateTank(2, 50);
    expect(a.terrainHeight).not.toEqual(b.terrainHeight);
  });

  test("input normalization: fractional/out-of-range values clamp", () => {
    expect(generateTank(42, 150).landPercent).toBe(100);
    expect(generateTank(42, -5).landPercent).toBe(0);
    expect(generateTank(42, 33.4).landPercent).toBe(33);
  });
});

describe("generateTank - the slider's promise", () => {
  test.each([10, 25, 50, 75, 90])(
    "emergent land columns ≈ land%% at land=%i (the visual promise)",
    (landPercent) => {
      // check across several seeds - the promise must hold for every world
      for (const seed of [777, 31, 42, 12345]) {
        const tank = generateTank(seed, landPercent);
        const fraction =
          emergentLandFraction(tank.terrainHeight, tank.waterlineY) * 100;
        expect(Math.abs(fraction - landPercent)).toBeLessThanOrEqual(12);
      }
    },
  );

  test("0% land has no emergent terrain", () => {
    const tank = generateTank(777, 0);
    expect(emergentLandFraction(tank.terrainHeight, tank.waterlineY)).toBe(0);
  });

  test("100% land has no standing water", () => {
    const tank = generateTank(42, 100);
    expect(tank.waterlineY).toBe(0);
    let waterCells = 0;
    for (const m of tank.materials) if (m === MATERIAL.water) waterCells++;
    expect(waterCells).toBe(0);
    expect(tank.env.waterFraction).toBe(0);
  });

  test("0% land is nearly all water", () => {
    const tank = generateTank(42, 0);
    expect(tank.env.waterFraction).toBeGreaterThan(0.9);
  });

  test("waterFraction decreases as landPercent rises", () => {
    const w10 = generateTank(42, 10).env.waterFraction;
    const w50 = generateTank(42, 50).env.waterFraction;
    const w90 = generateTank(42, 90).env.waterFraction;
    expect(w10).toBeGreaterThan(w50);
    expect(w50).toBeGreaterThan(w90);
  });

  test("archetype buckets follow the design bible", () => {
    expect(generateTank(1, 0).archetype).toBe("open-water");
    expect(generateTank(1, 20).archetype).toBe("riverbank");
    expect(generateTank(1, 50).archetype).toBe("paludarium");
    expect(generateTank(1, 80).archetype).toBe("hillside");
    expect(generateTank(1, 100).archetype).toBe("dryland");
  });
});

describe("generateTank - grid consistency", () => {
  test.each([0, 30, 60, 100])("land=%i: materials are physical", (land) => {
    const tank = generateTank(99, land);
    const { width, height, usableHeight, materials, terrainHeight, waterlineY } =
      tank;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const m = materials[cellIndex(width, x, y)];
        // no water above the waterline or in the glass headroom
        if (m === MATERIAL.water) {
          expect(y).toBeLessThan(waterlineY);
          expect(y).toBeLessThan(usableHeight);
        }
        // below the terrain surface is never air or water (solid or hardscape)
        if (y < terrainHeight[x]) {
          expect(m).not.toBe(MATERIAL.air);
          expect(m).not.toBe(MATERIAL.water);
        }
      }
      // glass headroom is air or stamped hardscape, never water/substrate
      for (let y = usableHeight; y < height; y++) {
        const m = materials[cellIndex(width, x, y)];
        expect([MATERIAL.air, MATERIAL.rock, MATERIAL.wood]).toContain(m);
      }
    }
  });

  test("substrate stack: drainage at the bottom, cap on top", () => {
    const tank = generateTank(7, 50);
    for (let x = 0; x < tank.width; x++) {
      const bottom = tank.materials[cellIndex(tank.width, x, 0)];
      expect([MATERIAL.drainage, MATERIAL.rock, MATERIAL.wood]).toContain(
        bottom,
      );
      const surface = tank.terrainHeight[x];
      const capCell = tank.materials[cellIndex(tank.width, x, surface - 1)];
      expect([
        MATERIAL.sand,
        MATERIAL.litter,
        MATERIAL.rock,
        MATERIAL.wood,
      ]).toContain(capCell);
    }
  });

  test("driftwood never pokes through the glass walls", () => {
    for (const seed of [1, 31, 42, 123, 777, 20260604]) {
      for (const land of [0, 25, 50, 75, 100]) {
        const tank = generateTank(seed, land);
        for (const piece of tank.hardscape) {
          expect(piece.x - piece.halfWidth).toBeGreaterThanOrEqual(1);
          expect(piece.x + piece.halfWidth).toBeLessThanOrEqual(
            tank.width - 1,
          );
        }
      }
    }
  });

  test("hardscape pieces exist and keep their distance", () => {
    const tank = generateTank(123, 40);
    expect(tank.hardscape.length).toBeGreaterThan(0);
    for (let i = 0; i < tank.hardscape.length; i++) {
      for (let j = i + 1; j < tank.hardscape.length; j++) {
        expect(
          Math.abs(tank.hardscape[i].x - tank.hardscape[j].x),
        ).toBeGreaterThanOrEqual(18);
      }
    }
  });
});

describe("generateTank - fields & environment", () => {
  test("light and moisture stay in [0,1]", () => {
    const tank = generateTank(5, 45);
    for (let i = 0; i < tank.light.length; i++) {
      expect(tank.light[i]).toBeGreaterThanOrEqual(0);
      expect(tank.light[i]).toBeLessThanOrEqual(1);
      expect(tank.moisture[i]).toBeGreaterThanOrEqual(0);
      expect(tank.moisture[i]).toBeLessThanOrEqual(1);
    }
  });

  test("light dims with water depth", () => {
    const tank = generateTank(5, 10);
    // find a deep water column
    const x = tank.terrainHeight.indexOf(Math.min(...tank.terrainHeight));
    const surface = tank.light[cellIndex(tank.width, x, tank.waterlineY - 1)];
    const bottom = tank.light[cellIndex(tank.width, x, tank.terrainHeight[x])];
    expect(bottom).toBeLessThan(surface);
  });

  test("underwater moisture is 1; hilltops are drier than shores", () => {
    const tank = generateTank(11, 60);
    const minH = Math.min(...tank.terrainHeight);
    const maxH = Math.max(...tank.terrainHeight);
    const wetX = tank.terrainHeight.indexOf(minH);
    const dryX = tank.terrainHeight.indexOf(maxH);
    expect(
      tank.moisture[cellIndex(tank.width, wetX, Math.max(0, minH - 1))],
    ).toBe(1);
    const hilltop = tank.moisture[cellIndex(tank.width, dryX, maxH + 1)];
    const shoreX = tank.terrainHeight.findIndex(
      (h) => Math.abs(h - tank.waterlineY) <= 2,
    );
    if (shoreX >= 0) {
      const shore =
        tank.moisture[cellIndex(tank.width, shoreX, tank.waterlineY + 1)];
      expect(hilltop).toBeLessThan(shore);
    }
  });

  test("env aggregates are sane for a riverbank tank", () => {
    const env = generateTank(42, 30).env;
    expect(env.light).toBeGreaterThan(0.3);
    expect(env.light).toBeLessThanOrEqual(1);
    expect(env.moisture).toBeGreaterThan(0.4);
    expect(env.waterFraction).toBeGreaterThan(0.4);
  });

  test("zones: deep water in watery tanks, highland in landy tanks, shore in mixed", () => {
    const hasZone = (land: number, zone: number): boolean => {
      const tank = generateTank(31, land);
      for (let i = 0; i < tank.zones.length; i++) {
        if (tank.zones[i] === zone) return true;
      }
      return false;
    };
    expect(hasZone(5, ZONE.deepWater)).toBe(true);
    expect(hasZone(90, ZONE.highland)).toBe(true);
    expect(hasZone(45, ZONE.shore)).toBe(true);
    expect(hasZone(45, ZONE.shallows)).toBe(true);
  });
});

describe("generateTank - performance", () => {
  test("generates in well under 50ms", () => {
    const start = performance.now();
    generateTank(1, 50);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
