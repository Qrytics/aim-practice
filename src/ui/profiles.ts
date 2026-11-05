import type { ProfileId } from '../core/drill';

export interface ProfileInfo {
  id: ProfileId;
  name: string;
  /** Always shown with the name: these are inspired practice profiles, not replicas. */
  tag: string;
  blurb: string;
  controls: string;
}

export const PROFILES: Record<ProfileId, ProfileInfo> = {
  precision: {
    id: 'precision',
    name: 'Precision',
    tag: 'Valorant-inspired',
    blurb:
      'One target at a time. Flick to it, let the crosshair settle, and click once. Stopping before you shoot and spacing your shots both pay off.',
    controls: 'Left click fires a single shot.',
  },
  tracking: {
    id: 'tracking',
    name: 'Tracking',
    tag: 'Overwatch-inspired',
    blurb:
      'One target keeps moving and changing direction. Hold the left button and keep the crosshair on it. Strafing while you track is part of the practice.',
    controls: 'Hold the left button to fire; only time spent firing is scored.',
  },
};

export const PROFILE_DISCLAIMER =
  'Original drills inspired by these play styles. They do not replicate any game, use no game values, and the tracking drill is not a hero or weapon profile.';

export function isProfileId(v: unknown): v is ProfileId {
  return v === 'precision' || v === 'tracking';
}
