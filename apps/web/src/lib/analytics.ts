'use client';

export const UMAMI_EVENTS = {
  nav_click: 'nav_click',
  nav_mobile_toggle: 'nav_mobile_toggle',
  logo_click: 'logo_click',
  hero_cta_click: 'hero_cta_click',
  pricing_click: 'pricing_click',
  footer_link_click: 'footer_link_click',
  social_link_click: 'social_link_click',
  sign_in_click: 'sign_in_click',
  sign_up_click: 'sign_up_click',
} as const;

export type UmamiEventKey = keyof typeof UMAMI_EVENTS;

export type EventPayload = Record<string, string | number | boolean | undefined>;

const DEFAULT_EVENT_DATA = {
  site: process.env.NEXT_PUBLIC_UMAMI_TAG || 'marketing-site',
} as const satisfies Record<string, string>;

const VISITOR_STORAGE_KEY = 'umami:visitorId';

const getTracker = () => {
  if (typeof window === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tracker = (window as unknown as { umami?: Record<string, any> }).umami;
  return tracker ?? null;
};

const sanitizeData = (data?: EventPayload) => {
  const payload = { ...DEFAULT_EVENT_DATA, ...data };
  return Object.entries(payload).reduce<Record<string, string | number | boolean>>((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    if (typeof value === 'string') {
      acc[key] = value.slice(0, 120);
      return acc;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const umamiEventAttributes = (event: UmamiEventKey, data?: EventPayload) => {
  const payload = sanitizeData(data);
  const attrs: Record<string, string> = { 'data-umami-event': UMAMI_EVENTS[event] };

  Object.entries(payload).forEach(([key, value]) => {
    attrs[`data-umami-event-${key}`] = String(value);
  });

  return attrs;
};

export function trackEvent(event: UmamiEventKey, data?: EventPayload) {
  const tracker = getTracker();
  if (!tracker) return;

  const payload = sanitizeData(data);

  try {
    if (typeof tracker.track === 'function') {
      tracker.track(UMAMI_EVENTS[event], payload);
      return;
    }

    if (typeof tracker === 'function') {
      tracker(UMAMI_EVENTS[event], payload);
      return;
    }

    if (typeof tracker.trackEvent === 'function') {
      tracker.trackEvent(UMAMI_EVENTS[event], 'custom');
    }
  } catch (error) {
    console.warn('Umami track failed', error);
  }
}

const createVisitorId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return (
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Date.now().toString(36)
  );
};

export const ensureVisitorId = () => {
  if (typeof window === 'undefined') return null;
  const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
  if (existing) return existing;

  const nextId = createVisitorId();
  window.localStorage.setItem(VISITOR_STORAGE_KEY, nextId);
  return nextId;
};

export const initUmamiIdentity = (): (() => void) => {
  if (typeof window === 'undefined') return () => {};

  const visitorId = ensureVisitorId();
  let attempts = 0;

  const interval = window.setInterval(() => {
    const tracker = getTracker();

    if (tracker?.identify && visitorId) {
      tracker.identify(visitorId);
      window.clearInterval(interval);
      return;
    }

    attempts += 1;
    if (attempts >= 10) {
      window.clearInterval(interval);
    }
  }, 400);

  return () => window.clearInterval(interval);
};
