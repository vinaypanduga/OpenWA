/**
 * One shared loader per dashboard page. React.lazy and navigation preloading must call the same
 * dynamic import so the browser can reuse the downloaded module instead of starting another fetch.
 */
export const pageLoaders = {
  login: () => import('../pages/Login').then(module => ({ default: module.Login })),
  dashboard: () => import('../pages/Dashboard').then(module => ({ default: module.Dashboard })),
  sessions: () => import('../pages/Sessions').then(module => ({ default: module.Sessions })),
  chats: () => import('../pages/Chats').then(module => ({ default: module.Chats })),
  templates: () => import('../pages/Templates').then(module => ({ default: module.Templates })),
  customGroups: () => import('../pages/CustomGroups').then(module => ({ default: module.CustomGroups })),
  scheduledMessages: () => import('../pages/ScheduledMessages').then(module => ({ default: module.ScheduledMessages })),
  logs: () => import('../pages/Logs').then(module => ({ default: module.Logs })),
  apiKeys: () => import('../pages/ApiKeys').then(module => ({ default: module.ApiKeys })),
  apiDocumentation: () => import('../pages/ApiDocumentation').then(module => ({ default: module.ApiDocumentation })),
  messageTester: () => import('../pages/MessageTester').then(module => ({ default: module.MessageTester })),
} as const;

export type PageLoaderKey = keyof typeof pageLoaders;

/** Best-effort warm-up: lazyWithRetry remains responsible for a real navigation-time failure. */
export function preloadPage(page: PageLoaderKey): void {
  // jsdom route tests deliberately load one page at a time. Background-importing every dashboard
  // page there adds unrelated CSS/module side effects and does not model browser chunk fetching.
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) return;
  void pageLoaders[page]().catch(() => undefined);
}

export function preloadPages(pages: readonly PageLoaderKey[]): void {
  for (const page of pages) preloadPage(page);
}
