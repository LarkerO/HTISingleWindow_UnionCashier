"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import { useEffect, useState, type ComponentProps, type CSSProperties } from "react";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults } from "@/lib/ui-config";

export type SpinnerVariant = "ring" | "dots" | "bars" | "pulse" | "orbit" | "spokes";
export type SpinnerSize = "sm" | "md" | "lg";
export type SpinnerTone = Tone | "current";
export type SpinnerLabelPosition = "end" | "bottom";
export type SpinnerSlot = "indicator" | "label";

type Scale = "sm" | "md" | "lg";

// 16px for inline text and buttons, 24px for cards and panels, 40px for a whole page
const SIZES: Record<SpinnerSize, number> = { sm: 16, md: 24, lg: 40 };

// rendered ring stroke in px; numeric sizes grow it with the square root so a 64px ring is not a donut
const STROKES: Record<SpinnerSize, number> = { sm: 2, md: 2.5, lg: 3 };

// one loop per variant in seconds at speed 1
const DURATIONS: Record<SpinnerVariant, number> = { ring: 0.75, dots: 1, bars: 0.9, pulse: 1.2, orbit: 1.1, spokes: 0.8 };

const LABEL_SIZES: Record<Scale, string> = { sm: "text-[13px]", md: "text-sm", lg: "text-[15px]" };

const GAPS: Record<SpinnerLabelPosition, Record<Scale, string>> = {
  end: { sm: "gap-1.5", md: "gap-2", lg: "gap-3" },
  bottom: { sm: "gap-2", md: "gap-2.5", lg: "gap-3.5" },
};

// keyframes ship with the component (consumers only get the tokens, not the lab's css). react hoists and dedupes
// the tag by href, so a page with fifty spinners has one. reduced motion keeps them turning at half speed
const CSS = [
  "@keyframes ui-spinner-spin{to{transform:rotate(360deg)}}",
  "@keyframes ui-spinner-dots{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}",
  "@keyframes ui-spinner-bars{0%,100%{transform:scaleY(.35);opacity:.55}50%{transform:scaleY(1);opacity:1}}",
  "@keyframes ui-spinner-pulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(1);opacity:0}}",
  "@keyframes ui-spinner-fade{0%{opacity:1}100%{opacity:.15}}",
  "@keyframes ui-spinner-in{0%{opacity:0}}",
  ".ui-spinner{--ui-spinner-t:var(--spinner-duration,1s)}",
  "@media (prefers-reduced-motion:reduce){.ui-spinner{--ui-spinner-t:calc(var(--spinner-duration,1s)*2)}}",
  ".ui-spinner-spin{animation:ui-spinner-spin var(--ui-spinner-t) linear infinite}",
  ".ui-spinner-orbit{animation:ui-spinner-spin var(--ui-spinner-t) cubic-bezier(.45,.05,.55,.95) infinite}",
  ".ui-spinner-dot{animation:ui-spinner-dots var(--ui-spinner-t) ease-in-out infinite}",
  ".ui-spinner-bar{animation:ui-spinner-bars var(--ui-spinner-t) ease-in-out infinite}",
  ".ui-spinner-ping{animation:ui-spinner-pulse var(--ui-spinner-t) cubic-bezier(0,0,.2,1) infinite}",
  ".ui-spinner-spoke{animation:ui-spinner-fade var(--ui-spinner-t) linear infinite}",
  ".ui-spinner-in{animation:ui-spinner-in .2s cubic-bezier(.22,1,.36,1)}",
  // high contrast mode forces backgrounds to Canvas, which would erase the span-drawn styles
  "@media (forced-colors:active){.ui-spinner-fill{background-color:CanvasText}}",
  // after the animation rules so it wins at equal specificity
  ".ui-spinner-paused,.ui-spinner-paused *{animation-play-state:paused}",
].join("");

export type SpinnerProps = Omit<ComponentProps<"span">, "color" | "children"> & {
  // ring, dots, bars, pulse, orbit or spokes (the ios activity indicator)
  variant?: SpinnerVariant;
  // 16 / 24 / 40px, or any px number (12 at least)
  size?: SpinnerSize | number;
  // current follows the text color, so it works inside any colored parent; a tone paints with the design tokens
  tone?: SpinnerTone;
  // any css color; replaces the tone
  color?: string;
  // playback multiplier: 0.5 is half speed, 2 twice as fast (0.25 to 4)
  speed?: number;
  // the accessible name, read by screen readers; visible with showLabel
  label?: string;
  showLabel?: boolean;
  // end sits beside the indicator, bottom stacks it (page loaders)
  labelPosition?: SpinnerLabelPosition;
  // ring only: the faint full circle under the arc
  track?: boolean;
  // ms before anything renders, so a fast load never flashes a spinner
  delay?: number;
  // holds the current frame, e.g. while a pull-to-refresh is still being dragged
  paused?: boolean;
  classNames?: Partial<Record<SpinnerSlot, string>>;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// negative delays start every part mid-cycle, so the first frame (and a paused one) is already staggered
const phase = (fraction: number): CSSProperties => ({ animationDelay: `calc(var(--ui-spinner-t) * ${fraction.toFixed(4)})` });

type Drawing = {
  px: number;
  stroke: number;
  track: boolean;
  className: string;
  style: CSSProperties;
};

function Ring({ px, stroke, track, className, style }: Drawing) {
  // stroke in viewBox units, so the rendered width stays the same px at every size
  const width = (stroke * 24) / px;
  const r = 12 - width / 2;
  return (
    <svg
      data-slot="spinner-indicator"
      aria-hidden
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      className={cn("ui-spinner-spin shrink-0 overflow-visible", className)}
      style={style}
    >
      {track && <circle cx="12" cy="12" r={r} stroke="currentColor" strokeOpacity={0.2} strokeWidth={width} />}
      {/* a quarter of the circle; pathLength keeps the dash math independent of the radius */}
      <circle
        cx="12"
        cy="12"
        r={r}
        stroke="currentColor"
        strokeWidth={width}
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="25 75"
      />
    </svg>
  );
}

function Spokes({ px, className, style }: Drawing) {
  const count = px >= 40 ? 12 : 8;
  // size/12 wide, size/4 long, from the edge toward the center. html spans, not svg lines: opacity on an html
  // element runs on the compositor (svg children animate on the main thread), so the spokes keep turning while
  // the page is busy loading
  const width = px / 12;
  return (
    <span
      data-slot="spinner-indicator"
      aria-hidden
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: px, height: px, ...style }}
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className="ui-spinner-spoke absolute top-0 block rounded-full bg-current ui-spinner-fill"
          style={{
            left: (px - width) / 2,
            width,
            height: px / 4,
            transform: `rotate(${(i * 360) / count}deg)`,
            transformOrigin: `50% ${px / 2}px`,
            // spoke i lags i/n of a loop behind spoke 0, so the bright head travels clockwise like the ios indicator
            ...phase(-((count - i) % count) / count),
          }}
        />
      ))}
    </span>
  );
}

function Dots({ px, className, style }: Drawing) {
  const dot = px / 4.5;
  return (
    <span
      data-slot="spinner-indicator"
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: px, height: px, gap: px / 8, ...style }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ui-spinner-dot block shrink-0 rounded-full bg-current ui-spinner-fill"
          // the middle dot starts at its peak, so the first (or a paused) frame is a soft arc
          style={{ width: dot, height: dot, ...phase(i * 0.16 - 0.56) }}
        />
      ))}
    </span>
  );
}

function Bars({ px, className, style }: Drawing) {
  const bar = px / 6;
  return (
    <span
      data-slot="spinner-indicator"
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: px, height: px, gap: px / 8, ...style }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="ui-spinner-bar block h-full shrink-0 rounded-full bg-current ui-spinner-fill"
          style={{ width: bar, ...phase((i * 0.12) / 0.9 - 1) }}
        />
      ))}
    </span>
  );
}

function Pulse({ px, className, style }: Drawing) {
  const dot = px * 0.35;
  return (
    <span
      data-slot="spinner-indicator"
      aria-hidden
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: px, height: px, ...style }}
    >
      <span
        className="ui-spinner-ping absolute inset-0 rounded-full"
        // a third of the way out, so the first (or a paused) frame already shows the ring
        style={{ border: `${Math.max(1.5, px / 12).toFixed(2)}px solid currentColor`, ...phase(-0.35) }}
      />
      <span className="block rounded-full bg-current ui-spinner-fill" style={{ width: dot, height: dot }} />
    </span>
  );
}

function Orbit({ px, className, style }: Drawing) {
  const dot = px / 4;
  const left = (px - dot) / 2;
  return (
    <span
      data-slot="spinner-indicator"
      aria-hidden
      className={cn("ui-spinner-orbit relative inline-block shrink-0", className)}
      style={{ width: px, height: px, ...style }}
    >
      <span className="absolute top-0 block rounded-full bg-current ui-spinner-fill" style={{ left, width: dot, height: dot }} />
      <span
        className="absolute bottom-0 block rounded-full bg-current ui-spinner-fill opacity-50"
        style={{ left, width: dot, height: dot }}
      />
    </span>
  );
}

const VARIANTS: SpinnerVariant[] = ["ring", "dots", "bars", "pulse", "orbit", "spokes"];

function Indicator({ variant, ...drawing }: Drawing & { variant: SpinnerVariant }) {
  switch (variant) {
    case "dots":
      return <Dots {...drawing} />;
    case "bars":
      return <Bars {...drawing} />;
    case "pulse":
      return <Pulse {...drawing} />;
    case "orbit":
      return <Orbit {...drawing} />;
    case "spokes":
      return <Spokes {...drawing} />;
    default:
      return <Ring {...drawing} />;
  }
}

export function Spinner(spinnerProps: SpinnerProps) {
  const {
    variant = "ring",
    size = "md",
    tone = "current",
    color,
    speed = 1,
    label = "Loading",
    showLabel = false,
    labelPosition = "end",
    track = true,
    delay = 0,
    paused = false,
    classNames,
    className,
    style,
    "aria-hidden": ariaHidden,
    ...props
  } = useDefaults("spinner", spinnerProps);
  // the delay applies from mount: a spinner that waited fades in, one that is already showing never hides again
  // when delay changes later (remount it with a key to replay the wait)
  const [delayed] = useState(() => delay > 0);
  const [ready, setReady] = useState(() => !(delay > 0));
  const waiting = delay > 0 && !ready;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setReady(true), delay);
    return () => clearTimeout(timer);
  }, [waiting, delay]);

  if (waiting) return null;

  const kind: SpinnerVariant = VARIANTS.includes(variant) ? variant : "ring";
  const named = typeof size === "string" && Object.hasOwn(SIZES, size) ? (size as SpinnerSize) : null;
  const px = named ? SIZES[named] : typeof size === "number" && Number.isFinite(size) ? Math.max(12, size) : SIZES.md;
  const scale: Scale = px < 20 ? "sm" : px < 36 ? "md" : "lg";
  const stroke = named ? STROKES[named] : clamp(Math.sqrt(px) / 2, 1.5, 8);
  const rate = Number.isFinite(speed) ? clamp(speed, 0.25, 4) : 1;
  const position: SpinnerLabelPosition = labelPosition === "bottom" ? "bottom" : "end";
  const toneClass = Object.hasOwn(toneClasses, tone) ? toneClasses[tone as Tone] : undefined;
  const toned = Boolean(color || toneClass);
  // a parent that already announces the loading (a loading button) hides the spinner: no role, no hidden label
  const hidden = ariaHidden === true || ariaHidden === "true";

  return (
    <>
      <style href="ui-spinner" precedence="ui-lab">
        {CSS}
      </style>
      <span
        data-slot="spinner"
        data-variant={kind}
        data-size={named ?? px}
        data-tone={color ? "custom" : toneClass ? tone : "current"}
        data-paused={paused || undefined}
        role={hidden ? undefined : "status"}
        aria-hidden={ariaHidden}
        className={cn(
          "relative inline-flex max-w-full items-center align-middle text-(--spinner-color)",
          position === "bottom" ? "flex-col text-center" : "flex-row",
          GAPS[position][scale],
          toned ? [toneClass, "[--spinner-color:var(--tone)]"] : "[--spinner-color:currentColor]",
          delayed && "ui-spinner-in",
          className,
        )}
        style={{ ...colorVars(color), ...style }}
        {...props}
      >
        <Indicator
          variant={kind}
          px={px}
          stroke={stroke}
          track={track}
          className={cn("ui-spinner", paused && "ui-spinner-paused", classNames?.indicator)}
          style={{ "--spinner-duration": `${(DURATIONS[kind] / rate).toFixed(3)}s` } as CSSProperties}
        />
        {label && (showLabel || !hidden) ? (
          <span
            data-slot="spinner-label"
            className={cn(
              showLabel ? [LABEL_SIZES[scale], "min-w-0 font-medium", toned && "text-(--tone-soft-foreground)"] : "sr-only",
              classNames?.label,
            )}
          >
            {label}
          </span>
        ) : null}
      </span>
    </>
  );
}
