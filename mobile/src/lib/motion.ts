import { createElement, useMemo, type ReactNode } from "react";
import { MotionContext, type MotionProps, type Transition } from "motion/react";
import { REDUCED_MOTION_QUERY, useMediaQuery } from "@/hooks/use-media-query";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

// ---------- springs ----------
// one vocabulary for every component; the css twins of snappy and smooth are --motion-ease-snappy / --motion-ease-spring

export const springs = {
  // press feedback, toggles, switch thumbs, checkmarks: anything that answers a finger. ~250ms, a hint of overshoot
  snappy: { type: "spring", stiffness: 500, damping: 32 },
  // the default: popovers, menus, tab indicators, layout shifts, dialogs. ~300ms, no visible overshoot
  smooth: { type: "spring", stiffness: 300, damping: 30 },
  // playful accents only: a like, a badge popping in, a success tick. clear overshoot, use sparingly
  bouncy: { type: "spring", stiffness: 400, damping: 18 },
  // large surfaces and slow reveals: sheets settling, page sections, chart bars. ~450ms, soft
  gentle: { type: "spring", stiffness: 120, damping: 20 },
} as const satisfies Record<string, Transition>;

export type SpringName = keyof typeof springs;

// cubic-bezier curves for tweens (opacity, colors, anything that should not overshoot)
export const easings = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  // the ios / vaul sheet curve
  sheet: [0.32, 0.72, 0, 1],
} as const;

// seconds, matching --motion-duration-fast / normal / slow
export const durations = { fast: 0.15, normal: 0.24, slow: 0.4 } as const;

// ---------- presets ----------
// spread onto a motion element: <motion.div {...presets.popover} />. inside <AnimatePresence> the exit runs too

export type MotionPreset = Pick<MotionProps, "initial" | "animate" | "exit" | "transition">;

// a quick exit reads as responsive; entering can take its time
const EXIT = { duration: durations.fast, ease: easings.out } as const;

export const presets = {
  // the dimmed backdrop behind dialogs and sheets
  overlay: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: EXIT },
    transition: { duration: durations.normal, ease: easings.out },
  },
  // popovers, dropdown menus, selects, hover cards. set style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
  // (or the menu / select equivalent) so it grows out of its trigger
  popover: {
    initial: { opacity: 0, scale: 0.96 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98, transition: EXIT },
    transition: springs.snappy,
  },
  // tooltips: small, quick, no bounce
  tooltip: {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, transition: { duration: 0.1 } },
    transition: { duration: durations.fast, ease: easings.out },
  },
  // centered dialogs and alert dialogs
  dialog: {
    initial: { opacity: 0, scale: 0.96, y: 8 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, y: 4, transition: EXIT },
    transition: springs.smooth,
  },
  // bottom sheets; other edges come from sheetFrom()
  sheet: {
    initial: { y: "100%" },
    animate: { y: 0 },
    exit: { y: "100%", transition: { duration: 0.25, ease: easings.sheet } },
    transition: { type: "spring", stiffness: 380, damping: 38 },
  },
  // content swaps (tab panels, wizard steps, empty -> filled states)
  fade: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4, transition: EXIT },
    transition: springs.smooth,
  },
  // rows entering and leaving a list; add layout (and layout="position" on text-heavy rows) so the rest slides into place
  listItem: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, scale: 0.98, transition: EXIT },
    transition: springs.smooth,
  },
  // toasts rise from the bottom edge and leave the same way
  toast: {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 8, scale: 0.98, transition: EXIT },
    transition: springs.smooth,
  },
  // disclosure content (accordion, collapsible, expandable rows): the one sanctioned height animation.
  // put it on an overflow-hidden wrapper whose child carries the padding, so the padding never squashes
  collapse: {
    initial: { height: 0, opacity: 0 },
    animate: { height: "auto", opacity: 1 },
    exit: { height: 0, opacity: 0, transition: { duration: 0.2, ease: easings.inOut } },
    transition: springs.smooth,
  },
} as const satisfies Record<string, MotionPreset>;

export type PresetName = keyof typeof presets;

export type SheetSide = "top" | "right" | "bottom" | "left";

// a sheet or drawer entering from any edge
export function sheetFrom(side: SheetSide): MotionPreset {
  const offset = side === "left" || side === "top" ? "-100%" : "100%";
  const at = (value: string | number) => (side === "left" || side === "right" ? { x: value } : { y: value });
  return {
    ...presets.sheet,
    initial: at(offset),
    animate: at(0),
    exit: { ...at(offset), transition: { duration: 0.25, ease: easings.sheet } },
  };
}

// the press feedback every pressable surface shares: <motion.button {...press} />
export const press = {
  whileTap: { scale: 0.97 },
  transition: springs.snappy,
} as const satisfies Pick<MotionProps, "whileTap" | "transition">;

// ---------- gestures ----------
// one set of thresholds for every drag, swipe and long press, matched to vaul so a custom sheet and a vaul sheet
// dismiss at the same point

export const gestures = {
  // a drag completes (dismiss, commit a swipe action, change page) past this fraction of the surface size...
  completeFraction: 0.25,
  // ...or when flicked faster than this, in px/s, in the drag direction
  completeVelocity: 400,
  // motion's dragElastic: how far a surface follows the finger past its limits
  elastic: 0.2,
  // hold time before a long press fires (context menus, reorder), in ms
  longPress: 450,
  // movement in px that cancels a tap or long press and starts a drag instead
  slop: 8,
} as const;

// true when a drag should complete rather than spring back. offset and velocity are along the drag axis, positive
// toward completion; pass info.offset.y and info.velocity.y from onDragEnd
export function shouldComplete(offset: number, velocity: number, size: number) {
  if (velocity > gestures.completeVelocity) return true;
  if (velocity < -gestures.completeVelocity) return false;
  return offset > size * gestures.completeFraction;
}

// ios-style resistance past an edge: the further you pull, the less it moves. overflow is how far past the limit
// the finger is; returns how far the surface should move
export function rubberband(overflow: number, dimension: number, constant = 0.55) {
  if (dimension <= 0) return 0;
  const distance = Math.abs(overflow);
  return Math.sign(overflow) * (1 - 1 / ((distance * constant) / dimension + 1)) * dimension;
}

// ---------- stagger ----------

// parent variants that reveal their children one after another. give the children staggerItem and let the
// parent drive: <motion.ul variants={staggerChildren()} initial="hidden" animate="visible">
export function staggerChildren(step = 0.04, delay = 0) {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: step, delayChildren: delay } },
  };
}

export const staggerItem = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: springs.smooth },
};

// a per-index delay for items that animate on their own (virtualized rows, chart bars); capped so long lists
// never keep the last item waiting
export function staggerDelay(index: number, step = 0.03, max = 0.3) {
  return Math.min(Math.max(index, 0) * step, max);
}

// ---------- reduced motion ----------

// true when the user asked for less motion. false on the server and during hydration, then the real preference,
// so server and client markup match (motion's own useReducedMotion reads the query during the first render)
export function usePrefersReducedMotion() {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

const TRANSFORMS = new Set([
  "x",
  "y",
  "z",
  "scale",
  "scaleX",
  "scaleY",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skew",
  "skewX",
  "skewY",
  "translateX",
  "translateY",
  "translateZ",
  "originX",
  "originY",
]);

const REDUCED_TRANSITION: Transition = { duration: durations.fast, ease: "linear" };

function calm(target: MotionPreset["initial"], opacity: number) {
  // variant labels ("hidden"), false and arrays pass through untouched
  if (!target || typeof target !== "object" || Array.isArray(target)) return target;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(target)) {
    if (TRANSFORMS.has(key)) continue;
    out[key] = key === "transition" ? REDUCED_TRANSITION : value;
  }
  // a surface that only moved (a sheet) cross-fades instead of popping in
  if (!("opacity" in out)) out.opacity = opacity;
  return out as MotionPreset["initial"];
}

// the same preset without movement: transforms dropped, opacity kept, a short linear fade
export function reducePreset<T extends MotionPreset>(preset: T, reduced: boolean): T {
  if (!reduced) return preset;
  return {
    ...preset,
    initial: calm(preset.initial, 0),
    animate: calm(preset.animate as MotionPreset["initial"], 1) as MotionPreset["animate"],
    exit: calm(preset.exit as MotionPreset["initial"], 0) as MotionPreset["exit"],
    transition: REDUCED_TRANSITION,
  };
}

// a preset (by name or value) that respects prefers-reduced-motion: <motion.div {...useMotionPreset("popover")} />
export function useMotionPreset(preset: PresetName | MotionPreset): MotionPreset {
  const reduced = usePrefersReducedMotion();
  return useMemo(() => reducePreset(typeof preset === "string" ? presets[preset] : preset, reduced), [preset, reduced]);
}

// a transition that becomes instant under reduced motion: transition={useMotionTransition(springs.snappy)}
export function useMotionTransition(transition: Transition = springs.smooth): Transition {
  const reduced = usePrefersReducedMotion();
  return reduced ? { duration: 0 } : transition;
}

// ---------- portal boundary ----------

const DETACHED_MOTION = {};

// a portal renders outside the box of whatever opened it, but motion still files it under the opener in its layout
// tree. when the opener rests at a transform (a dialog stepped back to scale 0.96 behind its child, a dragged panel),
// every layout animation inside the portal (a wizard's panels, a tab indicator) "corrects" for that transform and
// jumps on each re-render. an empty context starts a fresh tree at the portal. keep it outside AnimatePresence, where
// it does not get between the presence and its child. a layoutId no longer morphs across the boundary
export function MotionBoundary({ children }: { children?: ReactNode }) {
  return createElement(MotionContext.Provider, { value: DETACHED_MOTION }, children);
}
