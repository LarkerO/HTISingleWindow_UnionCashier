"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import { useLayoutEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { motion } from "motion/react";
import { useMotionPreset } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useDefaults } from "@/lib/ui-config";

export type SkeletonShape = "rect" | "circle" | "line";
export type SkeletonRadius = "none" | "sm" | "md" | "lg" | "full";
export type SkeletonAnimation = "shimmer" | "pulse" | "none";
export type SkeletonSize = "sm" | "md" | "lg";

// shipped with the component (react 19 hoists the tag and dedupes it by href), so a copied file needs no global css
const KEYFRAMES = "@keyframes ui-skeleton-shimmer{from{transform:translateX(-100%)}to{transform:translateX(100%)}}";

// rect corners: 0 / 6 / 10 / 16px / pill
const RADII: Record<SkeletonRadius, string> = {
  none: "rounded-none",
  sm: "rounded-[6px]",
  md: "rounded-[10px]",
  lg: "rounded-2xl",
  full: "rounded-full",
};

// sizes without children: rect and line fill the row, a circle is 40px unless width says otherwise
const SHAPES: Record<SkeletonShape, string> = {
  rect: "w-full",
  circle: "aspect-square w-10 shrink-0",
  line: "h-3.5 w-full",
};

// seconds per cycle at speed 1
const CYCLE: Record<SkeletonAnimation, number> = {
  shimmer: 1.6,
  pulse: 2,
  none: 0,
};

// isolate keeps the rounded clip on the moving pseudo-element in safari
const BASE = "relative isolate overflow-hidden bg-foreground/5";

// a soft band sweeping across on a transformed pseudo-element (never background-position, which repaints every frame).
// the keyframes own transform, so no translate-* class here: tailwind's separate translate property would add to it
const SHIMMER =
  "after:pointer-events-none after:absolute after:inset-0 after:[transform:translateX(-100%)] after:bg-linear-to-r after:from-transparent after:to-transparent after:[animation:ui-skeleton-shimmer_var(--skeleton-duration,1.6s)_ease-in-out_infinite] motion-reduce:after:hidden";

const PULSE = "animate-pulse motion-reduce:animate-none";

// looks every block of a preset shares
type SkeletonLook = {
  // shimmer sweeps a highlight across, pulse fades the block in and out, none stays still
  animation?: SkeletonAnimation;
  // playback multiplier: 0.5 is half speed, 2 twice as fast
  speed?: number;
  // any css color for the block fill; defaults to the 5% foreground tint, which works on every surface
  color?: string;
  // any css color for the shimmer band; defaults to a 7% foreground tint
  highlight?: string;
};

// motion.div owns these names with its own signatures
type DivProps = Omit<ComponentProps<"div">, "color" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart">;

export type SkeletonProps = DivProps &
  SkeletonLook & {
    // rect: a block with radius. circle: a round avatar-sized block. line: a text line
    shape?: SkeletonShape;
    // px numbers or any css length; a circle takes its size from width (40px by default)
    width?: number | string;
    height?: number | string;
    // rect corners; circles and lines are always round
    radius?: SkeletonRadius;
    // false renders the children instead, fading them in
    loading?: boolean;
    // the real content: while loading it sits invisible and inert inside the block, so the block takes its exact size
    children?: ReactNode;
  };

function rateOf(speed: number) {
  return Number.isFinite(speed) && speed > 0 ? Math.min(Math.max(speed, 0.25), 4) : 1;
}

// a cms string never crashes a render, and "constructor" is not a shape
function pick<T extends string>(map: Record<T, unknown>, value: unknown, fallback: T): T {
  return typeof value === "string" && Object.hasOwn(map, value) ? (value as T) : fallback;
}

// numbers (and number-like strings such as "120") are px, anything else is a css length
function toLength(value: number | string | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? `${value}px` : undefined;
  const text = value?.trim();
  if (!text) return undefined;
  return /^\d+(\.\d+)?$/.test(text) ? `${text}px` : text;
}

function hasContent(children: ReactNode) {
  return children !== undefined && children !== null && children !== "" && typeof children !== "boolean";
}

// what a block looks like, resolved once by Skeleton
type Spec = {
  kind: SkeletonShape;
  look: SkeletonAnimation;
  width?: string;
  height?: string;
  radius: SkeletonRadius;
  speed: number;
  color?: string;
  highlight?: string;
};

// the placeholder itself: no hooks, so a preset with fifty blocks costs fifty divs and nothing else
function Block({
  spec,
  wraps = false,
  className,
  style,
  children,
  ...props
}: DivProps & { spec: Spec; wraps?: boolean }) {
  const { kind, look, width, height, radius, speed, color, highlight } = spec;
  const cycle = `${Math.round((CYCLE[look] / rateOf(speed)) * 1000)}ms`;
  return (
    <div
      data-slot="skeleton"
      data-shape={kind}
      data-animation={look}
      aria-hidden
      inert={wraps || undefined}
      className={cn(
        BASE,
        wraps ? "w-fit max-w-full" : SHAPES[kind],
        // a rect needs a height of its own; an aspect-* class sizes it instead
        !wraps && kind === "rect" && !/(^|[\s:])aspect-/.test(className ?? "") && "h-24",
        kind === "rect" ? RADII[pick<SkeletonRadius>(RADII, radius, "md")] : "rounded-full",
        // a line wrapping text keeps the text's box but draws a bar 70% as tall (the presets' 14px bar in a 20px
        // row), so a wrapped label and a preset line read the same
        wraps && kind === "line" && "[clip-path:inset(15%_0_round_9999px)]",
        look === "shimmer" && [SHIMMER, highlight ? "after:via-(--skeleton-highlight)" : "after:via-foreground/[0.07]"],
        look === "pulse" && PULSE,
        className,
      )}
      style={
        {
          width,
          height,
          backgroundColor: color || undefined,
          "--skeleton-duration": look === "shimmer" ? cycle : undefined,
          "--skeleton-highlight": highlight || undefined,
          animationDuration: look === "pulse" ? cycle : undefined,
          ...style,
        } as CSSProperties
      }
      {...props}
    >
      {look === "shimmer" && (
        <style href="ui-skeleton" precedence="ui-lab">
          {KEYFRAMES}
        </style>
      )}
      {children}
    </div>
  );
}

// a skeleton wrapping the real content: sizes itself to it while loading, then hands over with a fade
function Wrapped({
  spec,
  loading,
  className,
  style,
  children,
  ...props
}: DivProps & { spec: Spec; loading: boolean }) {
  const fade = useMotionPreset("fade");
  const sizer = useRef<HTMLDivElement>(null);
  // content that is already there on the first render (the server's included) shows as is; content that replaces a
  // skeleton fades in
  const [settled, setSettled] = useState(!loading);
  if (loading && settled) setSettled(false);

  // a borderRadius in style is the caller's call; react owns that property then
  const ownRadius = style?.borderRadius !== undefined;

  // a rect copies the corners of what it wraps (a button, a rounded photo), so the swap changes nothing. square
  // content keeps the radius prop instead of turning the placeholder into a hard-edged box
  useLayoutEffect(() => {
    const el = sizer.current;
    const block = el?.parentElement;
    if (!el || !block || ownRadius) return;
    const child = spec.kind === "rect" ? el.firstElementChild : null;
    const corners = child ? getComputedStyle(child).borderRadius : "";
    const next = /[1-9]/.test(corners) ? corners : "";
    if (block.style.borderRadius !== next) block.style.borderRadius = next;
  });

  if (!loading) {
    return (
      <motion.div
        data-slot="skeleton-content"
        initial={settled ? false : fade.initial}
        animate={fade.animate}
        transition={fade.transition}
        className={cn("w-fit max-w-full", className)}
        style={{ width: spec.width, height: spec.height, ...style }}
        {...props}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <Block spec={spec} wraps className={className} style={style} {...props}>
      {/* display: contents keeps the children's own layout; visibility hides them and inert keeps focus out */}
      <div ref={sizer} data-slot="skeleton-sizer" className="invisible contents">
        {children}
      </div>
    </Block>
  );
}

export function Skeleton(skeletonProps: SkeletonProps) {
  const {
    shape = "rect",
    width,
    height,
    radius = "md",
    animation = "shimmer",
    speed = 1,
    loading = true,
    color,
    highlight,
    children,
    ...props
  } = useDefaults("skeleton", skeletonProps);
  const kind = pick<SkeletonShape>(SHAPES, shape, "rect");
  // a circle is as tall as it is wide, so height stands in for a missing width
  const spec: Spec = {
    kind,
    look: pick<SkeletonAnimation>(CYCLE, animation, "shimmer"),
    width: toLength(kind === "circle" ? (width ?? height) : width),
    height: kind === "circle" ? undefined : toLength(height),
    radius,
    speed,
    color,
    highlight,
  };

  if (hasContent(children)) {
    return (
      <Wrapped spec={spec} loading={loading} {...props}>
        {children}
      </Wrapped>
    );
  }
  return loading ? <Block spec={spec} {...props} /> : null;
}

// ---------- text ----------

// bar heights match text-xs / text-sm / text-[15px]
const TEXT_SIZES: Record<SkeletonSize, { line: string; gap: string }> = {
  sm: { line: "h-2.5", gap: "gap-2" },
  md: { line: "h-3.5", gap: "gap-2.5" },
  lg: { line: "h-[18px]", gap: "gap-3" },
};

export type SkeletonTextProps = Omit<ComponentProps<"div">, "color"> &
  SkeletonLook & {
    lines?: number;
    // width of the last line (and of a single line), any css length
    lastLineWidth?: number | string;
    size?: SkeletonSize;
    classNames?: Partial<Record<"line", string>>;
  };

export function SkeletonText(skeletonTextProps: SkeletonTextProps) {
  const {
    lines = 3,
    lastLineWidth = "60%",
    size = "md",
    animation = "shimmer",
    speed = 1,
    color,
    highlight,
    classNames,
    className,
    ...props
  } = useDefaults("skeleton-text", skeletonTextProps);
  const count = countOf(lines);
  if (!count) return null;
  const sized = pick<SkeletonSize>(TEXT_SIZES, size, "md");
  const s = TEXT_SIZES[sized];
  const look = { animation, speed, color, highlight };
  return (
    <div
      data-slot="skeleton-text"
      data-size={sized}
      aria-hidden
      className={cn("flex w-full flex-col", s.gap, className)}
      {...props}
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          shape="line"
          className={cn(s.line, classNames?.line)}
          width={i === count - 1 ? lastLineWidth : undefined}
          {...look}
        />
      ))}
    </div>
  );
}

// ---------- presets ----------

// every preset root is relative: its sr-only label is absolutely positioned, and without a positioned ancestor it
// escapes a scrolling rail and widens the page
type PresetProps = Omit<ComponentProps<"div">, "color"> &
  SkeletonLook & {
    // read once by screen readers for the whole preset; the blocks themselves stay silent
    label?: string;
  };

function countOf(value: number, max = 50) {
  return Math.min(Math.max(Math.floor(Number(value) || 0), 0), max);
}

// a line centered in a row as tall as the text it stands in for, so swapping in the real text moves nothing
function Bar({ row, bar, width, look }: { row: string; bar: string; width?: number | string; look: SkeletonLook }) {
  return (
    <div data-slot="skeleton-line-row" className={cn("flex items-center", row)}>
      <Skeleton shape="line" className={bar} width={width} {...look} />
    </div>
  );
}

// fixed rhythms instead of random widths: the same on the server and the client, and still reads like real text
const CARD_WIDTHS = ["72%", "46%", "58%", "38%"];
const LIST_TITLES = ["42%", "56%", "36%", "50%", "46%"];
const LIST_SUBTITLES = ["64%", "48%", "70%", "54%", "60%"];
const CELL_WIDTHS = ["68%", "52%", "76%", "44%", "60%", "36%"];
const ROW_TITLES = ["56%", "70%", "50%", "64%", "60%"];
const ROW_VALUES = ["28%", "36%", "22%"];

export type SkeletonCardSlot = "media" | "body" | "footer";

export type SkeletonCardProps = PresetProps & {
  // a 16:10 block on top, for a photo
  media?: boolean;
  // aspect ratio of the media block, any css aspect-ratio: "1" for square thumbnails, "4/3", "16/9"
  mediaAspect?: string;
  // text lines under the media: a title, then shorter meta lines
  lines?: number;
  // a price line and a round action at the bottom
  footer?: boolean;
  // corners of the media block
  radius?: SkeletonRadius;
  classNames?: Partial<Record<SkeletonCardSlot, string>>;
};

export function SkeletonCard(skeletonCardProps: SkeletonCardProps) {
  const {
    media = true,
    mediaAspect = "16/10",
    lines = 2,
    footer = true,
    radius = "md",
    label = "Loading",
    animation = "shimmer",
    speed = 1,
    color,
    highlight,
    classNames,
    className,
    ...props
  } = useDefaults("skeleton-card", skeletonCardProps);
  const look = { animation, speed, color, highlight };
  const count = countOf(lines);
  return (
    <div
      data-slot="skeleton-card"
      role="status"
      aria-busy="true"
      className={cn("relative flex w-full min-w-0 flex-col gap-3", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {media && (
        <Skeleton
          radius={radius}
          className={cn("aspect-(--skeleton-aspect)", classNames?.media)}
          style={{ "--skeleton-aspect": mediaAspect || "16/10" } as CSSProperties}
          {...look}
        />
      )}
      {count > 0 && (
        <div data-slot="skeleton-card-body" className={cn("flex flex-col gap-1", classNames?.body)}>
          {Array.from({ length: count }, (_, i) =>
            i === 0 ? (
              <Bar key={i} row="h-5" bar="h-3.5" width={CARD_WIDTHS[0]} look={look} />
            ) : (
              <Bar key={i} row="h-[18px]" bar="h-3" width={CARD_WIDTHS[i % CARD_WIDTHS.length]} look={look} />
            ),
          )}
        </div>
      )}
      {footer && (
        <div
          data-slot="skeleton-card-footer"
          className={cn("flex h-8 items-center justify-between gap-3", classNames?.footer)}
        >
          <Skeleton shape="line" className="h-5 w-24" {...look} />
          <Skeleton shape="circle" className="size-8" {...look} />
        </div>
      )}
    </div>
  );
}

export type SkeletonListSlot = "row" | "avatar" | "action";

export type SkeletonListProps = PresetProps & {
  rows?: number;
  // a 40px circle leading each row
  avatar?: boolean;
  // a button-sized block trailing each row
  action?: boolean;
  // hairlines between rows
  dividers?: boolean;
  classNames?: Partial<Record<SkeletonListSlot, string>>;
};

export function SkeletonList(skeletonListProps: SkeletonListProps) {
  const {
    rows = 4,
    avatar = true,
    action = true,
    dividers = true,
    label = "Loading",
    animation = "shimmer",
    speed = 1,
    color,
    highlight,
    classNames,
    className,
    ...props
  } = useDefaults("skeleton-list", skeletonListProps);
  const look = { animation, speed, color, highlight };
  return (
    <div
      data-slot="skeleton-list"
      role="status"
      aria-busy="true"
      className={cn("relative flex w-full min-w-0 flex-col", dividers && "divide-y divide-foreground/10", className)}
      {...props}
    >
      {/* first, so divide-y never draws a line under the last row */}
      <span className="sr-only">{label}</span>
      {Array.from({ length: countOf(rows) }, (_, i) => (
        <div
          key={i}
          data-slot="skeleton-list-row"
          className={cn("flex min-h-14 items-center gap-3 px-4 py-2.5", classNames?.row)}
        >
          {/* classNames.avatar="rounded-[10px]" turns it into a square thumbnail */}
          {avatar && <Skeleton shape="circle" className={cn("size-10", classNames?.avatar)} {...look} />}
          <div data-slot="skeleton-list-text" className="flex min-w-0 flex-1 flex-col gap-1">
            <Bar row="h-5" bar="h-3.5" width={LIST_TITLES[i % LIST_TITLES.length]} look={look} />
            <Bar row="h-[18px]" bar="h-3" width={LIST_SUBTITLES[i % LIST_SUBTITLES.length]} look={look} />
          </div>
          {action && <Skeleton className={cn("h-8 w-16 shrink-0 rounded-[8px]", classNames?.action)} {...look} />}
        </div>
      ))}
    </div>
  );
}

export type SkeletonTableSlot = "header" | "row" | "card";

export type SkeletonTableProps = PresetProps & {
  rows?: number;
  columns?: number;
  // a header row (desktop only; the phone cards have none)
  header?: boolean;
  classNames?: Partial<Record<SkeletonTableSlot, string>>;
};

export function SkeletonTable(skeletonTableProps: SkeletonTableProps) {
  const {
    rows = 5,
    columns = 4,
    header = true,
    label = "Loading",
    animation = "shimmer",
    speed = 1,
    color,
    highlight,
    classNames,
    className,
    ...props
  } = useDefaults("skeleton-table", skeletonTableProps);
  const look = { animation, speed, color, highlight };
  const cols = Math.max(countOf(columns, 12), 1);
  const count = countOf(rows);
  // the first column holds the name, so it gets more room
  const grid = {
    gridTemplateColumns: cols > 1 ? `minmax(0,1.6fr) repeat(${cols - 1},minmax(0,1fr))` : "minmax(0,1fr)",
  };
  const pairs = Math.min(cols - 1, 2);
  const cells = (row: number, bar: string, widths: string[]) =>
    Array.from({ length: cols }, (_, c) => (
      <Skeleton
        key={c}
        shape="line"
        // numbers sit on the right, like a real table's last column
        className={cn(bar, cols > 1 && c === cols - 1 && "justify-self-end")}
        width={widths[(row + c) % widths.length]}
        {...look}
      />
    ));
  return (
    <div
      data-slot="skeleton-table"
      role="status"
      aria-busy="true"
      className={cn("relative w-full min-w-0", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {/* table from 768px up, cards below: css only, so the server markup is already right on a phone */}
      <div className="hidden md:block">
        {header && (
          <div
            data-slot="skeleton-table-header"
            style={grid}
            className={cn("grid h-11 items-center gap-4 border-b border-foreground/10 px-4", classNames?.header)}
          >
            {cells(0, "h-2.5", ["40%", "50%", "36%", "44%"])}
          </div>
        )}
        {Array.from({ length: count }, (_, r) => (
          <div
            key={r}
            data-slot="skeleton-table-row"
            style={grid}
            className={cn(
              "grid h-12 items-center gap-4 border-b border-foreground/10 px-4 last:border-b-0",
              classNames?.row,
            )}
          >
            {cells(r, "h-3", CELL_WIDTHS)}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 md:hidden">
        {Array.from({ length: count }, (_, r) => (
          <div
            key={r}
            data-slot="skeleton-table-card"
            className={cn("flex flex-col gap-3 rounded-2xl border border-foreground/10 p-4", classNames?.card)}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-5 min-w-0 flex-1 items-center">
                <Skeleton shape="line" className="h-3.5" width={ROW_TITLES[r % ROW_TITLES.length]} {...look} />
              </div>
              <Skeleton shape="line" className="h-5 w-14 shrink-0" {...look} />
            </div>
            {Array.from({ length: pairs }, (_, p) => (
              <div key={p} className="flex h-[18px] items-center justify-between gap-4">
                <Skeleton shape="line" className="h-2.5 w-16" {...look} />
                <Skeleton shape="line" className="h-3" width={ROW_VALUES[(r + p) % ROW_VALUES.length]} {...look} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export type SkeletonProfileSlot = "cover" | "avatar" | "stats";

export type SkeletonProfileProps = PresetProps & {
  // a banner the avatar overlaps
  cover?: boolean;
  // number of stat columns under the name; 0 hides the row
  stats?: number;
  // avatar diameter in px
  avatarSize?: number;
  // corners of the cover
  radius?: SkeletonRadius;
  classNames?: Partial<Record<SkeletonProfileSlot, string>>;
};

export function SkeletonProfile(skeletonProfileProps: SkeletonProfileProps) {
  const {
    cover = true,
    stats = 3,
    avatarSize = 80,
    radius = "md",
    label = "Loading",
    animation = "shimmer",
    speed = 1,
    color,
    highlight,
    classNames,
    className,
    style,
    ...props
  } = useDefaults("skeleton-profile", skeletonProfileProps);
  const look = { animation, speed, color, highlight };
  const columns = countOf(stats, 6);
  const size = Number.isFinite(avatarSize) && avatarSize > 0 ? avatarSize : 80;
  return (
    <div
      data-slot="skeleton-profile"
      role="status"
      aria-busy="true"
      className={cn("relative flex w-full min-w-0 flex-col items-center", className)}
      style={{ "--skeleton-avatar": `${size}px`, ...style } as CSSProperties}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {cover && (
        // a round cut-out with a 4px gap around the avatar: two translucent blocks never overlap into a darker patch,
        // and it works on any surface
        <Skeleton
          radius={radius}
          className={cn(
            "h-24 [mask-image:radial-gradient(circle_at_50%_100%,transparent_calc(var(--skeleton-avatar)/2+4px),#000_calc(var(--skeleton-avatar)/2+4.5px))]",
            classNames?.cover,
          )}
          {...look}
        />
      )}
      <Skeleton
        shape="circle"
        className={cn("size-(--skeleton-avatar)", cover && "-mt-[calc(var(--skeleton-avatar)/2)]", classNames?.avatar)}
        {...look}
      />
      <Bar row="mt-3 h-6" bar="h-4" width={144} look={look} />
      <Bar row="h-5" bar="h-3" width={196} look={look} />
      {columns > 0 && (
        <div
          data-slot="skeleton-profile-stats"
          style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
          className={cn("mt-4 grid w-full divide-x divide-foreground/10", classNames?.stats)}
        >
          {Array.from({ length: columns }, (_, i) => (
            <div key={i} data-slot="skeleton-profile-stat" className="flex flex-col items-center gap-0.5 py-1">
              <Bar row="h-6" bar="h-4" width={[36, 44, 32][i % 3]} look={look} />
              <Bar row="h-4" bar="h-2.5" width={[56, 48, 64][i % 3]} look={look} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
