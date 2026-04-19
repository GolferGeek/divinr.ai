/**
 * Shared types for the first-touch walkthrough feature.
 *
 * One row per (user, surface_key) in prediction.user_surface_touches. The
 * frontend's useFirstTouch(surfaceKey) composable fires a short docent panel
 * the first time a surface is reached, then never again (unless reset).
 */

export interface FirstTouchState {
  muted: boolean;
  touched: string[];
}

export type FirstTouchPatch =
  | { action: 'mark_touched'; surface_key: string }
  | { action: 'set_mute'; muted: boolean }
  | { action: 'reset_all' }
  | { action: 'reset_prefix'; prefix: string };

export interface MarkTouchedRequest {
  surface_key: string;
}

export interface MuteRequest {
  muted: boolean;
}

export type ResetRequest =
  | { scope: 'all' }
  | { scope: 'prefix'; prefix: string };

const SURFACE_KEY_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

export function isValidSurfaceKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 120 && SURFACE_KEY_PATTERN.test(key);
}

export function isValidPrefix(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 120) return false;
  return /^[a-z0-9][a-z0-9.-]*$/.test(value);
}
