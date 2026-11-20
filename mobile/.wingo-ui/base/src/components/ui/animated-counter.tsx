"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode, Ref } from "react";
import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type Transition,
} from "motion/react";

import { usePrefersReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useDefaults, useUIConfig } from "@/lib/ui-config";

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// the trailing 0 makes the wrap from 9 back to 0 land on an identical face
const WHEEL = [...FACES, 0];

// the air around each face is what the mask fades through, so a resting digit stays solid
const LINE = 1.5;
// eased rather than a straight ramp; a linear fade of the same width reads as a hard edge.
// depth is the share of the line box each edge fades through (22% is the original)
const fadeMask = (depth: number) => {
  const d = clamp(depth, 1, 45);
  const at = (share: number) => `${+(d * share).toFixed(2)}%`;
  const back = (share: number) => `${+(100 - d * share).toFixed(2)}%`;
  return `linear-gradient(to bottom,
  rgba(0,0,0,0) 0%,
  rgba(0,0,0,0.06) ${at(0.25)},
  rgba(0,0,0,0.5) ${at(0.5)},
  rgba(0,0,0,0.94) ${at(0.75)},
  #000 ${at(1)},
  #000 ${back(1)},
  rgba(0,0,0,0.94) ${back(0.75)},
  rgba(0,0,0,0.5) ${back(0.5)},
  rgba(0,0,0,0.06) ${back(0.25)},
  rgba(0,0,0,0) 100%)`;
};

// the group and decimal marks a locale writes numbers with
function localeMarks(locale: string) {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
    return {
      group: parts.find((p) => p.type === "group")?.value,
      decimal: parts.find((p) => p.type === "decimal")?.value,
    };
  } catch {
    return null;
  }
}

const EASE = [0.22, 1, 0.36, 1] as const;
const LEAVE = { duration: 0.18, ease: EASE } as const;
const INSTANT = { duration: 0 } as const;

const spring = (duration: number, bounce: number): Transition => ({
  type: "spring",
  visualDuration: duration,
  bounce,
});

// "inherit" leaves each of these to the surrounding text, which is how the counter styles by default
const SIZES = {
  inherit: "",
  sm: "text-2xl",
  md: "text-4xl",
  lg: "text-6xl",
  xl: "text-7xl",
} as const;

const FONTS = {
  inherit: "",
  sans: "font-sans",
  mono: "font-mono",
  serif: "font-serif",
} as const;

const WEIGHTS = {
  inherit: "",
  normal: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
  bold: "font-bold",
} as const;

export type AnimatedCounterSize = keyof typeof SIZES;
export type AnimatedCounterFont = keyof typeof FONTS;
export type AnimatedCounterWeight = keyof typeof WEIGHTS;

const MAX_DECIMALS = 15;
const MAX_PAD = 24;
const MIN_DURATION = 0.01;
const MAX_DURATION = 60;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const clamp = (n: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(n) ? n : low));
const isDigit = (char: string) => char >= "0" && char <= "9";

// built once so React skips reconciling 21 spans per digit on every change
const SIZER = FACES.map((face) => (
  <span key={face} aria-hidden className="invisible [grid-area:1/1]">
    {face}
  </span>
));

const STACK = WHEEL.map((face, index) => (
  <span
    key={index}
    className="flex items-center justify-center"
    style={{ height: `${LINE}em` }}
  >
    {face}
  </span>
));

export type Grouping = "western" | "indian";

const EVERY_THREE = /\B(?=(\d{3})+(?!\d))/g;
const EVERY_TWO = /\B(?=(\d{2})+(?!\d))/g;

function group(whole: string, separator: string, grouping: Grouping) {
  if (!separator) return whole;
  if (grouping !== "indian") return whole.replace(EVERY_THREE, separator);

  // indian: three at the end, pairs the rest of the way up
  const head = whole.slice(0, -3);
  if (!head) return whole;
  return `${head.replace(EVERY_TWO, separator)}${separator}${whole.slice(-3)}`;
}

type Shape = {
  amount: number;
  scaled: number;
  places: number;
  pace: number;
  width: number;
};

function measure(
  value: number,
  decimals: number,
  padStart: number,
  duration: number,
): Shape {
  // NaN would make the previous-value comparison true forever
  const amount = Number.isFinite(value) ? value : 0;
  const places = clamp(Math.trunc(decimals), 0, MAX_DECIMALS);
  const pad = clamp(Math.trunc(padStart), 1, MAX_PAD);
  // past MAX_SAFE_INTEGER the digits are noise, and past 1e21 String() turns exponential
  const scaled = Math.min(
    Number.MAX_SAFE_INTEGER,
    Math.round(Math.abs(amount) * 10 ** places),
  );

  return {
    amount,
    scaled,
    places,
    pace: clamp(duration, MIN_DURATION, MAX_DURATION),
    width: Math.max(String(scaled).length, places + pad),
  };
}

function format(
  { scaled, places, width }: Shape,
  separator: string,
  decimalSeparator: string,
  grouping: Grouping,
) {
  const raw = String(scaled).padStart(width, "0");
  const whole = group(
    raw.slice(0, raw.length - places) || "0",
    separator,
    grouping,
  );
  return places
    ? `${whole}${decimalSeparator}${raw.slice(raw.length - places)}`
    : whole;
}

// keyed by distance from the right, so gaining a place moves columns rather than remounting them
type Cell =
  | { kind: "digit"; key: number; digit: number }
  | { kind: "mark"; key: string; char: string };

function toCells(chars: string, width: number): Cell[] {
  const cells: Cell[] = [];
  let seen = 0;
  // only digits advance the place, so a multi-character separator would repeat a key
  let run = 0;

  for (const char of chars) {
    if (isDigit(char)) {
      run = 0;
      cells.push({ kind: "digit", key: width - seen++, digit: Number(char) });
    } else {
      cells.push({ kind: "mark", key: `mark-${width - seen}-${run++}`, char });
    }
  }
  return cells;
}

function useWheel(
  from: number,
  digit: number,
  dir: number,
  duration: number,
  bounce: number,
  reduced: boolean,
) {
  const pos = useMotionValue(from);
  const goal = useRef(from);

  // read rather than depended on: a reversal alone must not restart every column
  const heading = useRef(dir);
  useEffect(() => {
    heading.current = dir;
  }, [dir]);

  useEffect(() => {
    if (reduced) {
      goal.current = digit;
      pos.set(digit);
      return;
    }
    // re-aim only when the face changed, or a reversal sends the wheel the long way round
    if (mod(goal.current, 10) !== digit) {
      // aim from where the wheel is, so a moving value never queues up a backlog of turns
      const at = pos.get();
      goal.current =
        heading.current < 0
          ? at - mod(at - digit, 10)
          : at + mod(digit - at, 10);
    }
    const roll = animate(pos, goal.current, spring(duration, bounce));
    return () => roll.stop();
  }, [digit, duration, bounce, reduced, pos]);

  return useTransform(pos, (p) => `${(-mod(p, 10) * 100) / WHEEL.length}%`);
}

type SlotProps = {
  reduced: boolean;
  dep: number;
  shift: Transition;
};

const shifts = ({ reduced, dep, shift }: SlotProps) => ({
  layout: !reduced,
  layoutDependency: dep,
  transition: shift,
});

const fades = (reduced: boolean) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: reduced ? INSTANT : LEAVE },
});

function Fixed({ children, ...slot }: SlotProps & { children: ReactNode }) {
  return (
    <motion.span {...shifts(slot)} className="inline-block">
      {children}
    </motion.span>
  );
}

function Mark({
  char,
  ref,
  ...slot
}: SlotProps & { char: string; ref?: Ref<HTMLSpanElement> }) {
  return (
    <motion.span
      ref={ref}
      data-slot="animated-counter-mark"
      {...shifts(slot)}
      {...fades(slot.reduced)}
      // pre keeps a space separator from collapsing to nothing inside the inline-block
      className="inline-block whitespace-pre"
    >
      {char}
    </motion.span>
  );
}

const Digit = memo(function Digit({
  digit,
  from,
  dir,
  duration,
  bounce,
  mask,
  ref,
  ...slot
}: SlotProps & {
  digit: number;
  from: number;
  dir: number;
  duration: number;
  bounce: number;
  mask: string | undefined;
  // popLayout measures the leaving column through this
  ref?: Ref<HTMLSpanElement>;
}) {
  const y = useWheel(from, digit, dir, duration, bounce, slot.reduced);

  return (
    <motion.span
      ref={ref}
      data-slot="animated-counter-digit"
      {...shifts(slot)}
      {...fades(slot.reduced)}
      className="relative inline-grid overflow-hidden"
      style={{
        height: `${LINE}em`,
        lineHeight: LINE,
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    >
      {/* widest-face width, for fonts with no tabular figures */}
      {SIZER}
      <motion.span style={{ y }} className="absolute inset-x-0 top-0">
        {STACK}
      </motion.span>
    </motion.span>
  );
});

export type AnimatedCounterProps = Omit<
  ComponentProps<"span">,
  | "children"
  | "prefix"
  | "onAnimationStart"
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
> & {
  value: number;
  decimals?: number;
  duration?: number;
  padStart?: number;
  separator?: string;
  decimalSeparator?: string;
  grouping?: Grouping;
  prefix?: ReactNode;
  suffix?: ReactNode;
  size?: AnimatedCounterSize;
  font?: AnimatedCounterFont;
  weight?: AnimatedCounterWeight;
  color?: string;
  bounce?: number;
  fade?: boolean;
  fadeSize?: number;
  locale?: string;
};

export function AnimatedCounter(animatedCounterProps: AnimatedCounterProps) {
  const merged = useDefaults("animated-counter", animatedCounterProps);
  const {
    value,
    decimals = 0,
    duration = 0.6,
    padStart = 1,
    separator = ",",
    decimalSeparator = ".",
    grouping = "western",
    prefix,
    suffix,
    size = "inherit",
    font = "inherit",
    weight = "inherit",
    color = "currentColor",
    bounce = 0.18,
    fade = true,
    fadeSize = 22,
    locale: localeProp,
    className,
    style,
    ...props
  } = merged;
  const reduced = usePrefersReducedMotion();
  // a locale (the prop, else UIProvider's) supplies the marks unless separator or decimalSeparator is passed
  const appLocale = useUIConfig().locale;
  const locale = localeProp || appLocale;
  const marks = useMemo(() => (locale ? localeMarks(locale) : null), [locale]);
  const groupMark = marks?.group !== undefined && merged.separator === undefined ? marks.group : separator;
  const decimalMark = marks?.decimal !== undefined && merged.decimalSeparator === undefined ? marks.decimal : decimalSeparator;
  const mask = useMemo(() => (fade ? fadeMask(fadeSize) : undefined), [fade, fadeSize]);
  const springiness = clamp(bounce, 0, 1);

  const shape = measure(value, decimals, padStart, duration);
  const chars = format(shape, groupMark, decimalMark, grouping);
  const cells = toCells(chars, shape.width);
  const negative = shape.amount < 0 && shape.scaled > 0;

  const [previous, setPrevious] = useState(shape.amount);
  const [dir, setDir] = useState(1);
  if (previous !== shape.amount) {
    setDir(shape.amount >= previous ? 1 : -1);
    setPrevious(shape.amount);
  }

  // faces at mount; a place that appears later starts from 0 and rolls in
  const [seed] = useState(() => {
    const faces: Record<number, number> = {};
    for (const cell of cells) {
      if (cell.kind === "digit") faces[cell.key] = cell.digit;
    }
    return faces;
  });

  const shift = useMemo<Transition>(
    () => (reduced ? INSTANT : spring(shape.pace, springiness)),
    [reduced, shape.pace, springiness],
  );

  const slot: SlotProps = { reduced, dep: chars.length, shift };

  return (
    <span
      data-slot="animated-counter"
      className={cn(
        "inline-flex items-center tabular-nums",
        SIZES[size],
        FONTS[font],
        WEIGHTS[weight],
        className,
      )}
      style={color && color !== "currentColor" ? { color, ...style } : style}
      {...props}
    >
      {prefix != null && <Fixed {...slot}>{prefix}</Fixed>}

      <span className="sr-only">
        {negative ? "-" : ""}
        {chars}
      </span>

      <span aria-hidden className="inline-flex select-none items-center">
        {negative && <Fixed {...slot}>-</Fixed>}
        <AnimatePresence mode="popLayout" initial={false}>
          {cells.map((cell) =>
            cell.kind === "digit" ? (
              <Digit
                key={cell.key}
                {...slot}
                digit={cell.digit}
                from={seed[cell.key] ?? 0}
                dir={dir}
                duration={shape.pace}
                bounce={springiness}
                mask={mask}
              />
            ) : (
              <Mark key={cell.key} {...slot} char={cell.char} />
            ),
          )}
        </AnimatePresence>
      </span>

      {suffix != null && <Fixed {...slot}>{suffix}</Fixed>}
    </span>
  );
}

export default AnimatedCounter;
