/**
 * Settings form binding. Reads and validates fields, shows per-field errors
 * (aria-invalid + role=alert text), and only commits a settings object when
 * every relevant field is valid. Invalid input never reaches the simulation:
 * the last valid settings stay in force.
 */

import { calibratedDegreesPerUnit } from '../core/calibration';
import {
  FOV_LIMITS,
  REFERENCE_ASPECT,
  actualHorizontalFov,
  validateFovSetting,
  verticalFovFromSetting,
} from '../core/fov';
import type { Settings } from '../core/settings';
import {
  SENSITIVITY_LIMITS,
  degreesPerCount,
  resolveSensitivity,
  validateField,
  type ResolvedSensitivity,
  type SensitivityMode,
} from '../core/sensitivity';
import type { MovementMode } from '../input/browserInput';

export type ArenaShape = '16:9' | '21:9' | '4:3' | 'fill';

export interface PanelCallbacks {
  onCommit(settings: Settings, resolved: ResolvedSensitivity): void;
  onResetCounter(): void;
  onShape(shape: ArenaShape): void;
  /** Net degrees the view turned since the last counter reset. */
  getMeasuredTurnDeg(): number;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

const fmt = (n: number, digits = 4) => Number(n.toPrecision(digits)).toString();

export class SettingsPanel {
  private settings: Settings;
  private resolved: ResolvedSensitivity;
  private aspect = REFERENCE_ASPECT;
  private mode: MovementMode = 'none';

  private readonly dpi = $<HTMLInputElement>('f-dpi');
  private readonly cm = $<HTMLInputElement>('f-cm');
  private readonly upc = $<HTMLInputElement>('f-upc');
  private readonly dpu = $<HTMLInputElement>('f-dpu');
  private readonly fov = $<HTMLInputElement>('f-fov');
  private readonly intended = $<HTMLInputElement>('f-intended');
  private readonly shape = $<HTMLSelectElement>('f-shape');
  private readonly radios = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[name="sens-mode"]'),
  );

  constructor(initial: Settings, private readonly cb: PanelCallbacks) {
    this.settings = initial;
    const r = resolveSensitivity(initial.sensitivity);
    if (!r.ok) throw new Error('Initial settings invalid'); // parseSettings guarantees validity
    this.resolved = r.value;
    this.writeFields(initial);
    this.syncDisabled();
    this.renderDerived();

    const onInput = () => this.readAndCommit();
    for (const el of [this.dpi, this.cm, this.upc, this.dpu, this.fov]) el.addEventListener('input', onInput);
    for (const r of this.radios) r.addEventListener('change', () => this.onModeChange());
    this.shape.addEventListener('change', () => cb.onShape(this.shape.value as ArenaShape));

    // Enter in a number field must not submit/reload the page.
    $('settings-form').addEventListener('submit', (e) => e.preventDefault());
    $('cal-apply').addEventListener('click', () => this.applyCalibration());
    $('cal-reset').addEventListener('click', () => {
      cb.onResetCounter();
      this.calMessage('Counter reset to 0.0°.');
    });
  }

  get current(): Settings {
    return this.settings;
  }
  get resolvedSensitivity(): ResolvedSensitivity {
    return this.resolved;
  }

  /** Crosshair is edited by its own panel; keep the combined settings object current. */
  setCrosshair(crosshair: Settings['crosshair']): Settings {
    this.settings = { ...this.settings, crosshair };
    return this.settings;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.renderDerived();
  }

  setMovementMode(mode: MovementMode): void {
    this.mode = mode;
    this.renderDerived();
  }

  private writeFields(s: Settings): void {
    this.dpi.value = String(s.sensitivity.dpi);
    this.cm.value = String(s.sensitivity.cm360);
    this.upc.value = String(s.sensitivity.unitsPerCount);
    this.dpu.value = String(s.sensitivity.degreesPerUnit);
    this.fov.value = String(s.fovAt16x9);
    for (const r of this.radios) r.checked = r.value === s.sensitivity.mode;
  }

  private currentMode(): SensitivityMode {
    return this.radios.find((r) => r.checked)?.value === 'direct' ? 'direct' : 'nominal';
  }

  private syncDisabled(): void {
    const nominal = this.currentMode() === 'nominal';
    this.dpi.disabled = !nominal;
    this.cm.disabled = !nominal;
    this.upc.disabled = !nominal;
    this.dpu.disabled = nominal;
  }

  private onModeChange(): void {
    const next = this.currentMode();
    if (next === 'direct') {
      // Carry the current effective turn rate across so nothing jumps.
      this.dpu.value = fmt(this.resolved.degreesPerUnit, 6);
    }
    this.syncDisabled();
    this.readAndCommit();
  }

  private setErr(id: string, input: HTMLInputElement, msg: string): void {
    $(id).textContent = msg;
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  private readAndCommit(): void {
    const mode = this.currentMode();
    let ok = true;
    const check = (field: keyof typeof SENSITIVITY_LIMITS, input: HTMLInputElement, errId: string) => {
      const v = validateField(field, input.value.trim() === '' ? NaN : Number(input.value));
      this.setErr(errId, input, v.ok ? '' : v.error);
      if (!v.ok) ok = false;
      return v.ok ? v.value : NaN;
    };

    const s = this.settings.sensitivity;
    let next = { ...s, mode };
    if (mode === 'nominal') {
      next = {
        ...next,
        dpi: check('dpi', this.dpi, 'e-dpi'),
        cm360: check('cm360', this.cm, 'e-cm'),
        unitsPerCount: check('unitsPerCount', this.upc, 'e-upc'),
      };
      this.setErr('e-dpu', this.dpu, '');
    } else {
      next = { ...next, degreesPerUnit: check('degreesPerUnit', this.dpu, 'e-dpu') };
      this.setErr('e-dpi', this.dpi, '');
      this.setErr('e-cm', this.cm, '');
      this.setErr('e-upc', this.upc, '');
    }

    const fv = validateFovSetting(this.fov.value.trim() === '' ? NaN : Number(this.fov.value));
    this.setErr('e-fov', this.fov, fv.ok ? '' : fv.error);
    if (!fv.ok) ok = false;

    if (!ok) {
      this.renderDerived(true);
      return;
    }
    const r = resolveSensitivity(next);
    if (!r.ok || !fv.ok) return;
    this.settings = { ...this.settings, sensitivity: next, fovAt16x9: fv.value };
    this.resolved = r.value;
    this.renderDerived();
    this.cb.onCommit(this.settings, this.resolved);
  }

  private applyCalibration(): void {
    const intended = this.intended.value.trim() === '' ? NaN : Number(this.intended.value);
    if (!Number.isFinite(intended) || intended <= 0 || intended > 100000) {
      this.setErr('e-intended', this.intended, 'Enter the turn you made, in degrees (greater than 0).');
      return;
    }
    this.setErr('e-intended', this.intended, '');
    const measured = this.cb.getMeasuredTurnDeg();
    const newDpu = calibratedDegreesPerUnit(this.resolved.degreesPerUnit, measured, intended);
    if (newDpu === null) {
      this.calMessage('Nothing to calibrate yet: turn the view in the arena first, then press Esc and apply.');
      return;
    }
    const s = this.settings.sensitivity;
    if (s.mode === 'nominal') {
      // degreesPerUnit = degreesPerCount / unitsPerCount  =>  solve for unitsPerCount.
      const upc = degreesPerCount(s.cm360, s.dpi) / newDpu;
      const v = validateField('unitsPerCount', upc);
      if (!v.ok) {
        this.calMessage(`The result (${fmt(upc, 3)} units per count) is outside ${SENSITIVITY_LIMITS.unitsPerCount.min}–${SENSITIVITY_LIMITS.unitsPerCount.max}. Check the turn you entered.`);
        return;
      }
      this.upc.value = fmt(upc, 6);
    } else {
      const v = validateField('degreesPerUnit', newDpu);
      if (!v.ok) {
        this.calMessage(`The result (${fmt(newDpu, 4)} °/unit) is outside the allowed range. Check the turn you entered.`);
        return;
      }
      this.dpu.value = fmt(newDpu, 6);
    }
    this.cb.onResetCounter();
    this.readAndCommit();
    this.calMessage(
      `Calibrated to ${fmt(this.resolved.degreesPerUnit, 4)}° per browser input unit. Counter reset: repeat the same physical turn to check it reads about ${fmt(intended, 5)}°.`,
    );
  }

  private calMessage(text: string): void {
    $('cal-msg').textContent = text;
  }

  private renderDerived(invalid = false): void {
    const r = this.resolved;
    const s = this.settings.sensitivity;
    const unitsFor360 = 360 / r.degreesPerUnit;
    const lines: string[] = [];
    if (r.basis === 'nominal') {
      lines.push(`NOMINAL (assumes ${fmt(s.unitsPerCount, 4)} browser unit per count):`);
      lines.push(`${fmt(degreesPerCount(s.cm360, s.dpi), 4)}° per mouse count`);
    } else {
      lines.push('Direct setting (no DPI or count assumption):');
    }
    lines.push(`${fmt(r.degreesPerUnit, 4)}° per browser input unit`);
    lines.push(`360° = ${fmt(unitsFor360, 6)} input units`);
    if (invalid) lines.push('Invalid entry: still using the last valid values.');
    $('sens-derived').innerHTML = lines.map(escapeHtml).join('<br>');

    const modeText: Record<MovementMode, string> = {
      none: 'Pointer-lock mode: not known. It is recorded when a pointer-lock request completes.',
      unadjusted:
        'Pointer-lock mode: the browser ACCEPTED the request for unadjusted movement. This app cannot verify the physical mouse counts or that acceleration is really off; use calibration to check turn rate.',
      'default-os-adjusted':
        'Pointer-lock mode: the browser REJECTED the unadjusted-movement request, so the lock fell back to default movement. Default movement may include OS acceleration, so turns may not scale linearly with hand speed.',
      unconfirmed:
        'Pointer-lock mode: unadjusted movement was requested but this browser did not report whether it was applied.',
    };
    $('sens-mode-report').textContent = modeText[this.mode];

    const fovLimits = `${FOV_LIMITS.min}–${FOV_LIMITS.max}°`;
    const vfov = verticalFovFromSetting(this.settings.fovAt16x9);
    const hNow = actualHorizontalFov(this.settings.fovAt16x9, this.aspect);
    $('fov-derived').innerHTML = [
      `Vertical FOV (derived, fixed): ${fmt(vfov, 5)}°`,
      `Window aspect now: ${fmt(this.aspect, 4)} → horizontal ${fmt(hNow, 5)}°`,
      `Allowed setting: ${fovLimits}`,
    ]
      .map(escapeHtml)
      .join('<br>');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
