"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import {
  AnimatePresence,
  animate as animateValue,
  motion,
  useIsPresent,
  useMotionValue,
  useTransform,
  type MotionValue,
  type Transition,
  type Variants,
} from "motion/react";
import { Badge } from "@/components/ui/badge";
import { useControllableState } from "@/hooks/use-controllable-state";
import { fadeMaskStyle, useScrollEdges } from "@/hooks/use-scroll-edges";
import { durations, easings, press, springs, usePrefersReducedMotion } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults } from "@/lib/ui-config";

export type TabsVariant = "underline" | "pill" | "segmented";
export type TabsSize = "sm" | "md" | "lg";
export type TabsRadius = "none" | "sm" | "md" | "lg" | "full";
export type TabsOrientation = "horizontal" | "vertical";
export type TabsActivationMode = "automatic" | "manual";
export type TabsSlot = "list" | "trigger" | "indicator" | "icon" | "label" | "badge" | "content";
export type { Tone as TabsTone };

export type TabsOption = {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  // a number renders a small count badge (hidden at 0), any other node renders as is
  badge?: ReactNode | number;
  disabled?: boolean;
  // the panel shown while this tab is active; leave it out to use the tabs as a filter or a switch
  content?: ReactNode;
};

// vertical tabs turn into a horizontal row above the content when they are narrow, unless responsive is off
type Mode = "horizontal" | "vertical" | "responsive";

// responsive vertical tabs lay out against their own width (a css container query on the root, 32rem), so a
// settings page folds into a row on a phone, in a side panel or in a narrow card alike
const NARROW_REM = 32;

// ---------------------------------------------------------------- sizes and shapes

// the control size table: 32 / 40 / 48px, md grows to 44px on touch, sm keeps its look with a 44px hit area
const SIZES: Record<TabsSize, string> = {
  sm: "h-8 gap-1.5 text-[13px] pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5",
  md: "h-10 gap-2 text-sm pointer-coarse:h-11",
  lg: "h-12 gap-2 text-[15px]",
};

// segmented triggers fill a track of that height inside its 2px padding
const SEGMENTED_SIZES: Record<TabsSize, string> = {
  sm: "h-7 gap-1.5 text-[13px] pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2",
  md: "h-9 gap-2 text-sm pointer-coarse:h-10",
  lg: "h-11 gap-2 text-[15px]",
};

// underline triggers sit edge to edge, so their padding is the space between labels; the bar is inset by the same
// amount so it spans the label. the hover tint stops short of the baseline
const PADDING: Record<TabsVariant, Record<TabsSize, string>> = {
  underline: {
    sm: "px-2.5 [--tabs-inset:10px] [--tabs-layer-y:4px]",
    md: "px-3 [--tabs-inset:12px] [--tabs-layer-y:6px]",
    lg: "px-4 [--tabs-inset:16px] [--tabs-layer-y:7px]",
  },
  pill: { sm: "px-3", md: "px-4", lg: "px-5" },
  segmented: { sm: "px-2.5", md: "px-3", lg: "px-4" },
};

// svgs without their own size- class follow the size: 14 / 16 / 18px
const ICON_SIZES: Record<TabsSize, string> = {
  sm: "[&_svg:not([class*='size-'])]:size-3.5",
  md: "[&_svg:not([class*='size-'])]:size-4",
  lg: "[&_svg:not([class*='size-'])]:size-[18px]",
};

// radius grows with the size so every size reads as the same shape (the button's map)
const RADII: Record<TabsRadius, Record<TabsSize, string>> = {
  none: { sm: "rounded-none", md: "rounded-none", lg: "rounded-none" },
  sm: { sm: "rounded-[6px]", md: "rounded-[8px]", lg: "rounded-[10px]" },
  md: { sm: "rounded-[8px]", md: "rounded-[10px]", lg: "rounded-[12px]" },
  lg: { sm: "rounded-[10px]", md: "rounded-[14px]", lg: "rounded-[16px]" },
  full: { sm: "rounded-full", md: "rounded-full", lg: "rounded-full" },
};

// segmented triggers and their thumb sit 2px inside the track, so they are 2px rounder-in
const INNER_RADII: Record<TabsRadius, Record<TabsSize, string>> = {
  none: { sm: "rounded-none", md: "rounded-none", lg: "rounded-none" },
  sm: { sm: "rounded-[4px]", md: "rounded-[6px]", lg: "rounded-[8px]" },
  md: { sm: "rounded-[6px]", md: "rounded-[8px]", lg: "rounded-[10px]" },
  lg: { sm: "rounded-[8px]", md: "rounded-[12px]", lg: "rounded-[14px]" },
  full: { sm: "rounded-full", md: "rounded-full", lg: "rounded-full" },
};

// the same radii in px: the sliding indicator counter-scales its corners by them so they never stretch
const RADIUS_PX: Record<TabsRadius, Record<TabsSize, number>> = {
  none: { sm: 0, md: 0, lg: 0 },
  sm: { sm: 6, md: 8, lg: 10 },
  md: { sm: 8, md: 10, lg: 12 },
  lg: { sm: 10, md: 14, lg: 16 },
  full: { sm: 9999, md: 9999, lg: 9999 },
};

// ---------------------------------------------------------------- layout per orientation

const ROOT_GAPS: Record<TabsSize, string> = {
  sm: "gap-3",
  md: "gap-4",
  lg: "gap-5",
};

const ROOT: Record<Mode, string> = {
  horizontal: "flex-col",
  vertical: "flex-row items-start gap-6",
  // the panels wrap under the list once it takes the full width
  responsive: "@container/tabs w-full flex-row flex-wrap items-start gap-x-6",
};

// a scrolling list clips at its edges, so it gets 6px of room above and below (taken back by a negative margin) for
// the 44px touch hit areas of sm triggers and the thumb's shadow, and its triggers draw their focus ring inside. a
// sideways negative margin would push a full-bleed list past the viewport
const LIST: Record<Mode, { base: string; scroll: string; ring: string }> = {
  horizontal: {
    base: "",
    scroll: "-my-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain py-1.5",
    ring: "focus-visible:-outline-offset-2",
  },
  vertical: { base: "min-w-44 shrink-0", scroll: "", ring: "" },
  responsive: {
    base: "@max-lg/tabs:w-full @lg/tabs:min-w-44 @lg/tabs:shrink-0",
    scroll:
      "@max-lg/tabs:-my-1.5 @max-lg/tabs:overflow-x-auto @max-lg/tabs:overflow-y-hidden @max-lg/tabs:overscroll-x-contain @max-lg/tabs:py-1.5",
    ring: "@max-lg/tabs:focus-visible:-outline-offset-2",
  },
};

const TRACK_VARIANTS: Record<TabsVariant, Record<Mode, string>> = {
  // the baseline under (or beside) every label; the active bar covers it
  underline: {
    horizontal: "border-b border-foreground/10",
    vertical: "flex-col border-s border-foreground/10",
    responsive: "border-foreground/10 @max-lg/tabs:border-b @lg/tabs:flex-col @lg/tabs:border-s",
  },
  pill: {
    horizontal: "gap-1 pointer-coarse:gap-2",
    vertical: "flex-col gap-1",
    responsive: "gap-1 @max-lg/tabs:pointer-coarse:gap-2 @lg/tabs:flex-col",
  },
  segmented: {
    horizontal: "bg-foreground/5 p-0.5",
    vertical: "flex-col bg-foreground/5 p-0.5",
    responsive: "bg-foreground/5 p-0.5 @lg/tabs:flex-col",
  },
};

// how wide the row of triggers is: the underline baseline always spans the list, pills and the segmented track hug
// their triggers, fullWidth shares the width. a list that may not scroll wraps instead
function trackWidth(mode: Mode, variant: TabsVariant, fullWidth: boolean, scrollable: boolean) {
  if (mode === "vertical") return "w-full";
  const hug = variant !== "underline";
  if (mode === "responsive") {
    if (!scrollable)
      return cn(
        "@max-lg/tabs:flex-wrap @lg/tabs:w-full",
        fullWidth || !hug ? "@max-lg/tabs:w-full" : "@max-lg/tabs:w-fit @max-lg/tabs:max-w-full",
      );
    return cn(
      "@lg/tabs:w-full",
      fullWidth
        ? "@max-lg/tabs:w-full @max-lg/tabs:min-w-max"
        : hug
          ? "@max-lg/tabs:w-max"
          : "@max-lg/tabs:w-max @max-lg/tabs:min-w-full",
    );
  }
  if (!scrollable) return cn("flex-wrap", fullWidth || !hug ? "w-full" : "w-fit max-w-full");
  return fullWidth ? "w-full min-w-max" : hug ? "w-max" : "w-max min-w-full";
}

const TRIGGER_LAYOUT: Record<Mode, { base: string; full: string }> = {
  horizontal: { base: "", full: "flex-1 basis-0" },
  vertical: { base: "w-full justify-start text-start", full: "" },
  responsive: {
    base: "@lg/tabs:w-full @lg/tabs:justify-start @lg/tabs:text-start",
    full: "@max-lg/tabs:flex-1 @max-lg/tabs:basis-0",
  },
};

// the hover and press tint: a layer of the text color. hover: only applies where hover exists, so a tap never
// leaves it stuck on; it stays under the indicator, so the active tab never looks hovered
const STATE_LAYER =
  "before:pointer-events-none before:absolute before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity before:duration-fast before:ease-smooth hover:before:opacity-[0.05] active:before:opacity-[0.1]";

const LAYER_INSETS: Record<TabsVariant, Record<Mode, string>> = {
  underline: {
    horizontal: "before:inset-x-0 before:inset-y-(--tabs-layer-y)",
    vertical: "before:inset-y-0.5 before:start-1.5 before:end-0",
    responsive:
      "@max-lg/tabs:before:inset-x-0 @max-lg/tabs:before:inset-y-(--tabs-layer-y) @lg/tabs:before:inset-y-0.5 @lg/tabs:before:start-1.5 @lg/tabs:before:end-0",
  },
  pill: {
    horizontal: "before:inset-0",
    vertical: "before:inset-0",
    responsive: "before:inset-0",
  },
  // segmented hovers with the text color only, like ios
  segmented: { horizontal: "", vertical: "", responsive: "" },
};

const INDICATOR_POSITIONS: Record<TabsVariant, Record<Mode, string>> = {
  underline: {
    horizontal: "inset-x-(--tabs-inset) -bottom-px h-0.5",
    vertical: "inset-y-2 -start-px w-0.5",
    responsive:
      "@max-lg/tabs:inset-x-(--tabs-inset) @max-lg/tabs:-bottom-px @max-lg/tabs:h-0.5 @lg/tabs:inset-y-2 @lg/tabs:-start-px @lg/tabs:w-0.5",
  },
  pill: { horizontal: "inset-0", vertical: "inset-0", responsive: "inset-0" },
  segmented: {
    horizontal: "inset-0",
    vertical: "inset-0",
    responsive: "inset-0",
  },
};

const LABEL_LAYOUT: Record<Mode, string> = {
  horizontal: "",
  vertical: "min-w-0 flex-1 truncate",
  responsive: "@lg/tabs:min-w-0 @lg/tabs:flex-1 @lg/tabs:truncate",
};

const PANELS_LAYOUT: Record<Mode, string> = {
  horizontal: "",
  vertical: "min-w-0 flex-1",
  responsive: "min-w-0 flex-1 basis-0 @max-lg/tabs:basis-full",
};

// ---------------------------------------------------------------- looks

// the selected look shared with toggle, toggle group and segmented control
const SELECTED_NEUTRAL = "bg-foreground/10";
const SELECTED_TONE = "bg-(--tone-soft)";
// the raised thumb of segmented tabs; mixed lighter in dark mode, where --popover and a 5% track over --surface are
// nearly the same gray
const THUMB_NEUTRAL = "bg-popover shadow-raised dark:bg-[color-mix(in_oklab,var(--foreground)_14%,var(--popover))]";
const THUMB_TONE = "bg-(--tone) shadow-raised";

function indicatorLook(variant: TabsVariant, neutral: boolean) {
  if (variant === "underline") return "bg-(--tone)";
  if (variant === "pill") return neutral ? SELECTED_NEUTRAL : SELECTED_TONE;
  return neutral ? THUMB_NEUTRAL : THUMB_TONE;
}

function activeText(variant: TabsVariant, neutral: boolean) {
  if (variant === "segmented" && !neutral) return "data-[state=active]:text-(--tone-foreground)";
  return "data-[state=active]:text-(--tone-soft-foreground)";
}

// touch-manipulation and the transparent tap highlight live here, not in a global stylesheet, so a copied tab never
// flashes gray or waits for a double tap on ios
const TRIGGER_BASE =
  "relative inline-flex shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center whitespace-nowrap font-medium text-muted-foreground outline-hidden [-webkit-tap-highlight-color:transparent] transition-[color,opacity] duration-fast ease-smooth data-[state=inactive]:hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-50";

// the active tab's count badge: the indicator's tone under an underline, a tint of the label on a filled pill or thumb
// (a tone-soft badge would vanish into the fill). css from the wrapper, so the badge itself never re-renders for it
const ON_FILL_BADGE =
  "[&_[data-slot=badge]]:text-current [&_[data-slot=badge]]:[--badge-fill:color-mix(in_oklab,currentColor_14%,transparent)]";
const ACTIVE_BADGE: Record<TabsVariant, string> = {
  // the tone vars resolve here, against the tabs root, before the badge's own neutral tone shadows them
  underline:
    "[--tabs-badge-fill:var(--tone-soft)] [--tabs-badge-text:var(--tone-soft-foreground)] [&_[data-slot=badge]]:text-(--tabs-badge-text) [&_[data-slot=badge]]:[--badge-fill:var(--tabs-badge-fill)]",
  pill: ON_FILL_BADGE,
  segmented: ON_FILL_BADGE,
};

// re-renders only when the number changes. a re-render replays a layout animation from wherever the badge was on the
// page, so switching tabs in a card that changes height with the new panel would send it flying
const CountBadge = memo(function CountBadge({ count }: { count: number }) {
  return <Badge size="sm" count={count} />;
});

const PANEL =
  "min-w-0 rounded-[12px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring";

// ---------------------------------------------------------------- content motion

// panels travel 16px the way you moved: the next tab comes in from the end, the previous one from the start
const SLIDE = 16;
const ENTER: Transition = {
  ...springs.smooth,
  opacity: { duration: durations.normal, ease: easings.out },
};
const EXIT: Transition = { duration: durations.fast, ease: easings.out };
const FADE_IN: Transition = { duration: durations.fast, ease: "linear" };

function slide(axis: "x" | "y", distance: number, opacity: number) {
  return axis === "x" ? { x: distance, opacity } : { y: distance, opacity };
}

function panelVariants(axis: "x" | "y", flip: number, reduced: boolean): Variants {
  if (reduced) {
    return {
      enter: { opacity: 0 },
      center: { opacity: 1, transition: FADE_IN },
      exit: { opacity: 0, transition: FADE_IN },
      shown: { opacity: [0, 1], transition: FADE_IN },
      hidden: { opacity: 0, transition: { duration: 0 } },
    };
  }
  return {
    enter: (direction: number) => slide(axis, SLIDE * direction * flip, 0),
    center: { ...slide(axis, 0, 1), transition: ENTER },
    exit: (direction: number) => ({
      ...slide(axis, -SLIDE * direction * flip, 0),
      transition: EXIT,
    }),
    // kept-mounted panels never unmount, so they enter from keyframes instead of presence
    shown: (direction: number) =>
      axis === "x"
        ? {
            x: [SLIDE * direction * flip, 0],
            opacity: [0, 1],
            transition: ENTER,
          }
        : {
            y: [SLIDE * direction * flip, 0],
            opacity: [0, 1],
            transition: ENTER,
          },
    hidden: { opacity: 0, transition: { duration: 0 } },
  };
}

// ---------------------------------------------------------------- context

type TabsContextValue = {
  value: string;
  variant: TabsVariant;
  size: TabsSize;
  radius: TabsRadius;
  tone: Tone;
  color?: string;
  neutral: boolean;
  mode: Mode;
  // responsive vertical tabs narrower than 32rem (known after mount): the list is a scrolling row
  narrow: boolean;
  setNarrow: (narrow: boolean) => void;
  fullWidth: boolean;
  scrollable: boolean;
  animate: boolean;
  keepMounted: boolean;
  reduced: boolean;
  direction: number;
  moving: boolean;
  variants: Variants;
  classNames?: Partial<Record<TabsSlot, string>>;
  settle: () => void;
  registerOrder: (values: string[]) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

// the indicator's offset from its resting box, shared by every trigger of one list, plus the box the last
// indicator rested in. a new indicator starts where the old one is on screen (mid-flight included) and springs home
type Box = { x: number; y: number; w: number; h: number };
type IndicatorMotion = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  scaleX: MotionValue<number>;
  scaleY: MotionValue<number>;
  // stores the box an indicator rests in and returns the one stored before
  rest: (box: Box) => Box | null;
};

const IndicatorContext = createContext<IndicatorMotion | null>(null);

function useTabs(part: string) {
  const context = use(TabsContext);
  if (!context) throw new Error(`${part} must be used inside <TabsRoot> or <Tabs>`);
  return context;
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

// ---------------------------------------------------------------- root

const VARIANT_KEYS: TabsVariant[] = ["underline", "pill", "segmented"];

export type TabsRootProps = Omit<
  ComponentProps<typeof TabsPrimitive.Root>,
  "color" | "orientation" | "activationMode" | "value" | "defaultValue" | "onValueChange"
> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  // underline for page sections, pill for filters, segmented for a compact switch
  variant?: TabsVariant;
  // 32 / 40 / 48px triggers (44px md on touch)
  size?: TabsSize;
  // the indicator color: neutral (black / white), brand, success, warning, danger or info
  tone?: Tone;
  // any css color; replaces the tone
  color?: string;
  // pill and segmented shapes; scales with the size
  radius?: TabsRadius;
  orientation?: TabsOrientation;
  // vertical only: narrower than 32rem, the list becomes a horizontal scrolling row above the content
  responsive?: boolean;
  // triggers share the width equally
  fullWidth?: boolean;
  // a horizontal list that overflows scrolls with edge fades and keeps the active tab in view; off, it wraps
  scrollable?: boolean;
  // panels slide in the direction of travel
  animateContent?: boolean;
  // manual: arrow keys move focus, Enter or Space activates
  activationMode?: TabsActivationMode;
  // keep inactive panels mounted (hidden), so form state survives a switch
  keepMounted?: boolean;
  classNames?: Partial<Record<TabsSlot, string>>;
};

export function TabsRoot(tabsRootProps: TabsRootProps) {
  const {
    value: valueProp,
    defaultValue = "",
    onValueChange,
    variant = "underline",
    size = "md",
    tone = "neutral",
    color,
    radius = "md",
    orientation = "horizontal",
    responsive = true,
    fullWidth = false,
    scrollable = true,
    animateContent = true,
    activationMode = "automatic",
    keepMounted = false,
    dir,
    classNames,
    className,
    style,
    children,
    ...props
  } = useDefaults("tabs", tabsRootProps);
  const reduced = usePrefersReducedMotion();
  const [narrow, setNarrow] = useState(false);
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue,
    onChange: onValueChange,
  });

  const shape = VARIANT_KEYS.includes(variant) ? variant : "underline";
  const scale = SIZES[size] ? size : "md";
  const corner = RADII[radius] ? radius : "md";
  const vertical = orientation === "vertical";
  const mode: Mode = vertical ? (responsive ? "responsive" : "vertical") : "horizontal";
  // the layout switches in css, so nothing jumps after hydration; arrow keys and the slide axis follow once measured
  const effective: TabsOrientation = mode === "responsive" && narrow ? "horizontal" : orientation;
  const axis = effective === "vertical" ? "y" : "x";
  const flip = axis === "x" && dir === "rtl" ? -1 : 1;
  const animate = animateContent;

  // the triggers' order, published by the list, tells which way a change went
  const [order, setOrder] = useState<string[]>([]);
  const registerOrder = useCallback((next: string[]) => setOrder((prev) => (sameList(prev, next) ? prev : next)), []);

  const [seen, setSeen] = useState(value);
  const [direction, setDirection] = useState(1);
  const [moving, setMoving] = useState(false);
  if (seen !== value) {
    setSeen(value);
    const from = order.indexOf(seen);
    const to = order.indexOf(value);
    if (from !== -1 && to !== -1) setDirection(to > from ? 1 : -1);
    if (animate && !reduced) setMoving(true);
  }
  const settle = useCallback(() => setMoving(false), []);

  const variants = useMemo(() => panelVariants(axis, flip, reduced), [axis, flip, reduced]);
  const neutral = !color && (tone === "neutral" || !toneClasses[tone]);

  const context = useMemo<TabsContextValue>(
    () => ({
      value,
      variant: shape,
      size: scale,
      radius: corner,
      tone,
      color,
      neutral,
      mode,
      narrow,
      setNarrow,
      fullWidth,
      scrollable,
      animate,
      keepMounted,
      reduced,
      direction,
      moving,
      variants,
      classNames,
      settle,
      registerOrder,
    }),
    [
      value,
      shape,
      scale,
      corner,
      tone,
      color,
      neutral,
      mode,
      narrow,
      fullWidth,
      scrollable,
      animate,
      keepMounted,
      reduced,
      direction,
      moving,
      variants,
      classNames,
      settle,
      registerOrder,
    ],
  );

  return (
    <TabsContext value={context}>
      <TabsPrimitive.Root
        value={value}
        onValueChange={setValue}
        orientation={effective}
        activationMode={activationMode === "manual" ? "manual" : "automatic"}
        dir={dir}
        data-slot="tabs"
        data-variant={shape}
        data-size={scale}
        data-tone={color ? "custom" : tone}
        className={cn(
          "relative flex min-w-0",
          toneClasses[tone] ?? toneClasses.neutral,
          ROOT_GAPS[scale],
          ROOT[mode],
          className,
        )}
        style={{ ...colorVars(color), ...style }}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    </TabsContext>
  );
}

// ---------------------------------------------------------------- list

export type TabsListProps = Omit<
  ComponentProps<"div">,
  // motion.div owns these names with its own signatures
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  // arrow keys wrap from the last tab to the first
  loop?: boolean;
};

export function TabsList({ loop = true, className, style, children, ref, ...props }: TabsListProps) {
  const {
    value,
    variant,
    size,
    radius,
    mode,
    narrow,
    setNarrow,
    fullWidth,
    scrollable,
    reduced,
    classNames,
    registerOrder,
  } = useTabs("TabsList");
  const scrolls = scrollable && mode !== "vertical";
  // the edge fade is a mask, which would also hide focus rings, so the responsive list only wears it as a row
  const faded = scrolls && (mode === "horizontal" || narrow);
  const { ref: edgesRef } = useScrollEdges<HTMLDivElement>({
    fade: 32,
    disabled: !scrolls,
  });
  const list = useRef<HTMLDivElement | null>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scaleX = useMotionValue(1);
  const scaleY = useMotionValue(1);
  const last = useRef<Box | null>(null);
  const indicator = useMemo<IndicatorMotion>(
    () => ({
      x,
      y,
      scaleX,
      scaleY,
      rest: (box) => {
        const prev = last.current;
        last.current = box;
        return prev;
      },
    }),
    [x, y, scaleX, scaleY],
  );

  const setList = useCallback(
    (el: HTMLDivElement | null) => {
      list.current = el;
      const cleanup = edgesRef(el);
      return () => {
        list.current = null;
        cleanup?.();
      };
    },
    [edgesRef],
  );

  // responsive vertical tabs: tell the root when it crosses the container query, for the arrow keys and slide axis
  useEffect(() => {
    const root = list.current?.closest<HTMLElement>('[data-slot="tabs"]');
    if (mode !== "responsive" || !root) return;
    const observer = new ResizeObserver(([entry]) => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(entry.contentRect.width < NARROW_REM * rem);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [mode, setNarrow]);

  // publish the triggers' order after every render, so the root knows which way a change went
  useLayoutEffect(() => {
    registerOrder(ownTriggers(list.current).map((el) => el.dataset.value ?? ""));
  });

  // keep the active tab in view with a peek of its neighbour. scrolls the list only: scrollIntoView would move the page
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = list.current;
    const first = !mounted.current;
    mounted.current = true;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    const tab = ownTriggers(el).find((node) => node.dataset.state === "active");
    if (!tab) return;
    const bounds = el.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const peek = Math.min(48, bounds.width / 4);
    let delta = 0;
    if (rect.left < bounds.left + peek) delta = rect.left - bounds.left - peek;
    else if (rect.right > bounds.right - peek) delta = rect.right - bounds.right + peek;
    if (Math.abs(delta) < 1) return;
    el.scrollBy({
      left: delta,
      behavior: first || reduced ? "instant" : "smooth",
    });
  }, [value, reduced]);

  return (
    <IndicatorContext value={indicator}>
      <TabsPrimitive.List asChild loop={loop} ref={ref}>
        <motion.div
          ref={setList}
          // count badges animate their width with layout, measured through the list's own scroll
          layoutScroll
          data-slot="tabs-list"
          data-variant={variant}
          className={cn(
            "relative flex min-w-0 outline-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            LIST[mode].base,
            scrollable && LIST[mode].scroll,
            classNames?.list,
            className,
          )}
          style={faded ? { ...fadeMaskStyle("x"), ...style } : style}
          {...props}
        >
          <div
            data-slot="tabs-list-track"
            className={cn(
              "relative flex",
              TRACK_VARIANTS[variant][mode],
              variant === "segmented" && RADII[radius][size],
              trackWidth(mode, variant, fullWidth, scrollable),
            )}
          >
            {children}
          </div>
        </motion.div>
      </TabsPrimitive.List>
    </IndicatorContext>
  );
}

// the triggers of this list only, never those of a nested tab set
function ownTriggers(list: HTMLElement | null) {
  if (!list) return [];
  return Array.from(list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]')).filter(
    (el) => el.closest('[data-slot="tabs-list"]') === list,
  );
}

// ---------------------------------------------------------------- trigger

export type TabsTriggerProps = Omit<
  ComponentProps<"button">,
  // motion.button owns these names with its own signatures
  "value" | "color" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  value: string;
  icon?: ReactNode;
  // a number renders a small count badge (hidden at 0), any other node renders as is
  badge?: ReactNode | number;
  disabled?: boolean;
};

export function TabsTrigger({ value, icon, badge, disabled = false, className, children, ...props }: TabsTriggerProps) {
  const tabs = useTabs("TabsTrigger");
  const { variant, size, radius, mode, neutral, fullWidth, scrollable, reduced, classNames } = tabs;
  const active = tabs.value === value;
  const segmented = variant === "segmented";
  const hasBadge = badge != null && badge !== false && badge !== "";

  return (
    <TabsPrimitive.Trigger value={value} disabled={disabled} asChild>
      <motion.button
        type="button"
        data-slot="tabs-trigger"
        data-value={value}
        whileTap={disabled || reduced ? undefined : press.whileTap}
        transition={press.transition}
        className={cn(
          TRIGGER_BASE,
          segmented ? SEGMENTED_SIZES[size] : SIZES[size],
          PADDING[variant][size],
          ICON_SIZES[size],
          segmented ? INNER_RADII[radius][size] : RADII[radius][size],
          LAYER_INSETS[variant][mode] && [STATE_LAYER, LAYER_INSETS[variant][mode]],
          activeText(variant, neutral),
          TRIGGER_LAYOUT[mode].base,
          fullWidth && TRIGGER_LAYOUT[mode].full,
          scrollable && LIST[mode].ring,
          classNames?.trigger,
          className,
        )}
        {...props}
      >
        {/* first in the trigger: the positioned icon, label and badge after it paint above it, no z-index needed */}
        {active && (
          <TabsIndicator
            radius={variant === "underline" ? 9999 : Math.max(0, RADIUS_PX[radius][size] - (segmented ? 2 : 0))}
            className={cn(INDICATOR_POSITIONS[variant][mode], indicatorLook(variant, neutral), classNames?.indicator)}
          />
        )}
        {icon && (
          <span
            data-slot="tabs-trigger-icon"
            aria-hidden
            className={cn("relative inline-flex shrink-0", classNames?.icon)}
          >
            {icon}
          </span>
        )}
        {children != null && children !== false && (
          <span data-slot="tabs-trigger-label" className={cn("relative", LABEL_LAYOUT[mode], classNames?.label)}>
            {children}
          </span>
        )}
        {hasBadge &&
          (typeof badge === "number" ? (
            // a count badge animates its width with layout. when a new count lands while the list moves on the page,
            // it measures against this wrapper, which snaps to its new place (layoutRoot). empty once it scaled away at 0
            <motion.span
              layout
              layoutRoot
              data-slot="tabs-trigger-badge"
              className={cn("relative inline-flex shrink-0 empty:hidden", active && ACTIVE_BADGE[variant], classNames?.badge)}
            >
              <CountBadge count={badge} />
            </motion.span>
          ) : (
            <span data-slot="tabs-trigger-badge" className={cn("relative inline-flex shrink-0", classNames?.badge)}>
              {badge}
            </span>
          ))}
      </motion.button>
    </TabsPrimitive.Trigger>
  );
}

// the box of an indicator inside the track, from layout offsets: transforms (the press dip, a running slide) do not
// count, and neither does anything that moves the list on the page or scrolls it
function measure(el: HTMLElement): Box {
  const trigger = el.offsetParent as HTMLElement | null;
  return {
    x: el.offsetLeft + (trigger?.offsetLeft ?? 0),
    y: el.offsetTop + (trigger?.offsetTop ?? 0),
    w: el.offsetWidth,
    h: el.offsetHeight,
  };
}

// the sliding underline, pill or thumb. it lives in the active trigger, so css sizes it; when it moves to another
// trigger it starts from the old one's box as a transform and springs to rest (flip), which keeps it on the
// compositor. the corners are counter-scaled every frame so they never stretch
function TabsIndicator({ radius, className }: { radius: number; className?: string }) {
  const { reduced } = useTabs("TabsTrigger");
  const motionValues = use(IndicatorContext);
  const ref = useRef<HTMLSpanElement>(null);
  const fallbackX = useMotionValue(0);
  const fallbackY = useMotionValue(0);
  const fallbackScaleX = useMotionValue(1);
  const fallbackScaleY = useMotionValue(1);
  const x = motionValues?.x ?? fallbackX;
  const y = motionValues?.y ?? fallbackY;
  const scaleX = motionValues?.scaleX ?? fallbackScaleX;
  const scaleY = motionValues?.scaleY ?? fallbackScaleY;
  const borderRadius = useTransform([scaleX, scaleY], ([sx, sy]: number[]) =>
    radius ? `${radius / (sx || 1)}px / ${radius / (sy || 1)}px` : "0px",
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !motionValues) return;
    const next = measure(el);
    const prev = motionValues.rest(next);
    const values = [motionValues.x, motionValues.y, motionValues.scaleX, motionValues.scaleY];
    if (!prev || reduced || !next.w || !next.h || !prev.w || !prev.h) {
      values.forEach((value, i) => value.jump(i < 2 ? 0 : 1));
    } else {
      // where the old indicator is on screen right now, a running slide included, keeping its speed
      const sx = motionValues.scaleX.get();
      const sy = motionValues.scaleY.get();
      const from = [
        prev.x + motionValues.x.get() - next.x,
        prev.y + motionValues.y.get() - next.y,
        (prev.w * sx) / next.w,
        (prev.h * sy) / next.h,
      ];
      const speed = [
        motionValues.x.getVelocity(),
        motionValues.y.getVelocity(),
        (motionValues.scaleX.getVelocity() * prev.w) / next.w,
        (motionValues.scaleY.getVelocity() * prev.h) / next.h,
      ];
      values.forEach((value, i) => {
        value.jump(from[i]);
        animateValue(value, i < 2 ? 0 : 1, {
          ...springs.smooth,
          velocity: speed[i],
        });
      });
    }
    // remember where this one rests when it leaves, so the next one starts from the latest layout
    return () => {
      if (el.isConnected) motionValues.rest(measure(el));
    };
  }, [motionValues, reduced]);

  return (
    <motion.span
      ref={ref}
      data-slot="tabs-indicator"
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{ x, y, scaleX, scaleY, originX: 0, originY: 0, borderRadius }}
    />
  );
}

// ---------------------------------------------------------------- content

export type TabsContentProps = Omit<ComponentProps<typeof TabsPrimitive.Content>, "forceMount">;

export function TabsContent({ value, className, children, ...props }: TabsContentProps) {
  const tabs = useTabs("TabsContent");
  const active = tabs.value === value;

  const panel = (
    <TabsPrimitive.Content
      value={value}
      forceMount
      data-slot="tabs-content"
      className={cn(PANEL, tabs.classNames?.content, className)}
      {...props}
    >
      {children}
    </TabsPrimitive.Content>
  );

  if (tabs.keepMounted) return <KeptPanel active={active}>{panel}</KeptPanel>;
  if (!tabs.animate) return active ? panel : null;
  return (
    // the leaving panel pops out of the flow and fades while the new one takes its place
    <AnimatePresence mode="popLayout" initial={false} custom={tabs.direction}>
      {active && <PanelMotion key={value}>{panel}</PanelMotion>}
    </AnimatePresence>
  );
}

function PanelMotion({ ref, children }: { ref?: Ref<HTMLDivElement>; children: ReactNode }) {
  const { direction, variants, mode, settle } = useTabs("TabsContent");
  const present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      data-slot="tabs-content-motion"
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      onAnimationComplete={(definition) => {
        if (definition === "center") settle();
      }}
      // a leaving panel is gone for clicks, focus and screen readers
      inert={!present || undefined}
      className={cn("min-w-0", PANELS_LAYOUT[mode])}
    >
      {children}
    </motion.div>
  );
}

function KeptPanel({ active, children }: { active: boolean; children: ReactNode }) {
  const { direction, variants, mode, animate, settle } = useTabs("TabsContent");
  if (!animate) {
    return (
      <div data-slot="tabs-content-motion" hidden={!active} className={cn("min-w-0", PANELS_LAYOUT[mode])}>
        {children}
      </div>
    );
  }
  return (
    <motion.div
      data-slot="tabs-content-motion"
      hidden={!active}
      custom={direction}
      variants={variants}
      initial={false}
      animate={active ? "shown" : "hidden"}
      onAnimationComplete={(definition) => {
        if (definition === "shown") settle();
      }}
      className={cn("min-w-0", PANELS_LAYOUT[mode])}
    >
      {children}
    </motion.div>
  );
}

// wraps the panels of the simple Tabs: the leaving panel is positioned against it, and it clips while panels slide
// so a full-bleed panel never pushes the page sideways
function TabsPanels({ active, children }: { active: boolean; children: ReactNode }) {
  const { mode, moving, settle } = useTabs("Tabs");
  // a tab without a panel never finishes a slide, so nothing would lift the clip
  useEffect(() => {
    if (moving && !active) settle();
  }, [moving, active, settle]);
  return (
    <div
      data-slot="tabs-panels"
      data-moving={moving || undefined}
      className={cn("relative min-w-0 data-moving:overflow-clip", PANELS_LAYOUT[mode])}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- simple api

const NO_OPTIONS: TabsOption[] = [];

export type TabsProps = Omit<TabsRootProps, "children"> & {
  options?: TabsOption[];
  // names the tab list for screen readers when nothing visible does
  "aria-label"?: string;
};

export function Tabs(tabsProps: TabsProps) {
  const {
    options,
    value: valueProp,
    defaultValue,
    onValueChange,
    variant = "underline",
    size = "md",
    tone = "neutral",
    color,
    radius = "md",
    orientation = "horizontal",
    responsive = true,
    fullWidth = false,
    scrollable = true,
    animateContent = true,
    activationMode = "automatic",
    keepMounted = false,
    "aria-label": ariaLabel,
    // the list is the tablist, so a label or a heading id belongs on it, not on the root
    "aria-labelledby": ariaLabelledBy,
    ...props
  } = useDefaults("tabs", tabsProps);
  const items = options ?? NO_OPTIONS;
  const first = items.find((option) => !option.disabled)?.value;
  const [value, setValue] = useControllableState({
    value: valueProp,
    defaultValue: defaultValue ?? first ?? "",
    onChange: onValueChange,
  });

  const keys = JSON.stringify(items.map((option) => option.value));
  const known = items.some((option) => option.value === value);
  // uncontrolled: an unknown value (options that arrived late) falls back to the first enabled tab
  const current = known || valueProp !== undefined ? value : (first ?? "");

  // a tab removed while active: move to the first enabled one, and tell a controlled parent
  const lastKeys = useRef(keys);
  useEffect(() => {
    const before = JSON.parse(lastKeys.current) as string[];
    lastKeys.current = keys;
    const now = JSON.parse(keys) as string[];
    if (first !== undefined && before.includes(value) && !now.includes(value)) setValue(first);
  }, [keys, value, first, setValue]);

  if (first === undefined) return null;
  const panels = items.some((option) => option.content != null);
  const activePanel = items.some((option) => option.value === current && option.content != null);

  return (
    <TabsRoot
      value={current}
      onValueChange={setValue}
      variant={variant}
      size={size}
      tone={tone}
      color={color}
      radius={radius}
      orientation={orientation}
      responsive={responsive}
      fullWidth={fullWidth}
      scrollable={scrollable}
      animateContent={animateContent}
      activationMode={activationMode}
      keepMounted={keepMounted}
      {...props}
    >
      <TabsList aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {items.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            icon={option.icon}
            badge={option.badge}
            disabled={option.disabled}
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {panels && (
        <TabsPanels active={activePanel}>
          {items.map((option) =>
            option.content != null ? (
              <TabsContent key={option.value} value={option.value}>
                {option.content}
              </TabsContent>
            ) : null,
          )}
        </TabsPanels>
      )}
    </TabsRoot>
  );
}
