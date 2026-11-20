"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { CircleAlert, CircleCheck, Info, Sparkles, TriangleAlert, X } from "lucide-react";
import { Button, type ButtonProps, type ButtonVariant } from "@/components/ui/button";
import { useControllableState } from "@/hooks/use-controllable-state";
import { presets, useMotionPreset, usePrefersReducedMotion, type MotionPreset } from "@/lib/motion";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults } from "@/lib/ui-config";

export type AlertVariant = "soft" | "outline" | "solid";
export type AlertSize = "sm" | "md";
export type AlertRadius = "none" | "sm" | "md" | "lg" | "full";
export type AlertRole = "alert" | "status" | "none";
export type AlertSlot = "wrapper" | "container" | "icon" | "content" | "title" | "description" | "actions" | "close";
export type { Tone as AlertTone };

// every variant paints through the --tone-* vars (lib/tones), so tones and a custom color need no extra classes.
// on a solid fill the focus ring of the actions and the close button takes the fill's text color: the orange ring
// would vanish on a brand or danger fill
const VARIANTS: Record<AlertVariant, string> = {
  soft: "bg-(--tone-soft) text-foreground",
  outline: "border border-(--tone-border) text-foreground",
  solid: "bg-(--tone) text-(--tone-foreground) [--ring:var(--tone-foreground)]",
};

// the icon and the title carry the tone; on a solid fill they keep the fill's own text color
const ACCENT: Record<AlertVariant, string> = {
  soft: "text-(--tone-soft-foreground)",
  outline: "text-(--tone-soft-foreground)",
  solid: "text-(--tone-foreground)",
};

const BODY: Record<AlertVariant, string> = {
  soft: "text-foreground/80",
  outline: "text-foreground/80",
  solid: "text-(--tone-foreground)/85",
};

const SURFACE_RADII: Record<AlertRadius, string> = {
  none: "rounded-none",
  sm: "rounded-[12px]",
  md: "rounded-2xl",
  lg: "rounded-3xl",
  full: "rounded-3xl",
};

const PADDING: Record<AlertSize, string> = { md: "p-4", sm: "p-3" };
const BANNER_PADDING: Record<AlertSize, string> = { md: "px-4 py-3", sm: "px-4 py-2" };
const GAPS: Record<AlertSize, string> = { md: "gap-3", sm: "gap-2.5" };

// one line height per size; the icon box and the close button center on it, so a title-less alert still lines up
const TEXT: Record<AlertSize, string> = { md: "text-sm/5", sm: "text-[13px]/[18px]" };
const ICON_BOX: Record<AlertSize, string> = {
  md: "size-5 [&_svg:not([class*='size-'])]:size-5",
  sm: "h-[18px] w-4 [&_svg:not([class*='size-'])]:size-4",
};
// the 32px close button sits on the first line without making a one-line alert taller
const CLOSE: Record<AlertSize, string> = { md: "-my-1.5 -me-1.5", sm: "-my-[7px] -me-1" };
// on a phone two or more actions use the alert's full inner width, reaching under the icon (its box plus the gap)
// and under the close button (its 32px minus the pull, plus the gap), and share it like a native button bar
const LEAD: Record<AlertSize, string> = {
  md: "max-sm:has-[>:nth-child(2)]:-ms-8",
  sm: "max-sm:has-[>:nth-child(2)]:-ms-[26px]",
};
const TRAIL = "max-sm:has-[>:nth-child(2)]:-me-[38px]";

const ICONS: Record<Tone, ComponentType> = {
  neutral: Info,
  brand: Sparkles,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
  info: Info,
};

// errors and warnings interrupt a screen reader, everything else waits its turn
const ROLES: Record<Tone, "alert" | "status"> = {
  neutral: "status",
  brand: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
  info: "status",
};

// action buttons on a solid fill flip to the fill's text color, so they read in every tone and custom color
const INVERSE: Record<ButtonVariant, string> = {
  solid: "bg-(--tone-foreground) text-(--tone)",
  soft: "bg-(--tone-foreground)/15 text-(--tone-foreground)",
  outline: "border-(--tone-foreground)/40 text-(--tone-foreground)",
  ghost: "text-(--tone-foreground)",
  link: "text-(--tone-foreground)",
};

// the parent's row gap, and whether the alert has mounted (only an alert that was already there expands its space)
type CollapseState = { gap: number; mounted: boolean };

// dismissing collapses the wrapper so the content below slides up. the negative margin swallows the parent's gap
// (flex column or grid), so nothing snaps when the wrapper unmounts. a fresh alert keeps its space and only fades in,
// so a page that renders one never shifts; reopening a mounted one expands it back
const COLLAPSE: Variants = {
  closed: (state: RefObject<CollapseState>) =>
    state.current.mounted ? { height: 0, marginTop: -state.current.gap } : { height: "auto", marginTop: 0 },
  open: { height: "auto", marginTop: 0, transition: presets.collapse.transition },
  exit: (state: RefObject<CollapseState>) => ({
    height: 0,
    marginTop: -state.current.gap,
    transition: presets.collapse.exit.transition,
  }),
};

// false on the server and during hydration, true for anything rendered on the client after that: server-rendered
// alerts show up as they are, alerts that appear later (a failed submit) fade in
const subscribeNever = () => () => {};
function useHydrated() {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

// the content fades in with presets.fade and fades out on the collapse's own timing, so no empty band slides up
const FADE: MotionPreset = {
  ...presets.fade,
  exit: { ...presets.fade.exit, transition: presets.collapse.exit.transition },
};

// the row gap the alert takes up in its parent; 0 outside a flex column or grid, or when it is the only child
function parentGap(element: HTMLElement | null) {
  const parent = element?.parentElement;
  if (!parent || parent.children.length < 2) return 0;
  const css = getComputedStyle(parent);
  const stacked = css.display.endsWith("grid") || (css.display.endsWith("flex") && css.flexDirection.startsWith("column"));
  return stacked ? parseFloat(css.rowGap) || 0 : 0;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const TEXT_ENTRY = 'input:not([type="button"],[type="submit"],[type="reset"],[type="checkbox"],[type="radio"],[type="range"],[type="color"],[type="file"]), textarea, [contenteditable]:not([contenteditable="false"])';

// the first focusable element after the alert, or the last one before it. after a tap (no focus ring) a text field is
// skipped: focusing it would pop the phone keyboard open just because the alert was closed
function handOffFocus(element: HTMLElement) {
  const keyboard = document.activeElement instanceof HTMLElement && document.activeElement.matches(":focus-visible");
  const all = [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !element.contains(el) && el.getClientRects().length > 0,
  );
  const next = all.find((el) => element.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  const target = next ?? all.filter((el) => element.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING).pop();
  if (target && (keyboard || !target.matches(TEXT_ENTRY))) target.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

type AlertContextValue = {
  size: AlertSize;
  variant: AlertVariant;
  banner: boolean;
  tone: Tone;
  color?: string;
  // an icon before the text and a close button after it, which the actions reach under on phones
  lead: boolean;
  trail: boolean;
};

const AlertContext = createContext<AlertContextValue>({
  size: "md",
  variant: "soft",
  banner: false,
  tone: "neutral",
  lead: false,
  trail: false,
});

const has = (node: ReactNode) => node !== undefined && node !== null && node !== false && node !== "";

export type AlertProps = Omit<
  ComponentProps<"div">,
  // title is the headline here, role is picked per tone; motion.div owns the drag and animation handler names
  "title" | "color" | "role" | "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart"
> & {
  // danger for errors, warning for attention, success for done, info for tips
  tone?: Tone;
  // any css color; replaces the tone
  color?: string;
  // soft tint, outline, or a solid fill for urgent banners
  variant?: AlertVariant;
  title?: ReactNode;
  description?: ReactNode;
  // defaults to an icon per tone; null hides it
  icon?: ReactNode;
  // buttons under the text, usually AlertAction
  actions?: ReactNode;
  // shows a close button that collapses the alert
  dismissible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  closeLabel?: string;
  // md for page and section messages, sm for inline form messages
  size?: AlertSize;
  radius?: AlertRadius;
  // full-bleed page banner: no radius, a bottom border, content centered, one line once it is 672px wide
  banner?: boolean;
  // alert for danger and warning, status otherwise; none adds no live region
  role?: AlertRole;
  classNames?: Partial<Record<AlertSlot, string>>;
};

export function Alert(alertProps: AlertProps) {
  const {
    tone = "neutral",
    color,
    variant = "soft",
    size = "md",
    radius = "md",
    title,
    description,
    icon,
    actions,
    dismissible = false,
    open: openProp,
    defaultOpen = true,
    onOpenChange,
    closeLabel = "Dismiss",
    banner = false,
    role,
    classNames,
    className,
    style,
    children,
    ...props
  } = useDefaults("alert", alertProps);
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const reduced = usePrefersReducedMotion();
  const hydrated = useHydrated();
  const fade = useMotionPreset(FADE);
  const wrapper = useRef<HTMLDivElement>(null);
  const collapse = useRef<CollapseState>({ gap: 0, mounted: false });

  useEffect(() => {
    collapse.current.mounted = true;
  }, []);

  // measured while open (and again on dismiss, siblings may have come and gone), read when the collapse starts
  useEffect(() => {
    if (open) collapse.current.gap = parentGap(wrapper.current);
    // closing with focus inside (the close button, an action) would drop it on <body>: hand it to the next control
    else if (wrapper.current?.contains(document.activeElement)) handOffFocus(wrapper.current);
  }, [open]);

  const dismiss = () => {
    collapse.current.gap = parentGap(wrapper.current);
    if (wrapper.current?.contains(document.activeElement)) handOffFocus(wrapper.current);
    setOpen(false);
  };

  const safeTone: Tone = toneClasses[tone] ? tone : "neutral";
  const safeVariant: AlertVariant = VARIANTS[variant] ? variant : "soft";
  const safeSize: AlertSize = PADDING[size] ? size : "md";
  const resolvedRole = role ?? ROLES[safeTone];
  const DefaultIcon = ICONS[safeTone];
  const iconNode = icon === undefined ? <DefaultIcon /> : icon;

  const lead = has(iconNode);
  const context = useMemo(
    () => ({ size: safeSize, variant: safeVariant, banner, tone: safeTone, color, lead, trail: dismissible }),
    [safeSize, safeVariant, banner, safeTone, color, lead, dismissible],
  );

  const body = (
    <>
      {lead && (
        <span
          data-slot="alert-icon"
          aria-hidden
          className={cn("flex shrink-0 items-center justify-center", ICON_BOX[safeSize], ACCENT[safeVariant], classNames?.icon)}
        >
          {iconNode}
        </span>
      )}
      <div
        data-slot="alert-content"
        className={cn(
          // anywhere, not break-word: a long url also stops widening the alert in a flex row or an auto grid column
          "flex min-w-0 flex-1 flex-col gap-1 wrap-anywhere",
          banner && "@2xl/alert:flex-row @2xl/alert:flex-wrap @2xl/alert:items-center @2xl/alert:gap-x-3 @2xl/alert:gap-y-1",
          classNames?.content,
        )}
      >
        {has(title) && <AlertTitle className={classNames?.title}>{title}</AlertTitle>}
        {has(description) && <AlertDescription className={classNames?.description}>{description}</AlertDescription>}
        {children}
        {has(actions) && <AlertActions className={classNames?.actions}>{actions}</AlertActions>}
      </div>
      {dismissible && (
        <Button
          data-slot="alert-close"
          variant="ghost"
          tone={safeTone}
          color={color}
          size="icon-sm"
          radius="full"
          aria-label={closeLabel}
          onClick={dismiss}
          className={cn(
            "shrink-0",
            CLOSE[safeSize],
            safeVariant === "solid"
              ? "text-(--tone-foreground)/80 hover:text-(--tone-foreground)"
              : "text-muted-foreground hover:text-foreground",
            classNames?.close,
          )}
        >
          <X className={safeSize === "sm" ? "size-3.5" : "size-4"} />
        </Button>
      )}
    </>
  );

  return (
    <AlertContext value={context}>
      {/* server-rendered alerts show up at once; anything that appears after hydration fades in */}
      <AnimatePresence initial={hydrated} custom={collapse}>
        {open && (
          <motion.div
            ref={wrapper}
            key="alert"
            data-slot="alert-wrapper"
            {...(reduced ? {} : { variants: COLLAPSE, custom: collapse, initial: "closed", animate: "open", exit: "exit" })}
            // clipped only while the height moves, so a shadow or focus ring on the alert is never cut off. set by hand:
            // a transitionEnd can be lost when the open animation restarts
            onAnimationStart={() => {
              if (wrapper.current) wrapper.current.style.overflow = "hidden";
            }}
            onAnimationComplete={(definition) => {
              if (definition === "open" && wrapper.current) wrapper.current.style.overflow = "";
            }}
            className={cn("w-full", classNames?.wrapper)}
          >
            <motion.div
              {...fade}
              data-slot="alert"
              data-variant={safeVariant}
              data-tone={color ? "custom" : safeTone}
              data-size={safeSize}
              data-banner={banner || undefined}
              role={resolvedRole === "none" ? undefined : resolvedRole}
              className={cn(
                "relative w-full text-start",
                toneClasses[safeTone],
                VARIANTS[safeVariant],
                banner
                  ? // the banner lays out by its own width, so it stacks in a narrow panel and goes one-line across a page
                    ["@container/alert rounded-none border-0 border-b border-(--tone-border)", BANNER_PADDING[safeSize]]
                  : ["flex items-start", GAPS[safeSize], PADDING[safeSize], SURFACE_RADII[radius] ?? SURFACE_RADII.md],
                className,
              )}
              style={{ ...colorVars(color), ...style }}
              {...props}
            >
              {banner ? (
                <div
                  data-slot="alert-container"
                  className={cn(
                    "mx-auto flex w-full max-w-5xl items-start @2xl/alert:items-center",
                    GAPS[safeSize],
                    classNames?.container,
                  )}
                >
                  {body}
                </div>
              ) : (
                body
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AlertContext>
  );
}

export type AlertTitleProps = ComponentProps<"div">;

export function AlertTitle({ className, ...props }: AlertTitleProps) {
  const { size, variant } = useContext(AlertContext);
  return <div data-slot="alert-title" className={cn(TEXT[size], "font-semibold", ACCENT[variant], className)} {...props} />;
}

export type AlertDescriptionProps = ComponentProps<"div">;

export function AlertDescription({ className, ...props }: AlertDescriptionProps) {
  const { size, variant, banner } = useContext(AlertContext);
  return (
    <div
      data-slot="alert-description"
      className={cn(
        TEXT[size],
        BODY[variant],
        // links in the message stay underlined: color alone does not mark them, and touch has no hover
        "[&_a]:font-medium [&_a]:underline [&_a]:decoration-current/40 [&_a]:underline-offset-4 [&_a:hover]:decoration-current",
        banner && "@2xl/alert:min-w-48 @2xl/alert:flex-1",
        className,
      )}
      {...props}
    />
  );
}

export type AlertActionsProps = ComponentProps<"div">;

export function AlertActions({ className, ...props }: AlertActionsProps) {
  const { banner, size, lead, trail } = useContext(AlertContext);
  return (
    <div
      data-slot="alert-actions"
      className={cn(
        "mt-2 flex flex-wrap items-center gap-2 max-sm:[&>*:not(:only-child)]:grow",
        lead && LEAD[size],
        trail && TRAIL,
        banner && "@2xl/alert:ms-auto @2xl/alert:mt-0 @2xl/alert:shrink-0 @2xl/alert:flex-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export type AlertActionProps = ButtonProps;

// a button that matches its alert: the alert's tone by default, inverted on a solid fill
export function AlertAction(alertActionProps: AlertActionProps) {
  const { variant = "solid", size = "sm", tone, color, className, ...props } = useDefaults("alert-action", alertActionProps);
  const alert = useContext(AlertContext);
  return (
    <Button
      data-slot="alert-action"
      variant={variant}
      size={size}
      tone={tone ?? alert.tone}
      color={color ?? alert.color}
      className={cn(alert.variant === "solid" && INVERSE[variant], className)}
      {...props}
    />
  );
}
