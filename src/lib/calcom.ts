export const CALCOM_LINK = 'leclubimmo/assurance-emprunteur';
export const CALCOM_NAMESPACE = 'assurance-emprunteur';
export const CALCOM_CONFIG = JSON.stringify({
  layout: 'month_view',
  useSlotsViewOnSmallScreen: 'true',
});

declare global {
  interface Window {
    Cal?: {
      loaded?: boolean;
      ns: Record<string, { q: unknown[][] }>;
      q: unknown[][];
      config?: { forwardQueryParams?: boolean };
      (...args: unknown[]): void;
    };
  }
}

let calInitStarted = false;

/** Charge le script Cal.com une seule fois (intégration « clic sur un élément »). */
export function ensureCalComEmbed(): void {
  if (calInitStarted || typeof window === 'undefined') return;
  calInitStarted = true;

  const w = window;
  // Snippet officiel Cal.com — element-click
  (function (C, A, L) {
    const p = function (a: { q: unknown[][] }, ar: unknown[]) {
      a.q.push(ar);
    };
    const d = C.document;
    C.Cal =
      C.Cal ||
      function (...ar: unknown[]) {
        const cal = C.Cal!;
        if (!cal.loaded) {
          cal.ns = {};
          cal.q = cal.q || [];
          d.head.appendChild(d.createElement('script')).src = A;
          cal.loaded = true;
        }
        if (ar[0] === L) {
          const api = function (...inner: unknown[]) {
            p(api as unknown as { q: unknown[][] }, inner);
          };
          (api as unknown as { q: unknown[][] }).q = [];
          const namespace = ar[1];
          if (typeof namespace === 'string') {
            cal.ns[namespace] = cal.ns[namespace] || (api as unknown as { q: unknown[][] });
            p(cal.ns[namespace], ar);
            p(cal, ['initNamespace', namespace]);
          } else {
            p(cal, ar);
          }
          return;
        }
        p(cal, ar);
      };
  })(w, 'https://app.cal.com/embed/embed.js', 'init');

  w.Cal!('init', CALCOM_NAMESPACE, { origin: 'https://app.cal.com' });
  w.Cal!.config = w.Cal!.config || {};
  w.Cal!.config.forwardQueryParams = true;
  w.Cal!.ns[CALCOM_NAMESPACE]('ui', {
    cssVarsPerTheme: {
      light: { 'cal-brand': '#130362' },
      dark: { 'cal-brand': '#fafafa' },
    },
    hideEventTypeDetails: false,
    layout: 'month_view',
  });
}
