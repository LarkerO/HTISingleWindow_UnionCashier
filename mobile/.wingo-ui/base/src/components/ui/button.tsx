"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { motion } from "motion/react";
import { press, usePrefersReducedMotion } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { useDefaults } from "@/lib/ui-config";
import { cn } from "@/lib/utils";

export type ButtonVariant = "solid" | "soft" | "outline" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon" | "icon-lg";
export type ButtonRadius = "none" | "sm" | "md" | "lg" | "full";
export type ButtonSlot = "content" | "icon" | "spinner";
export type { Tone as ButtonTone };

type Scale = "sm" | "md" | "lg";

const SCALE: Record<ButtonSize, Scale> = {
  sm: "sm",
  md: "md",
  lg: "lg",
  "icon-sm": "sm",
  icon: "md",
  "icon-lg": "lg",
};

// 32 / 40 / 48px. on a coarse pointer md grows to 44px and sm keeps its look but gets a 44px hit area
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-[13px] pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5",
  md: "h-10 gap-2 px-4 text-sm pointer-coarse:h-11",
  lg: "h-12 gap-2 px-5 text-[15px]",
  "icon-sm":
    "size-8 pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5",
  icon: "size-10 pointer-coarse:size-11",
  "icon-lg": "size-12",
};

// a link is text-sized: no height or padding
const LINK_SIZES: Record<Scale, string> = {
  sm: "gap-1 text-[13px]",
  md: "gap-1.5 text-sm",
  lg: "gap-1.5 text-[15px]",
};

// svgs without their own size- class follow the button size: 14 / 16 / 18px
const ICON_SIZES: Record<Scale, string> = {
  sm: "[&_svg:not([class*='size-'])]:size-3.5",
  md: "[&_svg:not([class*='size-'])]:size-4",
  lg: "[&_svg:not([class*='size-'])]:size-[18px]",
};

// radius grows with the size so every size reads as the same shape
const RADII: Record<ButtonRadius, Record<Scale, string>> = {
  none: { sm: "rounded-none", md: "rounded-none", lg: "rounded-none" },
  sm: { sm: "rounded-[6px]", md: "rounded-[8px]", lg: "rounded-[10px]" },
  md: { sm: "rounded-[8px]", md: "rounded-[10px]", lg: "rounded-[12px]" },
  lg: { sm: "rounded-[10px]", md: "rounded-[14px]", lg: "rounded-[16px]" },
  full: { sm: "rounded-full", md: "rounded-full", lg: "rounded-full" },
};

// every variant paints through the --tone-* vars (lib/tones), so tones and a custom color need no extra classes
const VARIANTS: Record<ButtonVariant, string> = {
  solid: "bg-(--tone) text-(--tone-foreground) shadow-raised",
  soft: "bg-(--tone-soft) text-(--tone-soft-foreground)",
  outline: "border border-(--tone-border) text-(--tone-soft-foreground)",
  ghost: "text-(--tone-soft-foreground)",
  // always underlined: color alone does not mark a link in running text, and touch has no hover to reveal it
  link: "rounded-[4px] text-(--tone-soft-foreground) underline decoration-current/35 decoration-1 underline-offset-4 transition-[color,text-decoration-color] hover:decoration-current",
};

// hover and press tint: a layer of the text color, so it works on every variant, tone and color. hover: only
// applies where hover exists, so a tap never leaves it stuck on
const STATE_LAYER =
  "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-current before:opacity-0 before:transition-opacity before:duration-fast before:ease-smooth hover:before:opacity-[0.08] active:before:opacity-[0.12]";

// touch-manipulation and the transparent tap highlight live here, not in a global stylesheet, so a copied button
// never flashes gray or waits for a double-tap on ios
const BASE =
  "relative inline-flex shrink-0 cursor-pointer touch-manipulation select-none items-center justify-center whitespace-nowrap font-medium outline-hidden [-webkit-tap-highlight-color:transparent] transition-[color,background-color,border-color,opacity] duration-fast ease-smooth focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring data-disabled:pointer-events-none data-disabled:opacity-50 data-loading:cursor-progress";

export type ButtonProps = Omit<
  ComponentProps<"button">,
  // motion.button owns these names with its own signatures
  "color" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  // solid for the main action, soft and outline for secondary ones, ghost for toolbars, link inline in text
  variant?: ButtonVariant;
  // semantic color: neutral (black / white), brand, success, warning, danger or info
  tone?: Tone;
  // sm 32px, md 40px (44px on touch), lg 48px; icon-sm / icon / icon-lg are square
  size?: ButtonSize;
  radius?: ButtonRadius;
  // any css color; replaces the tone for every variant, text on a solid fill picks black or white
  color?: string;
  // shows a spinner, keeps the width, blocks clicks and sets aria-busy; the button stays focusable
  loading?: boolean;
  // text next to the spinner while loading, e.g. "Saving"; the button reserves room for it
  loadingText?: ReactNode;
  // replaces the default spinner
  spinner?: ReactNode;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  // stretches to the width of its container
  fullWidth?: boolean;
  // renders the single child (an <a>, a router Link) with the button's look and behavior
  asChild?: boolean;
  // extra classes for inner parts
  classNames?: Partial<Record<ButtonSlot, string>>;
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      data-slot="button-spinner"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn(
        "animate-spin motion-reduce:[animation-duration:1.6s]",
        className,
      )}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="3"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// motion.create keeps the press spring when asChild hands rendering to the child element
const MotionSlot = motion.create(Slot);

export function Button(buttonProps: ButtonProps) {
  // app-wide defaults from <UIProvider defaults={{ button: {...} }}> sit under the props passed here
  const {
    variant = "solid",
    tone = "neutral",
    size = "md",
    radius = "md",
    color,
    loading = false,
    loadingText,
    spinner,
    leftIcon,
    rightIcon,
    fullWidth = false,
    asChild = false,
    disabled = false,
    type = "button",
    classNames,
    className,
    style,
    onClick,
    children,
    ...props
  } = useDefaults("button", buttonProps);
  const reduced = usePrefersReducedMotion();
  const scale = SCALE[size] ?? "md";
  const link = variant === "link";
  const inert = disabled || loading;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // a link with aria-disabled can still be activated by a script or assistive tech
    if (inert) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  const icon = (node: ReactNode, side: "left" | "right") =>
    node ? (
      <span
        data-slot="button-icon"
        data-side={side}
        aria-hidden
        className={cn("inline-flex shrink-0", classNames?.icon)}
      >
        {node}
      </span>
    ) : null;

  const shared = {
    "data-slot": "button",
    "data-variant": variant,
    "data-tone": color ? "custom" : tone,
    "data-size": size,
    "data-loading": loading || undefined,
    "data-disabled": disabled || undefined,
    "aria-busy": loading || undefined,
    className: cn(
      BASE,
      toneClasses[tone] ?? toneClasses.neutral,
      VARIANTS[variant] ?? VARIANTS.solid,
      link
        ? LINK_SIZES[scale]
        : [SIZES[size] ?? SIZES.md, RADII[radius]?.[scale], STATE_LAYER],
      ICON_SIZES[scale],
      fullWidth && "w-full",
      className,
    ),
    style: { ...colorVars(color), ...style },
    whileTap: inert || reduced || link ? undefined : press.whileTap,
    transition: press.transition,
    onClick: handleClick,
  };

  // asChild: the child element is the button, icons wrap its own children (loading shows the spinner as the left icon)
  if (asChild) {
    return (
      <MotionSlot
        {...shared}
        aria-disabled={inert || undefined}
        tabIndex={disabled ? -1 : undefined}
        {...props}
      >
        {icon(
          loading
            ? (spinner ?? <Spinner className={classNames?.spinner} />)
            : leftIcon,
          "left",
        )}
        <Slottable>{children}</Slottable>
        {icon(rightIcon, "right")}
      </MotionSlot>
    );
  }

  // the label and the loading layer share one grid cell, so the button is as wide as the wider of the two and never jumps
  return (
    <motion.button
      {...shared}
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      {...props}
    >
      <span className="grid place-items-center gap-[inherit] [grid-template-areas:'stack'] *:[grid-area:stack]">
        <span
          data-slot="button-content"
          className={cn(
            "inline-flex items-center justify-center gap-[inherit] transition-opacity duration-fast ease-smooth",
            loading && "opacity-0",
            classNames?.content,
          )}
        >
          {icon(leftIcon, "left")}
          {children}
          {icon(rightIcon, "right")}
        </span>
        {(loading || loadingText) && (
          <span
            data-slot="button-loading"
            aria-hidden
            className={cn(
              "inline-flex items-center justify-center gap-[inherit] transition-opacity duration-fast ease-smooth",
              !loading && "opacity-0",
            )}
          >
            {/* with loadingText the layer stays mounted (paused) to reserve its width */}
            {spinner ?? (
              <Spinner
                className={cn(!loading && "animate-none", classNames?.spinner)}
              />
            )}
            {loadingText}
          </span>
        )}
      </span>
    </motion.button>
  );
}

export default Button;
