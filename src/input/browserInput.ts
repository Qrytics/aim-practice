/**
 * Browser input adapter: DOM events -> timestamped core input events.
 *
 * Nothing here decides game rules. Timestamps are event.timeStamp / 1000
 * (DOMHighResTimeStamp, same timeline as performance.now()). Mouse motion is
 * forwarded as it arrives and not stored, so raw movement is retained only
 * as far as the simulation consumes it.
 *
 * Pointer-lock requests, events and promises are coordinated by
 * LockCoordinator (see its header for the ordering rules). document.
 * pointerLockElement stays the single authority on ownership.
 */

import { isEditableTarget, isMoveKey, type MoveKey } from '../core/input';
import { LockCoordinator, type MovementMode, type RequestResult } from './lockCoordinator';

export type { MovementMode } from './lockCoordinator';

export interface InputHandlers {
  onLook(t: number, dx: number, dy: number): void;
  onKey(t: number, code: MoveKey, down: boolean): void;
  onFire(t: number): void;
  /** Left button pressed/released (release is always reported so a held trigger can never stick). */
  onTrigger(t: number, down: boolean): void;
  /** The lock the user asked for is held. */
  onLockAcquired(): void;
  /** A held lock was lost (Esc, browser policy, our own release). */
  onLockLost(): void;
  /** A lock arrived that nobody is waiting for; the owner should release it. */
  onUnexpectedLock(): void;
  /** The requested lock failed. Terminal for that request. */
  onLockDenied(message: string): void;
  onModeChange(mode: MovementMode): void;
  onBlur(reason: 'focus-lost' | 'hidden'): void;
  onPauseKey(): void;
  onRestartKey(): void;
  onCanvasClick(): void;
}

interface PointerLockOptions {
  unadjustedMovement?: boolean;
}

export class BrowserInput {
  private readonly abort = new AbortController();
  private readonly lock: LockCoordinator;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly h: InputHandlers,
  ) {
    this.lock = new LockCoordinator(
      {
        request: (options) =>
          options
            ? (canvas.requestPointerLock(options as PointerLockOptions) as Promise<void> | void)
            : (canvas.requestPointerLock() as Promise<void> | void),
        owns: () => document.pointerLockElement === canvas,
      },
      {
        onAcquired: () => h.onLockAcquired(),
        onDenied: (m) => h.onLockDenied(m),
        onLost: () => h.onLockLost(),
        onUnexpectedLock: () => h.onUnexpectedLock(),
        onMode: (m) => h.onModeChange(m),
      },
    );

    const o = { signal: this.abort.signal };
    document.addEventListener('pointerlockchange', () => this.lock.handleChange(), o);
    document.addEventListener('pointerlockerror', () => this.lock.handleError(), o);
    document.addEventListener('mousemove', (e) => this.mouseMove(e), o);
    document.addEventListener('mousedown', (e) => this.mouseDown(e), o);
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.h.onTrigger(e.timeStamp / 1000, false);
    }, o);
    document.addEventListener('keydown', (e) => this.keyDown(e), o);
    document.addEventListener('keyup', (e) => this.keyUp(e), o);
    window.addEventListener('blur', () => this.h.onBlur('focus-lost'), o);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.h.onBlur('hidden');
    }, o);
    document.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    }, o);
    canvas.addEventListener('click', () => {
      if (!this.locked) this.h.onCanvasClick();
    }, o);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  get movementMode(): MovementMode {
    return this.lock.mode;
  }

  /**
   * One user-initiated lock request. Synchronous so it stays inside the user
   * gesture. Overlapping calls are coalesced; the only automatic second request
   * is the single NotSupportedError fallback inside LockCoordinator.
   */
  requestLock(): RequestResult {
    return this.lock.request();
  }

  /** The user stopped waiting. A lock that still arrives is reported as unexpected. */
  cancelLock(): void {
    this.lock.cancel();
  }

  releaseLock(): void {
    if (this.locked) document.exitPointerLock();
  }

  private mouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    this.h.onLook(e.timeStamp / 1000, e.movementX, e.movementY);
  }

  private mouseDown(e: MouseEvent): void {
    if (!this.locked || e.button !== 0) return;
    e.preventDefault();
    this.h.onFire(e.timeStamp / 1000);
    this.h.onTrigger(e.timeStamp / 1000, true);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.locked && isMoveKey(e.code)) {
      e.preventDefault();
      this.h.onKey(e.timeStamp / 1000, e.code, true);
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyP' && this.locked) {
      e.preventDefault();
      this.h.onPauseKey();
      return;
    }
    // R never restarts while the user is editing a field.
    if (e.code === 'KeyR' && !isEditableTarget(e.target as HTMLElement | null)) {
      this.h.onRestartKey();
    }
  }

  private keyUp(e: KeyboardEvent): void {
    // Always forwarded: releasing is harmless when nothing is held.
    if (isMoveKey(e.code)) this.h.onKey(e.timeStamp / 1000, e.code, false);
  }

  dispose(): void {
    this.abort.abort();
  }
}
