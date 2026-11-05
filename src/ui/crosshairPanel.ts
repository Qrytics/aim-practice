/** Crosshair controls: binds the inputs, validates through parseCrosshair, draws previews. */

import {
  CROSSHAIR_LIMITS,
  DEFAULT_CROSSHAIR,
  crosshairSvg,
  parseCrosshair,
  visibilityWarning,
  type CrosshairSettings,
} from '../core/crosshair';

function $<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e as T;
}

/** Parse trusted-by-construction SVG text (numbers and a regex-checked colour) into a node. */
export function svgNode(markup: string): Node {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  return document.importNode(doc.documentElement, true);
}

export function drawCrosshair(into: HTMLElement, c: CrosshairSettings): void {
  into.replaceChildren(svgNode(crosshairSvg(c)));
}

export class CrosshairPanel {
  private value: CrosshairSettings;
  private readonly style = $<HTMLSelectElement>('x-style');
  private readonly size = $<HTMLInputElement>('x-size');
  private readonly thick = $<HTMLInputElement>('x-thick');
  private readonly gap = $<HTMLInputElement>('x-gap');
  private readonly opacity = $<HTMLInputElement>('x-opacity');
  private readonly color = $<HTMLInputElement>('x-color');
  private readonly outline = $<HTMLInputElement>('x-outline');

  constructor(
    initial: CrosshairSettings,
    private readonly onChange: (c: CrosshairSettings) => void,
  ) {
    this.value = initial;
    this.size.min = String(CROSSHAIR_LIMITS.size.min);
    this.size.max = String(CROSSHAIR_LIMITS.size.max);
    this.write(initial);
    for (const e of [this.style, this.size, this.thick, this.gap, this.opacity, this.color, this.outline]) {
      e.addEventListener('input', () => this.read());
      e.addEventListener('change', () => this.read());
    }
    $('x-reset').addEventListener('click', () => {
      this.write(DEFAULT_CROSSHAIR);
      this.read();
    });
    this.preview();
  }

  private write(c: CrosshairSettings): void {
    this.style.value = c.style;
    this.size.value = String(c.size);
    this.thick.value = String(c.thickness);
    this.gap.value = String(c.gap);
    this.opacity.value = String(Math.round(c.opacity * 100));
    this.color.value = c.color;
    this.outline.checked = c.outline;
  }

  private read(): void {
    this.value = parseCrosshair({
      style: this.style.value,
      size: Number(this.size.value),
      thickness: Number(this.thick.value),
      gap: Number(this.gap.value),
      opacity: Number(this.opacity.value) / 100,
      color: this.color.value,
      outline: this.outline.checked,
    });
    this.preview();
    this.onChange(this.value);
  }

  private preview(): void {
    drawCrosshair($('xh-preview'), this.value);
    drawCrosshair($('xh-preview-light'), this.value);
    $('x-warn').textContent = visibilityWarning(this.value) ?? '';
  }
}
