/**
 * Public path of the bundled dashboard, derived from Vite's build-time `base` setting.
 * Root builds expose an empty prefix; a VITE_BASE_PATH=/openwa build exposes `/openwa`.
 */
const viteBaseUrl = import.meta.env.BASE_URL ?? '/';
export const APP_BASE_PATH = viteBaseUrl === '/' ? '' : viteBaseUrl.replace(/\/+$/, '');

/** Build a URL for a file copied from dashboard/public without escaping the configured base path. */
export function appAssetUrl(filename: string): string {
  return `${APP_BASE_PATH}/${filename.replace(/^\/+/, '')}`;
}
