"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { User } from "lucide-react";
import { press, springs, usePrefersReducedMotion } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults, useUIConfig } from "@/lib/ui-config";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarVariant = "soft" | "solid";
export type AvatarRadius = "none" | "sm" | "md" | "lg" | "full";
export type AvatarStatus = "none" | "online" | "offline" | "busy" | "away";
export type AvatarLoadingStatus = "idle" | "loading" | "loaded" | "error";
export type AvatarSlot = "image" | "fallback" | "status";
export type AvatarGroupOverlap = "sm" | "md" | "lg";
export type AvatarGroupSpread = "hover" | "always" | "never";
export type AvatarGroupSlot = "item" | "overflow";
export type { Tone as AvatarTone };

// ---------- helpers ----------

// 12 hues, one per person. the initials are not these colors but an ink derived from them (see INK), so every hue
// keeps 4.5:1 in both themes, soft and solid
export const AVATAR_COLORS = [
  "#EF4444",
  "#F97316",
  "#D97706",
  "#65A30D",
  "#10B981",
  "#14B8A6",
  "#0EA5E9",
  "#3B82F6",
  "#6366F1",
  "#8B5CF6",
  "#D946EF",
  "#EC4899",
] as const;

// a letter plus its combining marks; built at runtime because the literal needs an es2018 target
const LETTER = new RegExp("\\p{L}\\p{M}*", "u");

// "emma carter" -> "EC", "Anna" -> "A", "🎉 Anna  Price" -> "AP": the first letter of the first and last word,
// skipping anything that is not a letter
export function getInitials(name: string | null | undefined, locale = "ro-RO") {
  if (!name) return "";
  const letters = name
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .map((word) => LETTER.exec(word)?.[0])
    .filter((letter): letter is string => Boolean(letter));
  if (!letters.length) return "";
  const initials = letters.length > 1 ? letters[0] + letters[letters.length - 1] : letters[0];
  return initials.toLocaleUpperCase(locale);
}

// a stable color per name (fnv-1a hash into AVATAR_COLORS), so a person has the same color in every list and chart
export function avatarColor(name: string | null | undefined): string {
  const key = (name ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // murmur3's finalizer spreads short names over all 12 hues
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length];
}

// ---------- maps ----------

const PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 48, xl: 64 };

// 24 / 32 / 40 / 48 / 64px with initials at 10 / 12 / 14 / 16 / 22px
const SIZES: Record<AvatarSize, string> = {
  xs: "size-6 text-[10px]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-[22px]",
};

// the +N chip reads a step smaller than initials so two digits always fit
const CHIP_TEXT: Record<AvatarSize, string> = {
  xs: "text-[9px]",
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-[13px]",
  xl: "text-[15px]",
};

// proportional, so every size keeps the same shape
const RADII: Record<AvatarRadius, string> = {
  none: "rounded-none",
  sm: "rounded-[16%]",
  md: "rounded-[24%]",
  lg: "rounded-[32%]",
  full: "rounded-full",
};

// corner radius as a fraction of the size; the status dot sits on the corner's curve
const CORNER: Record<AvatarRadius, number> = { none: 0, sm: 0.16, md: 0.24, lg: 0.32, full: 0.5 };

const OVERLAP: Record<AvatarGroupOverlap, number> = { sm: 0.2, md: 0.28, lg: 0.36 };

const STATUS: Record<Exclude<AvatarStatus, "none">, string> = {
  online: "bg-success",
  offline: "bg-[color-mix(in_oklab,var(--foreground)_35%,var(--avatar-ring,var(--background)))]",
  // a bar inside, so busy never relies on red against green alone
  busy: "bg-destructive after:absolute after:inset-x-[22%] after:top-1/2 after:h-[max(1.5px,18%)] after:-translate-y-1/2 after:rounded-full after:bg-destructive-foreground",
  away: "bg-warning",
};

const STATUS_LABELS: Record<Exclude<AvatarStatus, "none">, string> = {
  online: "Online",
  offline: "Offline",
  busy: "Busy",
  away: "Away",
};

// soft: a tint with deep initials; solid: a filled disc. both paint through --avatar-fill / --avatar-ink, so a caller
// can force either with a className ([--avatar-fill:...])
const VARIANTS: Record<AvatarVariant, string> = {
  soft: "[--avatar-fill:var(--tone-soft)] [--avatar-ink:var(--tone-soft-foreground)]",
  solid: "[--avatar-fill:var(--tone)] [--avatar-ink:var(--tone-foreground)]",
};

// neutral: the avatar-fallback tint (foreground/10) when soft, black / white when solid
const NEUTRAL =
  "[--tone:var(--primary)] [--tone-foreground:var(--primary-foreground)] [--tone-soft:color-mix(in_oklab,var(--foreground)_10%,transparent)] [--tone-soft-foreground:color-mix(in_oklab,var(--foreground)_72%,transparent)]";

// initials on a name or custom color. soft: the hue at ~90% chroma with the lightness pulled halfway to the
// foreground, 5:1 or better on its own tint in both themes (colorVars' 72% mix fades teal and lime on white).
// solid (name colors only): the hue capped at oklch l 0.54, so white initials keep 4.5:1
const softInk = (color: string) => `oklch(from color-mix(in oklab, ${color} 45%, var(--foreground)) l calc(c * 2) h)`;
const solidFill = (color: string) => `oklch(from ${color} min(l, 0.54) c h)`;

// the fill lives on ::before, under the photo, so a slow photo fades in over its own color and a broken one never
// changes the circle's color. it pulses while the photo is on its way
const BASE =
  "relative inline-flex shrink-0 select-none items-center justify-center align-middle font-semibold leading-none tracking-[-0.01em] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-(--avatar-fill) motion-safe:data-[state=loading]:before:animate-pulse";

const PRESSABLE =
  "cursor-pointer touch-manipulation select-none outline-hidden [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring";

const STATE_LAYER =
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity before:duration-fast before:ease-smooth hover:before:opacity-[0.08] active:before:opacity-[0.12]";

// 44px hit area on touch for anything smaller, without changing the look
const HIT_AREA =
  "pointer-coarse:after:absolute pointer-coarse:after:inset-[min(0px,calc((var(--avatar-size)-44px)/2))] pointer-coarse:after:rounded-full";

// guards values from the outside (a cms string never crashes a render, "constructor" is not a size)
const known = <T extends string>(map: Record<T, unknown>, value: unknown, fallback: T): T =>
  typeof value === "string" && Object.hasOwn(map, value) ? (value as T) : fallback;

function sizeOf(size: AvatarSize | number) {
  if (typeof size === "number" && Number.isFinite(size) && size > 0) return { px: size, preset: undefined };
  const preset = known(PX, size, "md");
  return { px: PX[preset], preset };
}

// ---------- group context ----------

type GroupContextValue = { size: AvatarSize | number; radius: AvatarRadius };

const AvatarGroupContext = createContext<GroupContextValue | null>(null);

// ---------- Avatar ----------

export type AvatarProps = Omit<ComponentProps<typeof AvatarPrimitive.Root>, "color"> & {
  // image url; while it loads (or when it fails) the initials or the icon show instead
  src?: string;
  // the person or organization: the spoken label, the initials and the fallback color
  name?: string;
  // the spoken label when it should differ from name
  alt?: string;
  // xs 24, sm 32, md 40, lg 48, xl 64px, or any number of px
  size?: AvatarSize | number;
  // full is a circle; the others are proportional so every size keeps its shape
  radius?: AvatarRadius;
  // a dot at the bottom end: online, offline, busy or away
  status?: AvatarStatus;
  // the spoken status, e.g. { online: "Activ" }
  statusLabels?: Partial<Record<Exclude<AvatarStatus, "none">, string>>;
  // the fallback look: soft (a tint with deep initials) or solid (a filled disc with white initials)
  variant?: AvatarVariant;
  // initials on a color picked from the name; false keeps them neutral
  colorful?: boolean;
  // a fixed fallback color instead of the name hash; any tone but neutral wins over colorful
  tone?: Tone;
  // any css color for the fallback; wins over tone and colorful
  color?: string;
  // a 2px ring in ringColor, to separate overlapping avatars (groups turn it on)
  ring?: boolean;
  // the surface behind the avatar: ring and status-dot outline. defaults to an inherited --avatar-ring, else var(--background)
  ringColor?: string;
  // ms before the fallback shows while a photo loads, so fast photos never flash initials. only applies with src
  fallbackDelay?: number;
  // replaces the initials and the icon (a logo, an icon)
  fallback?: ReactNode;
  // fires as the photo goes idle -> loading -> loaded or error
  onLoadingStatusChange?: (status: AvatarLoadingStatus) => void;
  classNames?: Partial<Record<AvatarSlot, string>>;
};

export function Avatar(avatarProps: AvatarProps) {
  const {
    src,
    name,
    alt,
    size: sizeProp = "md",
    radius: radiusProp = "full",
    status = "none",
    statusLabels,
    variant = "soft",
    colorful = true,
    tone = "neutral",
    color,
    ring: ringProp = false,
    ringColor,
    fallbackDelay = 250,
    fallback,
    onLoadingStatusChange,
    classNames,
    className,
    style,
    ...props
  } = useDefaults("avatar", avatarProps);
  const uiLocale = useUIConfig().locale;
  const group = useContext(AvatarGroupContext);
  const reduced = usePrefersReducedMotion();
  const [loading, setLoading] = useState<AvatarLoadingStatus>("idle");

  // inside a group the group's size and radius win, and the ring separates the stack
  const size = group?.size ?? sizeProp;
  const radius = group?.radius ?? radiusProp;
  const ring = Boolean(group) || ringProp;
  const { px, preset } = sizeOf(size);
  const shape = known(RADII, radius, "full");
  const toneName = known(toneClasses, tone, "neutral");
  const look = known(VARIANTS, variant, "soft");

  const label = (alt ?? name ?? "").trim();
  const initials = getInitials(name, uiLocale);
  const dot = Object.hasOwn(STATUS, status) ? (status as Exclude<AvatarStatus, "none">) : undefined;
  const spokenStatus = dot ? ({ ...STATUS_LABELS, ...statusLabels }[dot] ?? "") : "";
  const ariaLabel = [label, spokenStatus].filter(Boolean).join(", ") || undefined;

  // fallback color: custom color, then a tone, then the name hash, else neutral
  const custom = color || (toneName === "neutral" && colorful && name?.trim() ? avatarColor(name) : undefined);
  const palette = color ? "custom" : toneName !== "neutral" ? toneName : custom ? "name" : "neutral";
  const paint: CSSProperties | undefined = custom
    ? ({
        ...colorVars(custom),
        "--tone-soft-foreground": softInk(custom),
        // a custom solid color is the caller's fill, with black or white initials from colorVars
        ...(palette === "name" ? { "--tone": solidFill(custom), "--tone-foreground": "#fff" } : null),
      } as CSSProperties)
    : undefined;

  // status dot: 25% of the size (8 to 14px), centered on the corner's curve
  const dotPx = Math.min(14, Math.max(8, Math.round(px * 0.25)));
  const dotOffset = px * CORNER[shape] * (1 - Math.SQRT1_2) - dotPx / 2;
  const thin = px < 32;

  const numberStyle: CSSProperties | undefined = preset
    ? undefined
    : { width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.35)) };

  const state: AvatarLoadingStatus = src ? loading : "idle";

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={preset ?? "custom"}
      data-status={status}
      data-state={state}
      data-variant={look}
      data-tone={palette}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn(
        BASE,
        VARIANTS[look],
        palette === "neutral" ? NEUTRAL : palette === "custom" || palette === "name" ? undefined : toneClasses[toneName],
        preset && SIZES[preset],
        RADII[shape],
        ring && [
          "bg-[var(--avatar-ring,var(--background))]",
          thin ? "ring-[1.5px]" : "ring-2",
          "ring-[var(--avatar-ring,var(--background))]",
        ],
        className,
      )}
      style={{
        ...paint,
        ...(ringColor ? { "--avatar-ring": ringColor } : null),
        ...numberStyle,
        ...style,
      }}
      {...props}
    >
      {src ? (
        <AvatarPrimitive.Image
          data-slot="avatar-image"
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onLoadingStatusChange={(next) => {
            setLoading(next);
            onLoadingStatusChange?.(next);
          }}
          className={cn(
            "absolute inset-0 size-full rounded-[inherit] object-cover transition-opacity duration-normal ease-smooth starting:opacity-0",
            classNames?.image,
          )}
        />
      ) : null}
      {/* remount per src: radix only reads delayMs on mount, so switching photos would flash the initials */}
      <AvatarPrimitive.Fallback
        key={src ? `src:${src}` : "none"}
        data-slot="avatar-fallback"
        delayMs={src ? Math.max(0, fallbackDelay) : undefined}
        className={cn(
          "absolute inset-0 flex items-center justify-center overflow-hidden rounded-[inherit] text-(--avatar-ink)",
          // after a failed or slow photo the initials fade in; without src they are simply there
          src && "transition-opacity duration-normal ease-smooth starting:opacity-0",
          classNames?.fallback,
        )}
      >
        {fallback ?? (initials || <User aria-hidden className="size-[52%] opacity-80" strokeWidth={2} />)}
      </AvatarPrimitive.Fallback>
      {/* a hairline inside photos, so a white shirt never melts into a white page */}
      {state === "loaded" ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-foreground/10 ring-inset"
        />
      ) : null}
      <AnimatePresence initial={false}>
        {dot ? (
          <motion.span
            key={dot}
            data-slot="avatar-status"
            data-status={dot}
            aria-hidden
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0, transition: reduced ? { duration: 0 } : { duration: 0.12 } }}
            transition={reduced ? { duration: 0 } : springs.bouncy}
            className={cn(
              "absolute rounded-full",
              thin ? "ring-[1.5px]" : "ring-2",
              "ring-[var(--avatar-ring,var(--background))]",
              STATUS[dot],
              classNames?.status,
            )}
            style={{ width: dotPx, height: dotPx, bottom: dotOffset, insetInlineEnd: dotOffset }}
          />
        ) : null}
      </AnimatePresence>
    </AvatarPrimitive.Root>
  );
}

// ---------- AvatarGroup ----------

export type AvatarGroupProps = Omit<ComponentProps<"div">, "children"> & {
  // data-driven avatars; or pass <Avatar> children
  items?: AvatarProps[];
  children?: ReactNode;
  // how many show before the +N chip
  max?: number;
  // the real count when you only pass the first few (+N = total - shown)
  total?: number;
  // applied to every avatar and the chip
  size?: AvatarSize | number;
  radius?: AvatarRadius;
  // how much neighbors overlap: 20 / 28 / 36% of the size
  overlap?: AvatarGroupOverlap;
  // hover: fan out on hover, keyboard focus or a first tap; always: laid out apart; never: stays stacked
  spread?: AvatarGroupSpread;
  // the surface behind the group, used for the separating rings
  ringColor?: string;
  // makes every avatar a button
  onAvatarClick?: (index: number) => void;
  // makes +N a button (open the full list)
  onOverflowClick?: () => void;
  // the spoken label of +N
  overflowLabel?: (count: number) => string;
  // the group's aria-label
  label?: string;
  classNames?: Partial<Record<AvatarGroupSlot, string>>;
};

const defaultOverflowLabel = (count: number) => `${count} more`;

export function AvatarGroup(avatarGroupProps: AvatarGroupProps) {
  const {
    items,
    children,
    max = 4,
    total,
    size = "md",
    radius = "full",
    overlap = "md",
    spread = "hover",
    ringColor,
    onAvatarClick,
    onOverflowClick,
    overflowLabel = defaultOverflowLabel,
    label = "People",
    classNames,
    className,
    style,
    onPointerDown,
    onPointerEnter,
    onPointerLeave,
    onClickCapture,
    onKeyDown,
    onFocus,
    onBlur,
    ...props
  } = useDefaults("avatar-group", avatarGroupProps);
  const reduced = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  // 1 in ltr, -1 in rtl: the fan always opens toward the end
  const [dir, setDir] = useState(1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointer = useRef("");
  // +N pressed from the keyboard: where the newly shown avatars start, so focus can follow them
  const reveal = useRef<{ root: HTMLElement; from: number } | null>(null);

  const { px, preset } = sizeOf(size);
  const shape = known(RADII, radius, "full");
  // the ring already covers its neighbor by its own width, so it counts toward the overlap
  const ringPx = px < 32 ? 1.5 : 2;
  const overlapPx = Math.max(0, Math.round(px * OVERLAP[known(OVERLAP, overlap, "md")] - ringPx));
  // spread: 4px between neighbors
  const step = overlapPx + 4;
  const fans = spread === "hover";
  const open = fans && (hovered || focused || tapped);
  const apart = spread === "always" || open;

  // a first tap spreads, tapping outside collapses
  useEffect(() => {
    if (!tapped) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setTapped(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [tapped]);

  const track = (node: HTMLDivElement) => {
    rootRef.current = node;
    setDir(getComputedStyle(node).direction === "rtl" ? -1 : 1);
  };

  const nodes: ReactElement[] = items
    ? items.map((item, i) => <Avatar key={item.id ?? `${item.name ?? item.src ?? ""}-${i}`} {...item} />)
    : Children.toArray(children).filter(isValidElement);
  const limit = Number.isFinite(max) ? Math.max(1, Math.floor(max)) : nodes.length;
  const shown = nodes.slice(0, limit);
  const rest = Math.max(0, (total ?? nodes.length) - shown.length);

  // when +N reveals the rest in place, the chip leaves while focused; hand focus to the first new avatar instead of
  // dropping it on the page. runs once, on the render that follows the press
  useEffect(() => {
    const pending = reveal.current;
    if (!pending) return;
    reveal.current = null;
    if (shown.length > pending.from)
      pending.root.querySelectorAll<HTMLElement>('button[data-slot="avatar-group-item"]')[pending.from]?.focus();
  });

  const openOverflow = onOverflowClick
    ? (event: MouseEvent<HTMLButtonElement>) => {
        const root = event.currentTarget.closest<HTMLElement>('[data-slot="avatar-group"]');
        // keyboard only: a click or tap keeps focus where the pointer left it
        if (root && pointer.current === "keyboard" && event.currentTarget === document.activeElement)
          reveal.current = { root, from: shown.length };
        onOverflowClick();
      }
    : undefined;

  const itemTransition = (index: number, count: number): Transition => {
    if (reduced) return { duration: 0 };
    // opening: left to right; closing: the far end starts first
    const delay = (open ? index : count - 1 - index) * 0.02;
    return { x: { ...springs.smooth, delay }, default: springs.snappy, opacity: { duration: 0.15 } };
  };

  const count = shown.length + (rest > 0 ? 1 : 0);
  // the fanned row is wider than the group's box and has 4px gaps; this width keeps the pointer "inside" across them
  const fanWidth = count * px + Math.max(0, count - 1) * 4;
  const lift = reduced ? undefined : { y: -2, scale: 1.06 };
  const offset = (index: number) => (open ? index * step * dir : 0);
  const gap = (index: number): CSSProperties =>
    index === 0 ? {} : { marginInlineStart: spread === "always" ? 4 : -overlapPx };
  const itemStyle = (index: number): CSSProperties => ({ ...gap(index), "--avatar-size": `${px}px` }) as CSSProperties;
  const pop = { opacity: 0, scale: 0.6 };

  return (
    <AvatarGroupContext.Provider value={{ size, radius: shape }}>
      <div
        data-slot="avatar-group"
        data-spread={spread}
        data-state={apart ? "open" : "closed"}
        role="group"
        aria-label={label}
        className={cn("relative isolate inline-flex shrink-0 items-center", className)}
        style={{ ...(ringColor ? { "--avatar-ring": ringColor } : null), ...style } as CSSProperties}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!fans || event.pointerType !== "mouse") return;
          track(event.currentTarget);
          setHovered(true);
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (event.pointerType === "mouse") setHovered(false);
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          pointer.current = event.pointerType;
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          pointer.current = "keyboard";
        }}
        onClickCapture={(event: MouseEvent<HTMLDivElement>) => {
          onClickCapture?.(event);
          if (!fans || (pointer.current !== "touch" && pointer.current !== "pen")) return;
          if (!open) {
            // the first tap only spreads; the avatar under the finger answers the second one
            event.preventDefault();
            event.stopPropagation();
            track(event.currentTarget);
            setTapped(true);
          } else if (!(event.target as Element).closest("button")) {
            setTapped(false);
          }
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (!fans || !(event.target as Element).matches?.(":focus-visible")) return;
          track(event.currentTarget);
          setFocused(true);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
        {...props}
      >
        {/* first in the dom, so the avatars paint and hit-test above it; only the gaps land here */}
        {open ? (
          <span
            aria-hidden
            data-slot="avatar-group-hit-area"
            className="absolute inset-y-0 start-0"
            style={{ width: fanWidth }}
          />
        ) : null}
        <AnimatePresence initial={false}>
          {shown.map((node, index) => {
            const shared = {
              "data-slot": "avatar-group-item",
              initial: pop,
              animate: { opacity: 1, scale: 1, x: offset(index) },
              exit: pop,
              transition: itemTransition(index, count),
              style: itemStyle(index),
            };
            return onAvatarClick ? (
              <motion.button
                key={node.key ?? index}
                type="button"
                {...shared}
                // interactive avatars always lift; plain ones only while the stack is apart
                whileHover={lift}
                whileFocus={lift}
                whileTap={reduced ? undefined : press.whileTap}
                onClick={() => onAvatarClick(index)}
                className={cn(
                  "relative inline-flex shrink-0 hover:z-[1] focus-visible:z-[1]",
                  RADII[shape],
                  PRESSABLE,
                  HIT_AREA,
                  classNames?.item,
                )}
              >
                {node}
              </motion.button>
            ) : (
              <motion.span
                key={node.key ?? index}
                {...shared}
                whileHover={apart ? lift : undefined}
                className={cn("relative inline-flex shrink-0 hover:z-[1]", RADII[shape], classNames?.item)}
              >
                {node}
              </motion.span>
            );
          })}
          {rest > 0 ? (
            <motion.span
              key="overflow"
              data-slot="avatar-group-item"
              initial={pop}
              animate={{ opacity: 1, scale: 1, x: offset(shown.length) }}
              exit={pop}
              transition={itemTransition(shown.length, count)}
              style={itemStyle(shown.length)}
              whileHover={apart || onOverflowClick ? lift : undefined}
              className={cn("relative inline-flex shrink-0 hover:z-[1] focus-within:z-[1]", RADII[shape])}
            >
              <OverflowChip
                count={rest}
                label={overflowLabel(rest)}
                preset={preset}
                px={px}
                shape={shape}
                reduced={reduced}
                onClick={openOverflow}
                className={classNames?.overflow}
              />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </div>
    </AvatarGroupContext.Provider>
  );
}

function OverflowChip({
  count,
  label,
  preset,
  px,
  shape,
  reduced,
  onClick,
  className,
}: {
  count: number;
  label: string;
  preset: AvatarSize | undefined;
  px: number;
  shape: AvatarRadius;
  reduced: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  const text = count > 99 ? "99+" : `+${count}`;
  const classes = cn(
    "relative inline-flex shrink-0 items-center justify-center font-semibold leading-none tracking-[-0.02em] tabular-nums text-foreground",
    "bg-[color-mix(in_oklab,var(--foreground)_10%,var(--avatar-ring,var(--background)))]",
    px < 32 ? "ring-[1.5px]" : "ring-2",
    "ring-[var(--avatar-ring,var(--background))]",
    preset ? [SIZES[preset], CHIP_TEXT[preset]] : undefined,
    RADII[shape],
    className,
  );
  const style: CSSProperties | undefined = preset
    ? undefined
    : { width: px, height: px, fontSize: Math.max(9, Math.round(px * 0.3)) };
  // ltr so "+3" never reads "3+" inside an rtl page
  const content = (
    <span aria-hidden dir="ltr">
      {text}
    </span>
  );

  if (onClick) {
    return (
      <motion.button
        type="button"
        data-slot="avatar-group-overflow"
        aria-label={label}
        whileTap={reduced ? undefined : press.whileTap}
        transition={press.transition}
        onClick={onClick}
        className={cn(classes, PRESSABLE, STATE_LAYER, HIT_AREA)}
        style={style}
      >
        {content}
      </motion.button>
    );
  }
  return (
    <span data-slot="avatar-group-overflow" role="img" aria-label={label} className={classes} style={style}>
      {content}
    </span>
  );
}
