/**
 * Input events as the simulation sees them.
 *
 * Every event carries a timestamp `t` in SECONDS on the same monotonic
 * timeline as the simulation clock (browser: DOMHighResTimeStamp / 1000).
 * Look deltas are in raw browser input units; the simulation converts them
 * with the current sensitivity. Look data is consumed immediately and never
 * stored beyond the running totals the HUD needs.
 */

export type MoveKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';

export const MOVE_KEYS: readonly MoveKey[] = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

export function isMoveKey(code: string): code is MoveKey {
  return (MOVE_KEYS as readonly string[]).includes(code);
}

export type InputEvent =
  | { t: number; type: 'look'; dx: number; dy: number }
  | { t: number; type: 'key'; code: MoveKey; down: boolean }
  | { t: number; type: 'fire' }
  /** Trigger held/released (tracking uses the held state; down is ignored outside Running). */
  | { t: number; type: 'trigger'; down: boolean }
  | { t: number; type: 'reset' };

/** Currently held movement keys. Cleared wholesale by reset(). */
export class HeldInput {
  private readonly down = new Set<MoveKey>();

  set(code: MoveKey, isDown: boolean): void {
    if (isDown) this.down.add(code);
    else this.down.delete(code);
  }

  reset(): void {
    this.down.clear();
  }

  get count(): number {
    return this.down.size;
  }

  has(code: MoveKey): boolean {
    return this.down.has(code);
  }

  /** forward/right in [-1, 1]; opposite keys cancel. */
  axes(): { forward: number; right: number } {
    const f = (this.down.has('KeyW') ? 1 : 0) - (this.down.has('KeyS') ? 1 : 0);
    const r = (this.down.has('KeyD') ? 1 : 0) - (this.down.has('KeyA') ? 1 : 0);
    return { forward: f, right: r };
  }
}

/** True when a keyboard shortcut (such as R) must not fire because the user is typing/selecting. */
export interface EditableLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

export function isEditableTarget(el: EditableLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.getAttribute?.('type') ?? 'text').toLowerCase();
    // Buttons, checkboxes and radios do not take typed text.
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(type);
  }
  const role = el.getAttribute?.('role');
  return role === 'textbox' || role === 'spinbutton' || role === 'combobox';
}
