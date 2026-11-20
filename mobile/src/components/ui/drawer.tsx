"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
  type RefCallback,
} from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Drawer as VaulDrawer, type DialogProps as VaulRootProps } from "vaul";
import { Button } from "@/components/ui/button";
import { useControllableState } from "@/hooks/use-controllable-state";
import { useIsMobile } from "@/hooks/use-media-query";
import { fadeMaskStyle, useScrollEdges } from "@/hooks/use-scroll-edges";
import { useShortcut, useShortcutLabel } from "@/hooks/use-shortcut";
import { MotionBoundary, useMotionPreset } from "@/lib/motion";
import { useDefaults } from "@/lib/ui-config";
import { cn } from "@/lib/utils";

export type DrawerDirection = "bottom" | "top" | "left" | "right";
// what the drawer becomes at 768px and up; phones always get the sheet
export type DrawerDesktop = "sheet" | "side" | "dialog";
export type DrawerMode = DrawerDesktop;
export type DrawerSize = "sm" | "md" | "lg" | "full";
export type DrawerHeight = "auto" | "full";
export type DrawerVariant = "attached" | "floating";
export type DrawerRadius = "none" | "sm" | "md" | "lg";
export type DrawerAlign = "start" | "center";
// a fraction of the screen (0.45) or a px string ("320px")
export type DrawerSnapPoint = number | string;
export type DrawerSlot =
  | "overlay"
  | "content"
  | "handle"
  | "close"
  | "header"
  | "title"
  | "description"
  | "body"
  | "footer";

const DIRECTIONS: DrawerDirection[] = ["bottom", "top", "left", "right"];
const DESKTOPS: DrawerDesktop[] = ["sheet", "side", "dialog"];

// bottom / top sheets, left / right panels (the desktop side panel too), the centered dialog
type Layout = "sheet" | "panel" | "dialog";

const layoutOf = (mode: DrawerMode, edge: DrawerDirection): Layout =>
  mode === "dialog"
    ? "dialog"
    : mode === "side" || edge === "left" || edge === "right"
      ? "panel"
      : "sheet";

// ---------------------------------------------------------------- classes

const OVERLAY = "fixed inset-0 z-overlay bg-black/40 dark:bg-black/60";
// overlay={false} on a modal drawer: the layer stays (scroll lock, outside tap) but paints nothing
const OVERLAY_CLEAR = "bg-transparent dark:bg-transparent";

const SURFACE =
  "fixed z-modal flex flex-col bg-popover text-popover-foreground shadow-modal outline-hidden";

// vaul slides for 500ms whatever the motion setting; with reduced motion the slide and the fade stay but end fast.
// important, because vaul's css is unlayered
const VAUL_REDUCED = "motion-reduce:[animation-duration:200ms]!";

// sheet corners 0 / 16 / 24 / 28px through one var, so a className can still set any value: [--drawer-radius:20px]
const RADIUS_VARS: Record<DrawerRadius, string> = {
  none: "[--drawer-radius:0px]",
  sm: "[--drawer-radius:16px]",
  md: "[--drawer-radius:24px]",
  lg: "[--drawer-radius:28px]",
};

// dialog mode takes the surface radii of the design system (lg = rounded-3xl)
const DIALOG_RADII: Record<DrawerRadius, string> = {
  none: "rounded-none",
  sm: "rounded-[12px]",
  md: "rounded-2xl",
  lg: "rounded-3xl",
};

// vaul paints a strip of the sheet's background past its outer edge so a hard pull never shows a gap. a floating
// sheet has that gap on purpose, so it goes (after:hidden)
const SHEET_EDGES: Record<"bottom" | "top", Record<DrawerVariant, string>> = {
  bottom: {
    attached: "inset-x-0 bottom-0 rounded-t-(--drawer-radius)",
    floating:
      "inset-x-2 bottom-[calc(env(safe-area-inset-bottom)+8px)] rounded-(--drawer-radius) after:hidden",
  },
  top: {
    attached:
      "inset-x-0 top-0 rounded-b-(--drawer-radius) pt-[env(safe-area-inset-top)]",
    floating:
      "inset-x-2 top-[calc(env(safe-area-inset-top)+8px)] rounded-(--drawer-radius) after:hidden",
  },
};

// bottom / top sheets span the phone and are capped and centered from 768px
const SHEET_WIDTHS: Record<DrawerSize, string> = {
  sm: "md:mx-auto md:max-w-[420px]",
  md: "md:mx-auto md:max-w-[560px]",
  lg: "md:mx-auto md:max-w-[720px]",
  full: "",
};

const PANEL_EDGES: Record<"left" | "right", Record<DrawerVariant, string>> = {
  left: {
    attached:
      "inset-y-0 left-0 rounded-r-(--drawer-radius) pt-[env(safe-area-inset-top)]",
    floating:
      "top-[calc(env(safe-area-inset-top)+8px)] bottom-[calc(env(safe-area-inset-bottom)+8px)] left-2 rounded-(--drawer-radius) after:hidden",
  },
  right: {
    attached:
      "inset-y-0 right-0 rounded-l-(--drawer-radius) pt-[env(safe-area-inset-top)]",
    floating:
      "top-[calc(env(safe-area-inset-top)+8px)] bottom-[calc(env(safe-area-inset-bottom)+8px)] right-2 rounded-(--drawer-radius) after:hidden",
  },
};

// left / right panels leave a tappable sliver of the page on phones, except full
const PANEL_WIDTHS: Record<DrawerVariant, Record<DrawerSize, string>> = {
  attached: {
    sm: "w-[320px] max-w-[calc(100vw-48px)]",
    md: "w-[400px] max-w-[calc(100vw-48px)]",
    lg: "w-[540px] max-w-[calc(100vw-48px)]",
    full: "w-screen",
  },
  floating: {
    sm: "w-[320px] max-w-[calc(100vw-56px)]",
    md: "w-[400px] max-w-[calc(100vw-56px)]",
    lg: "w-[540px] max-w-[calc(100vw-56px)]",
    full: "w-[calc(100vw-16px)]",
  },
};

// desktop="side": a panel floating 8px off the right edge
const SIDE = "inset-y-2 right-2 rounded-(--drawer-radius) after:hidden";
const SIDE_WIDTHS: Record<DrawerSize, string> = {
  sm: "w-[320px] max-w-[calc(100vw-16px)]",
  md: "w-[400px] max-w-[calc(100vw-16px)]",
  lg: "w-[540px] max-w-[calc(100vw-16px)]",
  full: "left-2",
};

// desktop="dialog": the design system's dialog, centered with the translate property so motion's transform composes
const DIALOG =
  "left-1/2 top-1/2 w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 gap-5 p-6";
const DIALOG_SIZES: Record<DrawerSize, string> = {
  sm: "max-w-[400px]",
  md: "max-w-[520px]",
  lg: "max-w-[720px]",
  full: "inset-4 w-auto translate-x-0 translate-y-0",
};

// the handle is vaul's (tap cycles snap points, handleOnly drags from it). vaul styles it with unlayered css, which
// beats tailwind's layers, so the properties it sets carry the important modifier
const HANDLE =
  "mx-auto mt-2.5 h-1.5! w-10! shrink-0 cursor-grab rounded-full! bg-foreground/15! opacity-100! transition-colors duration-fast ease-smooth hover:bg-foreground/25! active:cursor-grabbing";

const HEADERS: Record<Layout, string> = {
  sheet:
    "flex shrink-0 flex-col gap-1 border-b border-transparent px-5 pt-5 pb-3 transition-[border-color] duration-fast ease-smooth data-scrolled:border-foreground/10 [[data-slot=drawer-handle]+&]:pt-3",
  panel:
    "flex shrink-0 flex-col gap-1.5 border-b border-transparent px-5 pt-5 pb-3 transition-[border-color] duration-fast ease-smooth data-scrolled:border-foreground/10",
  dialog: "flex shrink-0 flex-col gap-1.5",
};

// room for the close button in the corner; a centered header keeps both sides equal
const HEADER_CLOSE: Record<Layout, Record<DrawerAlign, string>> = {
  sheet: { start: "pe-14", center: "px-14" },
  panel: { start: "pe-14", center: "px-14" },
  dialog: { start: "pe-8", center: "px-8" },
};

const TITLES: Record<Layout, string> = {
  sheet: "text-[17px] leading-6 font-semibold tracking-tight",
  panel: "text-lg leading-7 font-semibold tracking-tight",
  dialog: "text-lg leading-7 font-semibold tracking-tight",
};

// a body with nothing focusable inside is a keyboard stop in chrome (to scroll it); it shows the ring then
const BODY_FOCUS =
  "outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring";

const BODIES: Record<Layout, string> = {
  sheet:
    "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-4 first:pt-5 [:is([data-slot=drawer-handle],[data-slot=drawer-title])+&]:pt-3",
  panel:
    "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1 pb-4 first:pt-5 [[data-slot=drawer-title]+&]:pt-5",
  dialog:
    "-mx-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-6",
};

// the last part of a sheet that touches the bottom edge pads the home indicator
const BODY_SAFE =
  "[&:not(:has(~[data-slot=drawer-footer]))]:pb-[max(env(safe-area-inset-bottom),16px)]";
const FOOTER_SAFE = "pb-[max(env(safe-area-inset-bottom),16px)]";

// footers list the primary action first: on top when stacked, rightmost in a row
const FOOTERS: Record<"sheet" | "side" | "dialog", string> = {
  sheet:
    "flex shrink-0 flex-col gap-2 border-t border-transparent px-5 pt-3 pb-4 transition-[border-color] duration-fast ease-smooth data-overflow:border-foreground/10",
  side: "flex shrink-0 flex-row-reverse gap-2 border-t border-transparent px-5 pt-3 pb-5 transition-[border-color] duration-fast ease-smooth data-overflow:border-foreground/10 *:min-w-0 *:flex-1",
  // fullWidth sheet buttons shrink to their label in the dialog (a DrawerClose child carries its own data-slot)
  dialog:
    "flex shrink-0 flex-row-reverse flex-wrap gap-2 [&>a]:w-auto [&>button]:w-auto",
};

// the field the dialog mode focuses on open
const FIRST_FIELD =
  "input:not([type=hidden],[type=checkbox],[type=radio],[type=button],[type=submit],[type=reset],[disabled],[readonly]),textarea:not([disabled],[readonly]),select:not([disabled])";

// ---------------------------------------------------------------- context

type DrawerContextValue = {
  mode: DrawerMode;
  // the edge the sheet comes from right now (the side panel always comes from the right)
  direction: DrawerDirection;
  open: boolean;
  // sets the state directly, also while not dismissible (close buttons, actions)
  setOpen: (open: boolean) => void;
  // the path for primitive requests (Escape, outside tap, drag): ignores closes while not dismissible
  requestOpen: (open: boolean) => void;
  dismissible: boolean;
  modal: boolean;
  snapPoints: DrawerSnapPoint[] | undefined;
  // at the last snap point (or no snap points): the body may scroll
  expanded: boolean;
  shortcut: string | undefined;
  container: HTMLElement | null | undefined;
  onAnimationEnd: ((open: boolean) => void) | undefined;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

function useDrawerContext(part: string) {
  const context = useContext(DrawerContext);
  if (!context)
    throw new Error(`<${part}> must be used inside <DrawerRoot> or <Drawer>`);
  return context;
}

type ContentContextValue = {
  layout: Layout;
  // the part at the bottom pads the safe area (an attached sheet or panel that reaches the bottom edge)
  edgeSafe: boolean;
  // a close button sits in the top corner
  close: boolean;
  // the body has more content above / below (header and footer hairlines)
  edges: { top: boolean; bottom: boolean };
  setEdges: (top: boolean, bottom: boolean) => void;
  // header, title, description, body and footer classes from the content's classNames
  classNames: Partial<Record<DrawerSlot, string>> | undefined;
};

const ContentContext = createContext<ContentContextValue | null>(null);

function useContentContext(part: string) {
  const context = useContext(ContentContext);
  if (!context)
    throw new Error(`<${part}> must be used inside <DrawerContent>`);
  return context;
}

// the parent sheet a nested drawer scales back, for opens and closes that do not go through vaul
type NestValue = { push: () => void; release: () => void };
const NestContext = createContext<NestValue | null>(null);

// the nearest drawer's state, e.g. to close it after a form saves or to lay out for the current mode
export function useDrawer() {
  const { open, setOpen, mode, direction } = useDrawerContext("useDrawer");
  return { open, setOpen, mode, direction };
}

const filled = (node: ReactNode) =>
  node !== undefined && node !== null && node !== false && node !== "";

function assignRef<T>(ref: Ref<T> | undefined, node: T | null): () => void {
  if (typeof ref === "function") {
    const cleanup = ref(node);
    return typeof cleanup === "function" ? cleanup : () => ref(null);
  }
  if (ref) ref.current = node;
  return () => {
    if (ref) ref.current = null;
  };
}

function useMergedRef<T>(
  a: Ref<T> | undefined,
  b: Ref<T> | undefined,
): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      const cleanups = [assignRef(a, node), assignRef(b, node)];
      return () => cleanups.forEach((cleanup) => cleanup());
    },
    [a, b],
  );
}

// snap points often arrive as a fresh array literal each render; vaul re-snaps on every new array, so keep one
// array per distinct list of points
function useStableSnapPoints(points: DrawerSnapPoint[] | undefined) {
  const key = points?.length
    ? points.map((p) => (typeof p === "number" ? `n${p}` : `s${p}`)).join("|")
    : "";
  return useMemo(
    () =>
      key
        ? key
            .split("|")
            .map((token) =>
              token[0] === "n" ? Number(token.slice(1)) : token.slice(1),
            )
        : undefined,
    [key],
  );
}

// ---------------------------------------------------------------- root

export type DrawerRootProps = {
  // controlled open state; pair it with onOpenChange
  open?: boolean;
  // starting state while uncontrolled; an initially open drawer skips its entrance
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  // the edge it comes from
  direction?: DrawerDirection;
  // what it becomes at 768px and up: the same sheet, a side panel from the right, or a centered dialog
  desktop?: DrawerDesktop;
  // fractions of the screen ([0.45, 1]) or px strings (["320px", 1]); a sheet with snap points is full height
  snapPoints?: DrawerSnapPoint[];
  // controlled snap point; defaults to the first one
  activeSnapPoint?: DrawerSnapPoint | null;
  onActiveSnapPointChange?: (point: DrawerSnapPoint | null) => void;
  // the snap point index from which the overlay dims (default: the last one)
  fadeFromIndex?: number;
  // false: no drag to close, no outside tap, no Escape; a close button or an action must close it
  dismissible?: boolean;
  // false: no overlay, no focus trap, the page stays usable (a map with a results sheet)
  modal?: boolean;
  // drag only from the handle (content with its own horizontal gestures)
  handleOnly?: boolean;
  // ios-style background scale; needs vaul-drawer-wrapper="" (or data-vaul-drawer-wrapper="") on the app's root element
  scaleBackground?: boolean;
  // keeps the focused field above the on-screen keyboard
  repositionInputs?: boolean;
  // a key combo in mod+k notation that toggles the drawer from anywhere on the page
  shortcut?: string;
  // portal target (default document.body); a transformed or contain:layout element keeps the sheet inside it
  container?: HTMLElement | null;
  // after the open or close animation, with the state it ended in
  onAnimationEnd?: (open: boolean) => void;
  children?: ReactNode;
};

export function DrawerRoot(drawerRootProps: DrawerRootProps) {
  const {
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    direction = "bottom",
    desktop = "sheet",
    snapPoints,
    activeSnapPoint,
    onActiveSnapPointChange,
    fadeFromIndex,
    dismissible = true,
    modal = true,
    handleOnly = false,
    scaleBackground = false,
    repositionInputs = true,
    shortcut,
    container,
    onAnimationEnd,
    children,
  } = useDefaults("drawer", drawerRootProps);
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const snaps = useStableSnapPoints(snapPoints);
  const [snap, setSnap] = useControllableState<DrawerSnapPoint | null>({
    value: activeSnapPoint,
    defaultValue: snaps?.[0] ?? null,
    onChange: onActiveSnapPointChange,
  });
  const isMobile = useIsMobile();
  const parent = useContext(NestContext);

  const mode: DrawerMode = isMobile
    ? "sheet"
    : DESKTOPS.includes(desktop)
      ? desktop
      : "sheet";
  const edge: DrawerDirection =
    mode === "side"
      ? "right"
      : DIRECTIONS.includes(direction)
        ? direction
        : "bottom";
  // snap points are ignored by the dialog, so its body always scrolls
  const expanded =
    mode === "dialog" || !snaps || snap === snaps[snaps.length - 1];

  // what vaul or radix last asked for, so the nesting effect below can tell their changes from the app's
  const requested = useRef<boolean | null>(null);
  const requestOpen = useCallback(
    (next: boolean) => {
      // vaul already ignores most closes while not dismissible, but not all of them (a tap on the handle)
      if (!next && !dismissible) return;
      requested.current = next;
      setOpen(next);
    },
    [dismissible, setOpen],
  );

  useShortcut(shortcut, () => setOpen((current) => !current || !dismissible));

  // vaul scales the parent sheet back only for opens and closes it runs itself; the rest (a controlled open, the
  // shortcut, a close while not dismissible) move the parent here
  const shown = useRef(open);
  useEffect(() => {
    if (shown.current === open) return;
    shown.current = open;
    const handled = requested.current === open;
    requested.current = null;
    if (!parent || mode === "dialog" || handled) return;
    if (open) parent.push();
    else parent.release();
  }, [open, parent, mode]);

  // back to the first snap point once closed (vaul only does this for closes it runs)
  const firstSnap = snaps?.[0];
  useEffect(() => {
    if (open || firstSnap === undefined) return;
    const timer = setTimeout(() => setSnap(firstSnap), 500);
    return () => clearTimeout(timer);
  }, [open, firstSnap, setSnap]);

  const value = useMemo<DrawerContextValue>(
    () => ({
      mode,
      direction: edge,
      open,
      setOpen,
      requestOpen,
      dismissible,
      modal,
      snapPoints: snaps,
      expanded,
      shortcut,
      container,
      onAnimationEnd,
    }),
    [
      mode,
      edge,
      open,
      setOpen,
      requestOpen,
      dismissible,
      modal,
      snaps,
      expanded,
      shortcut,
      container,
      onAnimationEnd,
    ],
  );

  if (mode === "dialog") {
    return (
      <DrawerContext.Provider value={value}>
        <DialogPrimitive.Root
          open={open}
          onOpenChange={requestOpen}
          modal={modal}
        >
          {children}
        </DialogPrimitive.Root>
      </DrawerContext.Provider>
    );
  }

  const snapProps: VaulRootProps = snaps
    ? {
        snapPoints: snaps,
        fadeFromIndex: fadeFromIndex ?? snaps.length - 1,
        activeSnapPoint: snap,
        setActiveSnapPoint: setSnap,
      }
    : {};
  // a drawer rendered inside another drawer's content nests, so the parent scales back like ios
  const Root = parent ? VaulDrawer.NestedRoot : VaulDrawer.Root;

  return (
    <DrawerContext.Provider value={value}>
      <Root
        // a new edge remounts, so it leaves and enters cleanly instead of jumping
        key={edge}
        {...snapProps}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={requestOpen}
        direction={edge}
        dismissible={dismissible}
        modal={modal}
        handleOnly={handleOnly}
        shouldScaleBackground={scaleBackground && !parent}
        repositionInputs={repositionInputs}
        container={container}
        onAnimationEnd={onAnimationEnd}
        autoFocus
      >
        {children}
      </Root>
    </DrawerContext.Provider>
  );
}

// ---------------------------------------------------------------- trigger and close

export type DrawerTriggerProps = ComponentProps<typeof DialogPrimitive.Trigger>;

export function DrawerTrigger(props: DrawerTriggerProps) {
  const { shortcut } = useDrawerContext("DrawerTrigger");
  const { aria } = useShortcutLabel(shortcut);
  return (
    <DialogPrimitive.Trigger
      data-slot="drawer-trigger"
      aria-keyshortcuts={aria}
      {...props}
    />
  );
}

export type DrawerCloseProps = ComponentProps<typeof DialogPrimitive.Close>;

export function DrawerClose({ onClick, ...props }: DrawerCloseProps) {
  const { dismissible, setOpen } = useDrawerContext("DrawerClose");
  return (
    <DialogPrimitive.Close
      data-slot="drawer-close"
      onClick={(event) => {
        onClick?.(event);
        // vaul and the root refuse close requests while not dismissible; a close button closes anyway
        if (!event.defaultPrevented && !dismissible) setOpen(false);
      }}
      {...props}
    />
  );
}

// ---------------------------------------------------------------- content

export type DrawerContentProps = ComponentProps<
  typeof DialogPrimitive.Content
> & {
  // bottom / top sheets on desktop: max width 420 / 560 / 720px / none. left / right and side: 320 / 400 / 540px /
  // the screen. dialog: 400 / 520 / 720px / 16px from every edge
  size?: DrawerSize;
  // full: 92% of the screen height (automatic with snap points)
  height?: DrawerHeight;
  // floating: 8px off the screen edges and the safe area, every corner rounded
  variant?: DrawerVariant;
  // sheet corners 0 / 16 / 24 / 28px
  radius?: DrawerRadius;
  // the drag handle of bottom and top sheets
  showHandle?: boolean;
  // a close button in the corner of bottom and top sheets; panels and dialogs always have one
  showClose?: boolean;
  // aria-label of the close button
  closeLabel?: string;
  // the dim backdrop (never there with modal={false})
  overlay?: boolean;
  // portal target; defaults to the root's container, then document.body
  container?: HTMLElement | null;
  classNames?: Partial<Record<DrawerSlot, string>>;
};

function DrawerHandle({ className }: { className?: string }) {
  const { dismissible, snapPoints, expanded, direction } =
    useDrawerContext("DrawerHandle");
  return (
    <VaulDrawer.Handle
      data-slot="drawer-handle"
      // vaul closes a non-dismissible drawer on a handle tap without snap points; tapping only cycles snap points here
      preventCycle={!dismissible && (!snapPoints || expanded)}
      className={cn(HANDLE, direction === "top" && "mt-0 mb-2.5", className)}
    />
  );
}

export function DrawerContent(drawerContentProps: DrawerContentProps) {
  const {
    size = "md",
    height = "auto",
    variant = "attached",
    radius = "lg",
    showHandle = true,
    showClose = false,
    closeLabel = "Close",
    overlay = true,
    container: containerProp,
    classNames,
    className,
    children,
    ref,
    onOpenAutoFocus,
    ...props
  } = useDefaults("drawer-content", drawerContentProps);
  const drawer = useDrawerContext("DrawerContent");
  const {
    mode,
    direction: edge,
    open,
    modal,
    dismissible,
    snapPoints,
    requestOpen,
    onAnimationEnd,
  } = drawer;
  const container =
    containerProp === undefined ? drawer.container : containerProp;
  const layout = layoutOf(mode, edge);
  const vertical = edge === "bottom" || edge === "top";
  const safeVariant: DrawerVariant =
    variant === "floating" ? "floating" : "attached";
  const safeSize: DrawerSize = size in SHEET_WIDTHS ? size : "md";
  const safeRadius: DrawerRadius = radius in RADIUS_VARS ? radius : "lg";
  // a sheet that neither drags away nor snaps has nothing to grab, so it shows no grabber (like ios)
  const handle =
    showHandle &&
    mode === "sheet" &&
    vertical &&
    (dismissible || Boolean(snapPoints));
  const close = showClose || layout !== "sheet";
  const edgeSafe =
    mode === "sheet" && safeVariant === "attached" && edge !== "top";
  const full = height === "full" || Boolean(snapPoints);
  // inside a custom container the sheet sizes against that element, not the viewport
  const contained = Boolean(container);

  const [edges, setEdgesState] = useState({ top: false, bottom: false });
  const setEdges = useCallback((top: boolean, bottom: boolean) => {
    setEdgesState((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    );
  }, []);
  const contentValue = useMemo<ContentContextValue>(
    () => ({ layout, edgeSafe, close, edges, setEdges, classNames }),
    [layout, edgeSafe, close, edges, setEdges, classNames],
  );

  const contentRef = useRef<HTMLDivElement>(null);
  const mergedRef = useMergedRef(contentRef, ref);

  // the dialog's exit also ends in onAnimationComplete, with the props of its last open render; this tells them apart
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // the same scale-back vaul applies to a parent sheet, for nested opens and closes that bypass vaul
  const nest = useMemo<NestValue>(() => {
    const apply = (pushed: boolean) => {
      const el = contentRef.current;
      if (!el) return;
      const scale = pushed ? (window.innerWidth - 16) / window.innerWidth : 1;
      const shift = pushed ? -16 : 0;
      el.style.transition = "transform 0.5s cubic-bezier(0.32, 0.72, 0, 1)";
      el.style.transform = vertical
        ? pushed || !snapPoints
          ? `scale(${scale}) translate3d(0, ${shift}px, 0)`
          : "translate3d(0, var(--snap-point-height, 0px), 0)"
        : `scale(${scale}) translate3d(${shift}px, 0, 0)`;
    };
    return { push: () => apply(true), release: () => apply(false) };
  }, [vertical, snapPoints]);

  const overlayPreset = useMotionPreset("overlay");
  const dialogPreset = useMotionPreset("dialog");

  const handleOpenAutoFocus = (event: Event) => {
    onOpenAutoFocus?.(event);
    if (event.defaultPrevented) return;
    // a non-modal sheet never takes focus from the page. a sheet focuses itself, not its first control: no field
    // pops the phone keyboard, no chip gets toggled by a stray Space, and Tab goes on from the top. the dialog focuses
    // its first text field (radix would light up the first chip or button), else itself; pass onOpenAutoFocus to
    // focus a field in a sheet
    if (!modal) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    const field =
      mode === "dialog"
        ? contentRef.current?.querySelector<HTMLElement>(FIRST_FIELD)
        : null;
    (field ?? contentRef.current)?.focus({ preventScroll: true });
  };

  const closeButton = close ? (
    <DrawerClose asChild>
      <Button
        variant="ghost"
        size="icon-sm"
        radius="full"
        aria-label={closeLabel}
        className={cn(
          "absolute end-4",
          layout === "dialog"
            ? "top-4"
            : layout === "panel"
              ? mode === "sheet" && safeVariant === "attached"
                ? "top-[calc(env(safe-area-inset-top)+18px)]"
                : "top-[18px]"
              : edge === "top"
                ? safeVariant === "attached"
                  ? "top-[calc(env(safe-area-inset-top)+16px)]"
                  : "top-4"
                : handle
                  ? "top-6"
                  : "top-4",
          classNames?.close,
        )}
      >
        <X />
      </Button>
    </DrawerClose>
  ) : null;

  const shared = {
    "data-slot": "drawer-content",
    "data-mode": mode,
    "data-direction": edge,
    "data-variant": mode === "side" ? "floating" : safeVariant,
    "data-size": safeSize,
  };

  if (mode === "dialog") {
    return (
      <MotionBoundary>
        <AnimatePresence onExitComplete={() => onAnimationEnd?.(false)}>
          {open && (
            <DialogPrimitive.Portal forceMount container={container}>
              {modal && (
                <DialogPrimitive.Overlay forceMount asChild>
                  <motion.div
                    {...overlayPreset}
                    data-slot="drawer-overlay"
                    className={cn(
                      OVERLAY,
                      !overlay && OVERLAY_CLEAR,
                      classNames?.overlay,
                    )}
                  />
                </DialogPrimitive.Overlay>
              )}
              <DialogPrimitive.Content
                forceMount
                asChild
                onOpenAutoFocus={handleOpenAutoFocus}
                {...props}
              >
                <motion.div
                  ref={mergedRef}
                  {...dialogPreset}
                  onAnimationComplete={() => {
                    if (openRef.current) onAnimationEnd?.(true);
                  }}
                  {...shared}
                  className={cn(
                    SURFACE,
                    DIALOG,
                    // size full already spans the screen minus 16px, so height has nothing to add
                    safeSize !== "full" &&
                      (height === "full"
                        ? "h-[min(85dvh,720px)]"
                        : "max-h-[min(85dvh,720px)]"),
                    DIALOG_SIZES[safeSize],
                    DIALOG_RADII[safeRadius],
                    classNames?.content,
                    className,
                  )}
                >
                  <ContentContext.Provider value={contentValue}>
                    <NestContext.Provider value={null}>
                      {children}
                    </NestContext.Provider>
                  </ContentContext.Provider>
                  {closeButton}
                </motion.div>
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          )}
        </AnimatePresence>
      </MotionBoundary>
    );
  }

  const place =
    mode === "side"
      ? cn(SIDE, SIDE_WIDTHS[safeSize])
      : vertical
        ? cn(
            SHEET_EDGES[edge as "bottom" | "top"][safeVariant],
            SHEET_WIDTHS[safeSize],
            contained
              ? full
                ? "h-[92%]"
                : "max-h-[92%]"
              : full
                ? "h-[92dvh]"
                : "max-h-[92dvh]",
          )
        : cn(
            PANEL_EDGES[edge as "left" | "right"][safeVariant],
            PANEL_WIDTHS[safeVariant][safeSize],
          );

  const sheet = (
    <VaulDrawer.Content
      ref={mergedRef}
      onOpenAutoFocus={handleOpenAutoFocus}
      {...shared}
      className={cn(
        SURFACE,
        VAUL_REDUCED,
        RADIUS_VARS[safeRadius],
        place,
        classNames?.content,
        className,
      )}
      {...props}
    >
      {handle && edge === "bottom" && (
        <DrawerHandle className={classNames?.handle} />
      )}
      <ContentContext.Provider value={contentValue}>
        <NestContext.Provider value={nest}>{children}</NestContext.Provider>
      </ContentContext.Provider>
      {handle && edge === "top" && (
        <DrawerHandle className={classNames?.handle} />
      )}
      {closeButton}
    </VaulDrawer.Content>
  );

  if (!modal) {
    // vaul keeps radix's dialog modal (focus trap, the page hidden from screen readers) even with modal={false}; a
    // non-modal radix root lets the page keep focus and stay readable. it goes around the portal, not inside it: the
    // portal waits for the exit animation of its direct child, and a root has no element to wait for
    return (
      <DialogPrimitive.Root
        open={open}
        onOpenChange={requestOpen}
        modal={false}
      >
        <VaulDrawer.Portal container={container}>
          <MotionBoundary>{sheet}</MotionBoundary>
        </VaulDrawer.Portal>
      </DialogPrimitive.Root>
    );
  }

  return (
    <VaulDrawer.Portal container={container}>
      <VaulDrawer.Overlay
        data-slot="drawer-overlay"
        className={cn(
          OVERLAY,
          VAUL_REDUCED,
          !overlay && OVERLAY_CLEAR,
          classNames?.overlay,
        )}
      />
      <MotionBoundary>{sheet}</MotionBoundary>
    </VaulDrawer.Portal>
  );
}

// ---------------------------------------------------------------- header, body, footer

export type DrawerTitleProps = ComponentProps<typeof DialogPrimitive.Title> & {
  // keeps the title for screen readers only
  visuallyHidden?: boolean;
};

export function DrawerTitle({
  visuallyHidden = false,
  className,
  ...props
}: DrawerTitleProps) {
  const content = useContext(ContentContext);
  const title = (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        TITLES[content?.layout ?? "sheet"],
        "text-balance",
        content?.classNames?.title,
        className,
      )}
      {...props}
    />
  );
  return visuallyHidden ? (
    <VisuallyHidden.Root asChild>{title}</VisuallyHidden.Root>
  ) : (
    title
  );
}

export type DrawerDescriptionProps = ComponentProps<
  typeof DialogPrimitive.Description
>;

export function DrawerDescription({
  className,
  ...props
}: DrawerDescriptionProps) {
  const slot = useContext(ContentContext)?.classNames?.description;
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", slot, className)}
      {...props}
    />
  );
}

export type DrawerHeaderProps = Omit<ComponentProps<"div">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  // keeps the title for screen readers only
  hideTitle?: boolean;
  align?: DrawerAlign;
};

export function DrawerHeader(drawerHeaderProps: DrawerHeaderProps) {
  const {
    title,
    description,
    hideTitle = false,
    align = "start",
    className,
    children,
    ...props
  } = useDefaults("drawer-header", drawerHeaderProps);
  const { layout, close, edges, classNames } =
    useContentContext("DrawerHeader");
  const hasTitle = filled(title);
  const hasDescription = filled(description);
  // nothing visible: only the title for screen readers, and no empty band under the handle
  if ((hideTitle || !hasTitle) && !hasDescription && !filled(children))
    return hasTitle ? <DrawerTitle visuallyHidden>{title}</DrawerTitle> : null;
  return (
    <div
      data-slot="drawer-header"
      data-align={align}
      data-scrolled={edges.top || undefined}
      className={cn(
        HEADERS[layout],
        align === "center" && "items-center text-center",
        close && HEADER_CLOSE[layout][align === "center" ? "center" : "start"],
        classNames?.header,
        className,
      )}
      {...props}
    >
      {hasTitle && (
        <DrawerTitle visuallyHidden={hideTitle}>{title}</DrawerTitle>
      )}
      {hasDescription && <DrawerDescription>{description}</DrawerDescription>}
      {children}
    </div>
  );
}

export type DrawerBodyProps = ComponentProps<"div">;

export function DrawerBody({
  className,
  style,
  ref,
  ...props
}: DrawerBodyProps) {
  const { expanded } = useDrawerContext("DrawerBody");
  const { layout, edgeSafe, setEdges, classNames } =
    useContentContext("DrawerBody");
  const { ref: edgesRef, edges } = useScrollEdges<HTMLDivElement>();
  const mergedRef = useMergedRef(edgesRef, ref);

  // the header and footer draw their hairlines from these
  useEffect(() => {
    setEdges(edges.top, edges.bottom);
  }, [edges.top, edges.bottom, setEdges]);
  useEffect(() => () => setEdges(false, false), [setEdges]);

  return (
    <div
      ref={mergedRef}
      data-slot="drawer-body"
      className={cn(
        BODIES[layout],
        BODY_FOCUS,
        edgeSafe && layout !== "dialog" && BODY_SAFE,
        // below the last snap point the sheet drags instead of scrolling
        !expanded && "overflow-hidden",
        classNames?.body,
        className,
      )}
      // the dialog has no hairlines, so its body fades out toward an edge with more to scroll
      style={layout === "dialog" ? { ...fadeMaskStyle("y"), ...style } : style}
      {...props}
    />
  );
}

export type DrawerFooterProps = ComponentProps<"div">;

export function DrawerFooter({ className, ...props }: DrawerFooterProps) {
  const { mode } = useDrawerContext("DrawerFooter");
  const { edgeSafe, edges, classNames } = useContentContext("DrawerFooter");
  return (
    <div
      data-slot="drawer-footer"
      data-overflow={edges.bottom || undefined}
      className={cn(
        FOOTERS[mode] ?? FOOTERS.sheet,
        edgeSafe && mode === "sheet" && FOOTER_SAFE,
        classNames?.footer,
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------- simple api

export type DrawerProps = Omit<DrawerRootProps, "children"> &
  Omit<DrawerContentProps, "children" | "title" | "onAnimationEnd"> & {
    // the element that opens it (rendered with asChild, so a single element that takes a ref)
    trigger?: ReactNode;
    title?: ReactNode;
    description?: ReactNode;
    // keeps the title for screen readers only
    hideTitle?: boolean;
    headerAlign?: DrawerAlign;
    // the body; it scrolls, and the header and footer hairlines follow it
    children?: ReactNode;
    // actions pinned under the body, primary first
    footer?: ReactNode;
  };

export function Drawer(drawerProps: DrawerProps) {
  const {
    open,
    defaultOpen = false,
    onOpenChange,
    direction = "bottom",
    desktop = "sheet",
    snapPoints,
    activeSnapPoint,
    onActiveSnapPointChange,
    fadeFromIndex,
    dismissible = true,
    modal = true,
    handleOnly = false,
    scaleBackground = false,
    repositionInputs = true,
    shortcut,
    container,
    onAnimationEnd,
    size = "md",
    height = "auto",
    variant = "attached",
    radius = "lg",
    showHandle = true,
    showClose = false,
    closeLabel = "Close",
    overlay = true,
    classNames,
    trigger,
    title,
    description,
    hideTitle = false,
    headerAlign = "start",
    footer,
    children,
    ...props
  } = useDefaults("drawer", drawerProps);
  const hasDescription = filled(description);
  return (
    <DrawerRoot
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      direction={direction}
      desktop={desktop}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      onActiveSnapPointChange={onActiveSnapPointChange}
      fadeFromIndex={fadeFromIndex}
      dismissible={dismissible}
      modal={modal}
      handleOnly={handleOnly}
      scaleBackground={scaleBackground}
      repositionInputs={repositionInputs}
      shortcut={shortcut}
      container={container}
      onAnimationEnd={onAnimationEnd}
    >
      {trigger ? <DrawerTrigger asChild>{trigger}</DrawerTrigger> : null}
      <DrawerContent
        size={size}
        height={height}
        variant={variant}
        radius={radius}
        showHandle={showHandle}
        showClose={showClose}
        closeLabel={closeLabel}
        overlay={overlay}
        classNames={classNames}
        // radix's documented opt-out when there is nothing to describe the drawer
        {...(hasDescription ? {} : { "aria-describedby": undefined })}
        {...props}
      >
        <DrawerHeader
          title={title}
          description={description}
          hideTitle={hideTitle}
          align={headerAlign}
        />
        {filled(children) ? <DrawerBody>{children}</DrawerBody> : null}
        {filled(footer) ? <DrawerFooter>{footer}</DrawerFooter> : null}
      </DrawerContent>
    </DrawerRoot>
  );
}
