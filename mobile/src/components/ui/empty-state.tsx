"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { motion, type HTMLMotionProps, type Variants } from "motion/react";
import { CircleAlert, Inbox, Lock, Plus, RotateCw, SearchX, Sparkles, WifiOff } from "lucide-react";
import { Button, type ButtonSize } from "@/components/ui/button";
import { staggerChildren, staggerItem, springs, usePrefersReducedMotion } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { useDefaults } from "@/lib/ui-config";
import { cn } from "@/lib/utils";

export type EmptyStatePreset = "empty" | "no-results" | "error" | "first-run" | "no-permission" | "offline";
export type EmptyStateVariant = "plain" | "dashed" | "surface";
export type EmptyStateSize = "sm" | "md" | "lg";
export type EmptyStateAlign = "center" | "start";
export type EmptyStateTitleTag = "h2" | "h3" | "h4" | "p";
export type EmptyStateSlot = "media" | "icon" | "badge" | "title" | "description" | "content" | "actions";
export type { Tone as EmptyStateTone };

export type EmptyStatePresetConfig = {
  icon: ReactNode;
  tone: Tone;
  title: ReactNode;
  description: ReactNode;
  // a small badge on the tile's corner (first-run shows a plus)
  badge?: ReactNode;
};

// english defaults; translate once through <UIProvider defaults={{ "empty-state": { presets: {...} } }}>
export const DEFAULT_EMPTY_STATE_PRESETS: Record<EmptyStatePreset, EmptyStatePresetConfig> = {
  empty: {
    icon: <Inbox />,
    tone: "neutral",
    title: "Nothing here yet",
    description: "When there is something to show, it will appear here.",
  },
  "no-results": {
    icon: <SearchX />,
    tone: "neutral",
    title: "No results",
    description: "Try a different search or clear the filters.",
  },
  error: {
    icon: <CircleAlert />,
    tone: "danger",
    title: "Something went wrong",
    description: "We could not load this. Check your connection and try again.",
  },
  "first-run": {
    icon: <Sparkles />,
    tone: "brand",
    title: "Get started",
    description: "Create the first one to see it here.",
    badge: <Plus strokeWidth={3} className="size-[62%]" />,
  },
  "no-permission": {
    icon: <Lock />,
    tone: "warning",
    title: "You do not have access",
    description: "Ask an admin of this workspace to give you access.",
  },
  offline: {
    icon: <WifiOff />,
    tone: "neutral",
    title: "You are offline",
    description: "We will reload this as soon as you are back online.",
  },
};

// sm sits in a table cell, list or popover; md in a panel; lg is a whole page (md spacing below 640px)
const PADDING: Record<EmptyStateSize, string> = {
  sm: "px-4 py-6",
  md: "px-6 py-10",
  lg: "px-6 py-10 sm:py-16",
};

// 40 / 48 / 64px tiles; the margin plus the root's 6px gap leaves 12 / 16 / 20px under the tile
const TILE: Record<EmptyStateSize, string> = {
  sm: "mb-1.5 size-10 rounded-[12px] [&_svg:not([class*='size-'])]:size-5",
  md: "mb-2.5 size-12 rounded-2xl [&_svg:not([class*='size-'])]:size-6",
  lg: "mb-3.5 size-16 rounded-3xl [&_svg:not([class*='size-'])]:size-7",
};

const BADGE: Record<EmptyStateSize, string> = {
  sm: "-end-1 -bottom-1 size-4",
  md: "-end-1.5 -bottom-1.5 size-5",
  lg: "-end-1.5 -bottom-1.5 size-6",
};

// max 160px tall at md; only a direct img / svg is capped, so composed illustrations keep their own sizes
const ILLUSTRATION: Record<EmptyStateSize, string> = {
  sm: "mb-1.5 [&>img]:max-h-28 [&>svg]:max-h-28",
  md: "mb-2.5 [&>img]:max-h-40 [&>svg]:max-h-40",
  lg: "mb-3.5 [&>img]:max-h-48 [&>svg]:max-h-48",
};

const TITLE: Record<EmptyStateSize, string> = {
  sm: "text-sm/5",
  md: "text-[15px]/6",
  lg: "text-lg/7",
};

const DESCRIPTION: Record<EmptyStateSize, string> = {
  sm: "text-[13px]/5 max-w-[36ch]",
  md: "text-sm/[1.55] max-w-[36ch]",
  lg: "text-[15px]/[1.55] max-w-[44ch]",
};

const ACTIONS_GAP: Record<EmptyStateSize, string> = { sm: "mt-3", md: "mt-4", lg: "mt-4" };
const BUTTON_SIZE: Record<EmptyStateSize, ButtonSize> = { sm: "sm", md: "md", lg: "md" };

const VARIANTS: Record<EmptyStateVariant, Record<EmptyStateSize, string>> = {
  plain: { sm: "", md: "", lg: "" },
  dashed: {
    sm: "rounded-2xl border border-dashed border-foreground/15",
    md: "rounded-2xl border border-dashed border-foreground/15",
    lg: "rounded-3xl border border-dashed border-foreground/15",
  },
  surface: {
    sm: "rounded-2xl bg-surface text-surface-foreground shadow-raised",
    md: "rounded-2xl bg-surface text-surface-foreground shadow-raised",
    lg: "rounded-3xl bg-surface text-surface-foreground shadow-raised",
  },
};

// two or more actions stack full width when the empty state is about 400px wide or less (352px of content inside
// the padding), so phones and narrow cards both stack; the primary (last) goes on top
const STACK =
  "@max-[22rem]:has-[>:nth-child(2)]:flex-col-reverse @max-[22rem]:has-[>:nth-child(2)]:items-stretch @max-[22rem]:has-[>:nth-child(2)]:self-stretch @max-[22rem]:has-[>:nth-child(2)]:*:w-full";

type Context = {
  size: EmptyStateSize;
  align: EmptyStateAlign;
  tile: Variants;
  item: Variants;
};

const EmptyStateContext = createContext<Context | null>(null);

function useEmptyState(): Context {
  return useContext(EmptyStateContext) ?? { size: "md", align: "center", tile: {}, item: {} };
}

const TILE_VARIANTS: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: springs.smooth },
};
const ITEM_VARIANTS: Variants = staggerItem;
const FADE_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15, ease: "linear" } },
};
const STAGGER: Variants = staggerChildren(0.04);

const subscribeNever = () => () => {};

// false while hydrating server markup (which already shows the final state), true for anything mounted afterwards
function useMountedAfterHydration() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

type MotionDivProps = Omit<
  ComponentProps<"div">,
  "color" | "title" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
>;

export type EmptyStateProps = MotionDivProps & {
  // picks the default icon, tone and copy; every piece stays overridable
  preset?: EmptyStatePreset;
  // null hides it; undefined uses the preset's
  title?: ReactNode;
  description?: ReactNode;
  // the glyph inside the tile; null hides the tile
  icon?: ReactNode;
  // replaces the tile: an image or an svg (max 160px tall at md)
  illustration?: ReactNode;
  // a small badge on the tile's corner; null hides the preset's (first-run shows a plus)
  badge?: ReactNode;
  // the tile tint; defaults to the preset's
  tone?: Tone;
  // any css color for the tile; replaces the tone
  color?: string;
  // buttons; the primary goes last in the DOM (on top when stacked)
  actions?: ReactNode;
  // adds a "Try again" outline button after the actions; a returned promise shows it loading
  onRetry?: () => void | Promise<unknown>;
  retryLabel?: string;
  // sm in a table / list / popover, md in a panel, lg for a page
  size?: EmptyStateSize;
  variant?: EmptyStateVariant;
  align?: EmptyStateAlign;
  titleAs?: EmptyStateTitleTag;
  // role="status": announces the state when it appears (lists set it on no-results)
  live?: boolean;
  // tile, text and actions rise in with a short stagger on mount
  animated?: boolean;
  // per-preset overrides merged over DEFAULT_EMPTY_STATE_PRESETS (translations)
  presets?: Partial<Record<EmptyStatePreset, Partial<EmptyStatePresetConfig>>>;
  classNames?: Partial<Record<EmptyStateSlot, string>>;
};

export function EmptyState(emptyStateProps: EmptyStateProps) {
  const {
    preset = "empty",
    title,
    description,
    icon,
    illustration,
    badge,
    tone,
    color,
    actions,
    onRetry,
    retryLabel = "Try again",
    size = "md",
    variant = "plain",
    align = "center",
    titleAs = "h3",
    live = false,
    animated = true,
    presets,
    classNames,
    className,
    style,
    children,
    ...props
  } = useDefaults("empty-state", emptyStateProps);
  const reduced = usePrefersReducedMotion();
  const afterHydration = useMountedAfterHydration();
  // initial is read once on mount: server markup and hydration render the final state, later mounts animate
  const [animateOnMount] = useState(() => animated && afterHydration);
  const [retrying, setRetrying] = useState(false);

  const scale: EmptyStateSize = PADDING[size] ? size : "md";
  const look: EmptyStateVariant = VARIANTS[variant] ? variant : "plain";
  const start = align === "start";
  const base = DEFAULT_EMPTY_STATE_PRESETS[preset] ?? DEFAULT_EMPTY_STATE_PRESETS.empty;
  const config = { ...base, ...presets?.[preset] };
  // an empty or unknown tone falls back to the preset's
  const toneName = tone && toneClasses[tone] ? tone : config.tone;

  const context = useMemo<Context>(
    () => ({
      size: scale,
      align: start ? "start" : "center",
      tile: reduced ? FADE_VARIANTS : TILE_VARIANTS,
      item: reduced ? FADE_VARIANTS : ITEM_VARIANTS,
    }),
    [scale, start, reduced],
  );

  const retry = async () => {
    if (!onRetry || retrying) return;
    const result = onRetry();
    // any thenable counts, not only native promises
    if (!result || typeof (result as PromiseLike<unknown>).then !== "function") return;
    setRetrying(true);
    try {
      await result;
    } catch {
      // the caller shows the next state; the button just stops spinning
    } finally {
      setRetrying(false);
    }
  };

  const shownTitle = title === undefined ? config.title : title;
  const shownDescription = description === undefined ? config.description : description;
  const shownIcon = icon === undefined ? config.icon : icon;
  const shownBadge = badge === undefined ? config.badge : badge;
  const hasActions = Boolean(actions) || Boolean(onRetry);

  return (
    <EmptyStateContext.Provider value={context}>
      <motion.div
        data-slot="empty-state"
        data-preset={preset}
        data-variant={look}
        data-size={scale}
        data-align={context.align}
        data-animated={animated || undefined}
        role={live ? "status" : undefined}
        aria-live={live ? "polite" : undefined}
        aria-atomic={live || undefined}
        variants={STAGGER}
        initial={animateOnMount ? "hidden" : false}
        animate="visible"
        className={cn(
          "@container flex w-full min-w-0 flex-col gap-1.5",
          start ? "items-start text-start" : "items-center text-center",
          PADDING[scale],
          VARIANTS[look][scale],
          className,
        )}
        style={style}
        {...props}
      >
        {illustration ? (
          <motion.div
            data-slot="empty-state-media"
            data-kind="illustration"
            aria-hidden
            variants={context.tile}
            className={cn(
              "flex max-w-full justify-center [&>img]:w-auto [&>img]:max-w-full [&>img]:object-contain [&>svg]:max-w-full",
              ILLUSTRATION[scale],
              classNames?.media,
            )}
          >
            {illustration}
          </motion.div>
        ) : shownIcon !== null && shownIcon !== false ? (
          <EmptyStateIcon
            tone={toneName}
            color={color}
            badge={shownBadge}
            className={classNames?.media}
            classNames={{ icon: classNames?.icon, badge: classNames?.badge }}
          >
            {shownIcon}
          </EmptyStateIcon>
        ) : null}
        {shownTitle !== null && shownTitle !== false && shownTitle !== "" && (
          <EmptyStateTitle as={titleAs} className={classNames?.title}>
            {shownTitle}
          </EmptyStateTitle>
        )}
        {shownDescription !== null && shownDescription !== false && shownDescription !== "" && (
          <EmptyStateDescription className={classNames?.description}>{shownDescription}</EmptyStateDescription>
        )}
        {children != null && children !== false && (
          <motion.div
            data-slot="empty-state-content"
            variants={context.item}
            className={cn(
              "mt-3 flex w-full flex-col gap-2",
              start ? "items-start" : "items-center",
              classNames?.content,
            )}
          >
            {children}
          </motion.div>
        )}
        {hasActions && (
          <EmptyStateActions className={classNames?.actions}>
            {actions}
            {onRetry && (
              <Button
                variant="outline"
                size={BUTTON_SIZE[scale]}
                loading={retrying}
                leftIcon={<RotateCw />}
                onClick={retry}
              >
                {retryLabel}
              </Button>
            )}
          </EmptyStateActions>
        )}
      </motion.div>
    </EmptyStateContext.Provider>
  );
}

export type EmptyStateIconProps = Omit<MotionDivProps, "children"> & {
  children?: ReactNode;
  tone?: Tone;
  color?: string;
  badge?: ReactNode;
  // overrides the empty state's size
  size?: EmptyStateSize;
  classNames?: Partial<Record<"icon" | "badge", string>>;
};

// the decorative icon tile; inside an EmptyState it follows its size and entrance
export function EmptyStateIcon({
  tone = "neutral",
  color,
  badge,
  size,
  classNames,
  className,
  style,
  children,
  ...props
}: EmptyStateIconProps) {
  const context = useEmptyState();
  const scale: EmptyStateSize = size && TILE[size] ? size : context.size;
  const toneName = toneClasses[tone] ? tone : "neutral";
  const neutral = !color && toneName === "neutral";
  return (
    <motion.div
      data-slot="empty-state-media"
      data-kind="icon"
      data-tone={color ? "custom" : toneName}
      aria-hidden
      variants={context.tile}
      className={cn(
        "relative flex shrink-0 items-center justify-center",
        toneClasses[toneName],
        neutral
          ? "bg-foreground/5 text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent)]"
          : "bg-(--tone-soft) text-(--tone-soft-foreground)",
        TILE[scale],
        className,
      )}
      style={{ ...colorVars(color), ...style }}
      {...props}
    >
      <span data-slot="empty-state-icon" className={cn("inline-flex", classNames?.icon)}>
        {children}
      </span>
      {badge ? (
        <span
          data-slot="empty-state-badge"
          className={cn(
            "absolute flex items-center justify-center rounded-full bg-(--tone) text-(--tone-foreground) shadow-raised",
            BADGE[scale],
            classNames?.badge,
          )}
        >
          {badge}
        </span>
      ) : null}
    </motion.div>
  );
}

const TITLE_TAGS = { h2: motion.h2, h3: motion.h3, h4: motion.h4, p: motion.p } as const;

export type EmptyStateTitleProps = Omit<
  ComponentProps<"h3">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  as?: EmptyStateTitleTag;
};

export function EmptyStateTitle({ as = "h3", className, ...props }: EmptyStateTitleProps) {
  const context = useEmptyState();
  const Tag = TITLE_TAGS[as] ?? motion.h3;
  return (
    <Tag
      data-slot="empty-state-title"
      variants={context.item}
      className={cn("text-balance font-semibold tracking-tight text-foreground", TITLE[context.size], className)}
      {...(props as HTMLMotionProps<"h3">)}
    />
  );
}

export type EmptyStateDescriptionProps = Omit<
  ComponentProps<"p">,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
>;

export function EmptyStateDescription({ className, ...props }: EmptyStateDescriptionProps) {
  const context = useEmptyState();
  return (
    <motion.p
      data-slot="empty-state-description"
      variants={context.item}
      className={cn("text-pretty text-muted-foreground", DESCRIPTION[context.size], className)}
      {...props}
    />
  );
}

export type EmptyStateActionsProps = ComponentProps<"div"> & {
  // renders the single child as the actions row
  asChild?: boolean;
};

const MotionSlot = motion.create(Slot);

export function EmptyStateActions({ asChild = false, className, ...props }: EmptyStateActionsProps) {
  const context = useEmptyState();
  const shared = {
    "data-slot": "empty-state-actions",
    variants: context.item,
    className: cn(
      "flex max-w-full flex-wrap gap-2",
      context.align === "start" ? "justify-start" : "justify-center",
      ACTIONS_GAP[context.size],
      STACK,
      className,
    ),
  };
  if (asChild) return <MotionSlot {...shared} {...(props as HTMLMotionProps<"div">)} />;
  return <motion.div {...shared} {...(props as HTMLMotionProps<"div">)} />;
}
