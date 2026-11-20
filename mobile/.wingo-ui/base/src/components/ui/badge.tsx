"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls, type Transition, type Variants } from "motion/react";
import { X } from "lucide-react";
import { durations, easings, press, springs, usePrefersReducedMotion } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults, useUIConfig } from "@/lib/ui-config";

export type BadgeVariant = "solid" | "soft" | "outline";
export type BadgeSize = "sm" | "md" | "lg";
export type BadgeRadius = "none" | "sm" | "md" | "lg" | "full";
export type BadgePlacement = "top-end" | "top-start" | "bottom-end" | "bottom-start";
export type BadgeSlot = "dot" | "icon" | "label" | "count" | "remove";
export type { Tone as BadgeTone };

// 20 / 24 / 28px. the label keeps a real line height so accents (É, Å) never clip when it truncates
const SIZES: Record<BadgeSize, string> = {
  sm: "h-5 gap-1 px-1.5 text-[11px]/4",
  md: "h-6 gap-1 px-2 text-xs/4",
  lg: "h-7 gap-1.5 px-2.5 text-[13px]/[18px]",
};

// counts sit a little tighter and are never narrower than tall, so a single digit is a circle
const COUNT_SIZES: Record<BadgeSize, string> = {
  sm: "min-w-5 px-1",
  md: "min-w-6 px-1.5",
  lg: "min-w-7 px-2",
};

// a badge with nothing inside is a status dot (online, unread)
const EMPTY_SIZES: Record<BadgeSize, string> = {
  sm: "size-2",
  md: "size-2.5",
  lg: "size-3",
};

// svgs without their own size- class follow the badge: 12 / 12 / 14px
const ICON_SIZES: Record<BadgeSize, string> = {
  sm: "[&_svg:not([class*='size-'])]:size-3",
  md: "[&_svg:not([class*='size-'])]:size-3",
  lg: "[&_svg:not([class*='size-'])]:size-3.5",
};

const DOT_SIZES: Record<BadgeSize, string> = {
  sm: "size-1.5",
  md: "size-1.5",
  lg: "size-2",
};

// badges are pills by default; the square steps are for tag-like labels
const RADII: Record<BadgeRadius, string> = {
  none: "rounded-none",
  sm: "rounded-[4px]",
  md: "rounded-[6px]",
  lg: "rounded-[8px]",
  full: "rounded-full",
};

// the same radii in px: a count badge animates its width with layout, and motion only corrects the corners of a
// radius it can read from style
const RADIUS_PX: Record<BadgeRadius, number> = { none: 0, sm: 4, md: 6, lg: 8, full: 9999 };

// the fill goes through --badge-fill instead of a bg class, so BadgeAnchor can lay it over its ring color and a
// translucent soft or outline badge never shows the icon underneath through it
const VARIANTS: Record<BadgeVariant, string> = {
  solid: "[--badge-fill:var(--tone)] text-(--tone-foreground)",
  soft: "[--badge-fill:var(--tone-soft)] text-(--tone-soft-foreground)",
  outline: "[--badge-fill:transparent] border border-(--tone-border) text-(--tone-soft-foreground)",
};

const BASE =
  "relative inline-flex max-w-full shrink-0 items-center justify-center whitespace-nowrap bg-(--badge-fill) font-medium outline-hidden transition-[color,background-color,border-color,opacity] duration-fast ease-smooth focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-50";

// asChild badges are links or buttons: the button's state layer, touch hygiene and cursor
const INTERACTIVE =
  "cursor-pointer touch-manipulation select-none [-webkit-tap-highlight-color:transparent] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity before:duration-fast before:ease-smooth hover:before:opacity-[0.08] active:before:opacity-[0.12]";

// ...and a 44px tall hit area on touch without changing the look, like the button's sm size
const HIT_AREAS: Record<BadgeSize, string> = {
  sm: "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-3",
  md: "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2.5",
  lg: "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-2",
};

// 16px circle, -me-1 so the chip stays optically balanced, a 36px hit area on touch (as big as fits between
// wrapped chips without stealing their taps), a 1px focus offset so the ring stays inside a 24px chip
const REMOVE =
  "relative -me-1 inline-flex size-4 shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center rounded-full outline-hidden [-webkit-tap-highlight-color:transparent] transition-colors duration-fast ease-smooth hover:bg-current/15 active:bg-current/25 focus-visible:bg-current/15 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5";

const EXIT: Transition = { duration: durations.fast, ease: easings.out };
const LAYOUT: Transition = { layout: springs.smooth };

// the old number leaves the way the count moves: up when it grows, down when it shrinks
const SLIDE: Variants = {
  enter: (direction: number) => ({ y: direction > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { y: "0%", opacity: 1 },
  exit: (direction: number) => ({ y: direction > 0 ? "-100%" : "100%", opacity: 0 }),
};
const FADE: Variants = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } };
const DIGIT: Transition = { ...springs.snappy, opacity: { duration: durations.fast, ease: easings.out } };
const DIGIT_REDUCED: Transition = { duration: durations.fast, ease: "linear" };

// an upward kick on the bouncy spring peaks at ~1.12 and settles back at 1
const BUMP_PEAK = 0.12;
const BUMP_VELOCITY = 4.2;

const formatters = new Map<string, Intl.NumberFormat>();

function formatCount(value: number, locale: string | undefined) {
  const key = locale ?? "";
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.NumberFormat(locale || undefined);
    } catch {
      // an unknown locale tag falls back to the user's
      formatter = new Intl.NumberFormat();
    }
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

// negative counts clamp to 0, fractions round
function toCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

type PartProps = Omit<ComponentProps<"span">, "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"> & {
  animated: boolean;
};

// inner parts of a count badge join its layout animation, so the width change never stretches them
function Part({ animated, ...props }: PartProps) {
  if (animated) return <motion.span layout="position" transition={LAYOUT} {...props} />;
  return <span {...props} />;
}

export type BadgeProps = Omit<
  ComponentProps<"span">,
  // motion.span owns these names with its own signatures
  "color" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  // soft for status, solid for counts and the loudest labels, outline for filters and quiet tags
  variant?: BadgeVariant;
  // semantic color: neutral (black / white), brand, success, warning, danger or info
  tone?: Tone;
  // 20 / 24 / 28px tall
  size?: BadgeSize;
  radius?: BadgeRadius;
  // any css color; replaces the tone, text on a solid fill picks black or white
  color?: string;
  // a leading status dot in the tone
  dot?: boolean;
  // the dot pings (live, recording, online); implies dot
  pulse?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  // renders this number instead of children and animates every change
  count?: number;
  // counts above it read "99+"
  max?: number;
  // a count of 0 hides the badge unless this is set
  showZero?: boolean;
  // formats the count (1,250 in en-US)
  locale?: string;
  // shows the remove (x) button; Backspace and Delete on it remove too
  onRemove?: () => void;
  // aria-label of the remove button
  removeLabel?: string;
  // dims the badge and hides the remove button
  disabled?: boolean;
  // renders the single child (an <a>, a button) as the badge, with the state layer and press
  asChild?: boolean;
  // extra classes for inner parts
  classNames?: Partial<Record<BadgeSlot, string>>;
};

// motion.create keeps the press spring when asChild hands rendering to the child element
const MotionSlot = motion.create(Slot);

export function Badge(badgeProps: BadgeProps) {
  const {
    variant = "soft",
    tone = "neutral",
    size = "md",
    radius = "full",
    color,
    dot = false,
    pulse = false,
    leftIcon,
    rightIcon,
    count,
    max = 99,
    showZero = false,
    locale: localeProp,
    onRemove,
    removeLabel = "Remove",
    disabled = false,
    asChild = false,
    classNames,
    className,
    style,
    onClick,
    children,
    ...props
  } = useDefaults("badge", badgeProps);
  const uiLocale = useUIConfig().locale;
  const locale = localeProp ?? uiLocale;
  const reduced = usePrefersReducedMotion();
  const scale = SIZES[size] ? size : "md";
  const shape = RADII[radius] ? radius : "full";
  const counting = typeof count === "number";
  const value = counting ? toCount(count) : 0;
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 99;
  const text = value > limit ? `${formatCount(limit, locale)}+` : formatCount(value, locale);
  const hidden = counting && value === 0 && !showZero;
  // a control inside a link or button is invalid, so asChild badges are never removable
  const removable = Boolean(onRemove) && !disabled && !asChild;
  const hasLabel = children != null && children !== false && children !== "";
  const empty = !counting && !hasLabel && !leftIcon && !rightIcon && !removable && !asChild;
  const showDot = (dot || pulse) && !empty;
  const animated = counting && !reduced;

  // which way the last change went, for the slide
  const [seen, setSeen] = useState(value);
  const [direction, setDirection] = useState(1);
  if (seen !== value) {
    setSeen(value);
    setDirection(value > seen ? 1 : -1);
  }

  // a growing count bumps the badge. the kick shrinks while a bump is still up, so rapid taps never pile up
  const bump = useMotionValue(1);
  const previous = useRef(value);
  const bumping = useRef<AnimationPlaybackControls | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (!counting || reduced || value <= before) return;
    // back from 0 it pops in through the presence animation instead
    if (before === 0 && !showZero) return;
    const headroom = Math.max(0, 1 - (bump.get() - 1) / BUMP_PEAK);
    bumping.current = animate(bump, 1, { ...springs.bouncy, velocity: BUMP_VELOCITY * headroom });
  }, [value, counting, reduced, showZero, bump]);
  // an unmounting badge stops its spring instead of ticking a detached value
  useEffect(() => () => bumping.current?.stop(), []);

  const shared = {
    "data-slot": "badge",
    "data-variant": variant,
    "data-tone": color ? "custom" : tone,
    "data-size": size,
    "data-empty": empty || undefined,
    "data-disabled": disabled || undefined,
    className: cn(
      BASE,
      toneClasses[tone] ?? toneClasses.neutral,
      empty
        ? ["[--badge-fill:var(--tone)]", EMPTY_SIZES[scale]]
        : [VARIANTS[variant] ?? VARIANTS.soft, SIZES[scale], ICON_SIZES[scale]],
      // the root clips while a count animates its width, so the new number never spills past the pill. motion
      // owns its opacity (the pop and the disabled dim), so no css transition fights it
      counting && [COUNT_SIZES[scale], "overflow-hidden transition-[color,background-color,border-color]"],
      RADII[shape],
      asChild && [INTERACTIVE, HIT_AREAS[scale]],
      className,
    ),
  };

  // the ping copies the dot's fill; on an empty badge it reads the fill var, since an anchor paints the root's own
  // background with its ring color
  const ping = (fill: string) => (
    <span
      data-slot="badge-pulse"
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 animate-ping rounded-[inherit] motion-reduce:animate-none", fill)}
    />
  );

  const dotNode = showDot ? (
    <Part
      animated={animated}
      data-slot="badge-dot"
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        DOT_SIZES[scale],
        // on a solid fill the tone would vanish, so the dot takes the text color
        variant === "solid" ? "bg-current" : "bg-(--tone)",
        classNames?.dot,
      )}
    >
      {pulse && ping("bg-inherit")}
    </Part>
  ) : null;

  const icon = (node: ReactNode, side: "left" | "right") =>
    node ? (
      <Part animated={animated} data-slot="badge-icon" data-side={side} aria-hidden className={cn("inline-flex shrink-0", classNames?.icon)}>
        {node}
      </Part>
    ) : null;

  const label = (node: ReactNode) => (
    <span data-slot="badge-label" className={cn("min-w-0 truncate", classNames?.label)}>
      {node}
    </span>
  );

  // tabular figures only on the count: inter widens hyphens under tnum, which would space out "Winston-Salem"
  const countNode = (
    <Part
      animated={animated}
      data-slot="badge-count"
      lang={locale || undefined}
      className={cn("relative inline-flex items-center justify-center self-stretch tabular-nums", classNames?.count)}
    >
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.span
          key={text}
          custom={direction}
          variants={reduced ? FADE : SLIDE}
          initial="enter"
          animate="center"
          exit="exit"
          transition={reduced ? DIGIT_REDUCED : DIGIT}
          className="inline-block"
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </Part>
  );

  const removeNode = removable ? (
    <motion.button
      type="button"
      data-slot="badge-remove"
      aria-label={removeLabel}
      layout={animated ? "position" : undefined}
      whileTap={reduced ? undefined : { scale: 0.85 }}
      transition={{ ...press.transition, ...LAYOUT }}
      onClick={(event) => {
        // a chip inside a clickable row removes itself without opening the row
        event.stopPropagation();
        onRemove?.();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        event.preventDefault();
        onRemove?.();
      }}
      className={cn(REMOVE, classNames?.remove)}
    >
      <X aria-hidden className="size-3" strokeWidth={2.5} />
    </motion.button>
  ) : null;

  const rootStyle = { ...colorVars(color), ...style };

  // a plain label: no motion on the root, so a list of fifty badges stays as cheap as fifty spans
  if (!counting && !asChild) {
    return (
      <span {...shared} style={rootStyle} onClick={onClick} {...props}>
        {empty && pulse && ping("bg-(--badge-fill)")}
        {dotNode}
        {icon(leftIcon, "left")}
        {hasLabel && label(children)}
        {icon(rightIcon, "right")}
        {removeNode}
      </span>
    );
  }

  const Root = asChild ? MotionSlot : motion.span;
  // a disabled link can still be activated by a script or assistive tech
  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    if (asChild && disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const tap = asChild && !disabled && !reduced ? { ...press.whileTap, transition: press.transition } : undefined;

  const root = (
    <Root
      key="badge"
      {...shared}
      {...(asChild && { "aria-disabled": disabled || undefined, tabIndex: disabled ? -1 : undefined })}
      onClick={handleClick}
      layout={animated}
      initial={counting ? (reduced ? { opacity: 0 } : { opacity: 0, scale: 0 }) : undefined}
      // an inline opacity would override data-disabled:opacity-50, so a disabled count dims here
      animate={counting ? { opacity: disabled ? 0.5 : 1, scale: 1 } : undefined}
      exit={counting ? { opacity: 0, scale: reduced ? 1 : 0.8, transition: EXIT } : undefined}
      whileTap={tap}
      transition={
        // the press releases on the root transition: bouncy only where a count pops in
        !counting
          ? press.transition
          : reduced
            ? { duration: durations.fast, layout: { duration: 0 } }
            : { ...springs.bouncy, opacity: { duration: durations.fast, ease: easings.out }, ...LAYOUT }
      }
      style={counting ? { ...rootStyle, scale: bump, borderRadius: RADIUS_PX[shape] } : rootStyle}
      {...props}
    >
      {dotNode}
      {icon(leftIcon, "left")}
      {asChild ? (
        // the child element is the badge; its own content becomes the label (or the count)
        <Slottable child={children}>{(content) => (counting ? countNode : label(content))}</Slottable>
      ) : (
        countNode
      )}
      {icon(rightIcon, "right")}
      {removeNode}
    </Root>
  );

  if (!counting) return root;
  return <AnimatePresence initial={false}>{!hidden && root}</AnimatePresence>;
}

export type BadgeAnchorProps = ComponentProps<"span"> & {
  // the badge to place: a count, a dot (an empty Badge) or a short label
  badge?: ReactNode;
  placement?: BadgePlacement;
  // px; positive moves the badge inward, e.g. onto the edge of a round avatar
  offset?: number;
  // scales the badge out, and back in when it turns false again
  invisible?: boolean;
  // the 2px ring that cuts the badge out of what it sits on; pass var(--surface) on panels
  ringColor?: string;
  classNames?: Partial<Record<"badge", string>>;
};

// the badge centers on the corner; logical, so it flips in rtl
const PLACEMENTS: Record<BadgePlacement, string> = {
  "top-end": "translate-x-1/2 -translate-y-1/2 rtl:-translate-x-1/2",
  "top-start": "-translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2",
  "bottom-end": "translate-x-1/2 translate-y-1/2 rtl:-translate-x-1/2",
  "bottom-start": "-translate-x-1/2 translate-y-1/2 rtl:translate-x-1/2",
};

// the ring cuts the badge out of its host; a badge's own fill is laid over the ring color so translucent fills
// (soft neutral, outline, a custom color) stay solid on top of an icon. clicks go through to the host
const ANCHORED =
  "pointer-events-none absolute flex *:ring-2 *:ring-(--badge-ring) *:data-[slot=badge]:[background:linear-gradient(var(--badge-fill),var(--badge-fill)),var(--badge-ring)]";

export function BadgeAnchor(badgeAnchorProps: BadgeAnchorProps) {
  const {
    badge,
    placement = "top-end",
    offset = 0,
    invisible = false,
    ringColor = "var(--background)",
    classNames,
    className,
    style,
    children,
    ...props
  } = useDefaults("badge-anchor", badgeAnchorProps);
  const reduced = usePrefersReducedMotion();
  const where = PLACEMENTS[placement] ? placement : "top-end";
  const bottom = where.startsWith("bottom");
  const start = where.endsWith("start");
  const shown = !invisible && badge != null && badge !== false;
  const position: CSSProperties = {
    top: bottom ? undefined : offset,
    bottom: bottom ? offset : undefined,
    insetInlineStart: start ? offset : undefined,
    insetInlineEnd: start ? undefined : offset,
  };

  return (
    <span
      data-slot="badge-anchor"
      className={cn("relative inline-flex shrink-0", className)}
      style={{ "--badge-ring": ringColor, ...style } as CSSProperties}
      {...props}
    >
      {children}
      <AnimatePresence initial={false}>
        {shown && (
          <motion.span
            key="badge"
            data-slot="badge-anchor-badge"
            data-placement={where}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 0.8, transition: EXIT }}
            transition={reduced ? { duration: durations.fast } : { ...springs.bouncy, opacity: { duration: durations.fast } }}
            className={cn(ANCHORED, PLACEMENTS[where], classNames?.badge)}
            style={position}
          >
            {badge}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
