import { useCallback, useSyncExternalStore } from "react";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

// tailwind's default min-width breakpoints, in px
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 } as const;
export type Breakpoint = "base" | keyof typeof BREAKPOINTS;

// phones: below tailwind's md; overlays become bottom sheets here
export const MOBILE_QUERY = "(max-width: 767.98px)";
// the primary pointer is a finger: 44px targets, no hover-only affordances
export const TOUCH_QUERY = "(pointer: coarse)";
// a real hover exists (mouse or trackpad)
export const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

const lists = new Map<string, MediaQueryList>();

function mediaQueryList(query: string) {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

// true while the media query matches. the server (and the hydration render) sees serverFallback,
// then the real value; pick the fallback that matches the layout you render on the server
export function useMediaQuery(query: string, serverFallback = false) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaQueryList(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => mediaQueryList(query).matches,
    () => serverFallback,
  );
}

// the same check outside render (event handlers, effects); false on the server
export function matchesMedia(query: string) {
  return typeof window !== "undefined" && mediaQueryList(query).matches;
}

// below 768px
export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY);
}

// coarse primary pointer (phones, tablets)
export function useIsTouch() {
  return useMediaQuery(TOUCH_QUERY);
}

const BREAKPOINT_ENTRIES = (Object.entries(BREAKPOINTS) as [keyof typeof BREAKPOINTS, number][]).sort((a, b) => b[1] - a[1]);
const breakpointQuery = (px: number) => `(min-width: ${px}px)`;

function subscribeBreakpoints(onChange: () => void) {
  const all = BREAKPOINT_ENTRIES.map(([, px]) => mediaQueryList(breakpointQuery(px)));
  for (const list of all) list.addEventListener("change", onChange);
  return () => {
    for (const list of all) list.removeEventListener("change", onChange);
  };
}

function currentBreakpoint(): Breakpoint {
  for (const [name, px] of BREAKPOINT_ENTRIES) if (mediaQueryList(breakpointQuery(px)).matches) return name;
  return "base";
}

// the widest tailwind breakpoint that matches ("base" below 640px)
export function useBreakpoint(serverFallback: Breakpoint = "base"): Breakpoint {
  return useSyncExternalStore(subscribeBreakpoints, currentBreakpoint, () => serverFallback);
}

// apple devices (mac, iphone, ipad) show shortcuts as ⌘ / ⌥ / ⇧ and bind mod to the meta key
function detectApple() {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent);
}

const subscribeNever = () => () => {};

// true on apple devices. false on the server and during hydration (the non-apple notation renders first), then real
export function useIsApple() {
  return useSyncExternalStore(subscribeNever, detectApple, () => false);
}

// the same check outside render (keyboard handlers); false on the server
export function isApple() {
  return typeof navigator !== "undefined" && detectApple();
}
