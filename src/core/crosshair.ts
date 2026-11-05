/**
 * Crosshair customization. Pure data + validation; drawn as inline SVG by the UI
 * so it is crisp at any pixel ratio. An original design, not any game's reticle.
 * The default keeps a dark outline so it stays visible on bright and dark surfaces.
 */

export type CrosshairStyle = 'cross' | 'dot' | 'circle' | 'cross-dot';

export interface CrosshairSettings {
  style: CrosshairStyle;
  /** CSS px */
  size: number;
  thickness: number;
  gap: number;
  /** #rrggbb */
  color: string;
  outline: boolean;
  /** 0.2..1 */
  opacity: number;
}

export const CROSSHAIR_STYLES: readonly CrosshairStyle[] = ['cross', 'dot', 'circle', 'cross-dot'];

export const DEFAULT_CROSSHAIR: CrosshairSettings = {
  style: 'cross',
  size: 8,
  thickness: 2,
  gap: 4,
  color: '#f4fffe',
  outline: true,
  opacity: 1,
};

export const CROSSHAIR_LIMITS = {
  size: { min: 2, max: 30 },
  thickness: { min: 1, max: 6 },
  gap: { min: 0, max: 16 },
  opacity: { min: 0.2, max: 1 },
} as const;

function num(v: unknown, r: { min: number; max: number }, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max ? v : fallback;
}

export function parseCrosshair(raw: unknown): CrosshairSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CROSSHAIR;
  return {
    style: CROSSHAIR_STYLES.includes(o.style as CrosshairStyle) ? (o.style as CrosshairStyle) : d.style,
    size: num(o.size, CROSSHAIR_LIMITS.size, d.size),
    thickness: num(o.thickness, CROSSHAIR_LIMITS.thickness, d.thickness),
    gap: num(o.gap, CROSSHAIR_LIMITS.gap, d.gap),
    color: typeof o.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.color) ? o.color.toLowerCase() : d.color,
    outline: typeof o.outline === 'boolean' ? o.outline : d.outline,
    opacity: num(o.opacity, CROSSHAIR_LIMITS.opacity, d.opacity),
  };
}

/** Relative luminance 0..1 of #rrggbb (sRGB). */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

/** Contrast ratio between two #rrggbb colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * A warning (not a block) when the colour is likely hard to see on both of this app's arenas
 * and has no outline to help. Returns null when fine.
 */
export function visibilityWarning(c: CrosshairSettings): string | null {
  if (c.outline && c.opacity >= 0.6) return null;
  const arenaDark = '#0e1f21';
  const arenaWarm = '#21160c';
  const worst = Math.min(contrast(c.color, arenaDark), contrast(c.color, arenaWarm));
  if (worst < 3) return 'This colour is close to the arena colours; turn the outline on or pick a brighter colour.';
  if (c.opacity < 0.6) return 'Low opacity can make the crosshair hard to see against the targets.';
  return null;
}

/**
 * SVG markup for the crosshair, built only from validated numbers and a regex-checked colour
 * (parseCrosshair), so no free text reaches the markup.
 */
export function crosshairSvg(c: CrosshairSettings): string {
  const half = c.gap + c.size;
  const box = Math.ceil(half * 2 + c.thickness * 2 + 8);
  const mid = box / 2;
  const t = c.thickness;

  const shapes: string[] = [];
  if (c.style === 'cross' || c.style === 'cross-dot') {
    shapes.push(
      `<rect x="${mid - t / 2}" y="${mid - half}" width="${t}" height="${c.size}"/>`,
      `<rect x="${mid - t / 2}" y="${mid + c.gap}" width="${t}" height="${c.size}"/>`,
      `<rect x="${mid - half}" y="${mid - t / 2}" width="${c.size}" height="${t}"/>`,
      `<rect x="${mid + c.gap}" y="${mid - t / 2}" width="${c.size}" height="${t}"/>`,
    );
  }
  if (c.style === 'dot' || c.style === 'cross-dot') {
    shapes.push(`<circle cx="${mid}" cy="${mid}" r="${Math.max(1, t)}"/>`);
  }
  const ring = c.style === 'circle' ? `<circle cx="${mid}" cy="${mid}" r="${c.gap + c.size / 2}" fill="none"/>` : '';

  const layer = (fill: string, stroke: string, strokeWidth: number) =>
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round" opacity="${c.opacity}">${shapes.join('')}${ring}</g>`;

  // Outline layer first (thicker, dark), then the coloured layer on top.
  const outline = c.outline ? layer('#07110f', '#07110f', 2) : '';
  const main = c.style === 'circle' ? layer('none', c.color, t) : layer(c.color, 'none', 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true" focusable="false">${outline}${main}</svg>`;
}
