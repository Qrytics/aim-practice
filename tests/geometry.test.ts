import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, aimDirection, aimErrorDeg, aimHitsSphere, raySphere } from '../src/core/geometry';
import { Rng } from '../src/core/rng';

const TOL = 1e-9;

describe('aimDirection', () => {
  it('yaw 0 looks down -z; positive yaw turns left (-x); positive pitch looks up', () => {
    const f = aimDirection(0, 0);
    expect(Math.abs(f.x) + Math.abs(f.y)).toBeLessThan(TOL);
    expect(f.z).toBeCloseTo(-1, 12);
    expect(aimDirection(Math.PI / 2, 0).x).toBeCloseTo(-1, 12);
    expect(aimDirection(0, Math.PI / 4).y).toBeGreaterThan(0.7);
  });
  it('is always unit length', () => {
    for (const [y, p] of [[0.3, 0.2], [-2, 1], [5, -1.2]] as const) {
      const d = aimDirection(y, p);
      expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    }
  });
});

describe('raySphere', () => {
  const o = { x: 0, y: 0, z: 0 };
  const fwd = { x: 0, y: 0, z: -1 };
  it('hits dead centre at distance - radius', () => {
    expect(raySphere(o, fwd, { x: 0, y: 0, z: -10 }, 1)).toBeCloseTo(9, 12);
  });
  it('edge: just inside hits, just outside misses, tangent counts as a hit', () => {
    expect(raySphere(o, fwd, { x: 0.999, y: 0, z: -10 }, 1)).not.toBeNull();
    expect(raySphere(o, fwd, { x: 1.001, y: 0, z: -10 }, 1)).toBeNull();
    expect(raySphere(o, fwd, { x: 1, y: 0, z: -10 }, 1)).not.toBeNull();
  });
  it('a sphere behind the origin is not hit', () => {
    expect(raySphere(o, fwd, { x: 0, y: 0, z: 10 }, 1)).toBeNull();
  });
  it('origin inside the sphere returns the exit distance', () => {
    expect(raySphere(o, fwd, { x: 0, y: 0, z: 0 }, 2)).toBeCloseTo(2, 12);
  });
  it('is invariant to the ray origin offset along the ray', () => {
    const a = raySphere(o, fwd, { x: 0.3, y: 0.2, z: -8 }, 0.5)!;
    const b = raySphere({ x: 0, y: 0, z: -2 }, fwd, { x: 0.3, y: 0.2, z: -8 }, 0.5)!;
    expect(Math.abs(a - 2 - b)).toBeLessThan(TOL);
  });
});

describe('aimHitsSphere / aimErrorDeg (eye height included)', () => {
  const p = { x: 0, z: 0, yaw: 0, pitch: 0 };
  it('looking level at a target at eye height hits; aiming at the floor does not', () => {
    expect(aimHitsSphere(p, { x: 0, y: EYE_HEIGHT, z: -8 }, 0.2)).toBe(true);
    expect(aimHitsSphere({ ...p, pitch: -0.5 }, { x: 0, y: EYE_HEIGHT, z: -8 }, 0.2)).toBe(false);
  });
  it('angular radius: a 0.2 m target at 8 m spans about 1.43 degrees', () => {
    const half = (Math.asin(0.2 / 8) * 180) / Math.PI;
    const at = (deg: number) => aimHitsSphere({ ...p, yaw: -(deg * Math.PI) / 180 }, { x: 0, y: EYE_HEIGHT, z: -8 }, 0.2);
    expect(at(half * 0.98)).toBe(true);
    expect(at(half * 1.02)).toBe(false);
  });
  it('aim error is zero on target and 90 degrees to the side', () => {
    expect(aimErrorDeg(p, { x: 0, y: EYE_HEIGHT, z: -5 })).toBeCloseTo(0, 6);
    expect(aimErrorDeg(p, { x: 5, y: EYE_HEIGHT, z: 0 })).toBeCloseTo(90, 6);
  });
});

describe('Rng', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const c = new Rng(43);
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    const sc = Array.from({ length: 50 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
