"use client";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

import {
  createContext,
  isValidElement,
  useContext,
  useId,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Slot, Slottable } from "@radix-ui/react-slot";
import { colorVars, toneClasses, type Tone } from "@/lib/tones";
import { cn } from "@/lib/utils";
import { useDefaults } from "@/lib/ui-config";

export type CardVariant = "elevated" | "outline" | "soft" | "ghost";
export type CardSize = "sm" | "md" | "lg";
export type CardRadius = "none" | "sm" | "md" | "lg" | "full";
export type CardOrientation = "vertical" | "horizontal";
export type CardSlot = "media" | "content" | "header" | "title" | "description" | "action" | "body" | "footer";
export type CardMediaAspect = "video" | "square" | "4/3" | "16/10" | "auto";
export type CardMediaPosition = "top" | "start";
export type CardFooterAlign = "start" | "end" | "between";
export type { Tone as CardTone };

// padding 16 / 20 / 24px (md and lg drop a step on phones), 12 / 16 / 20px between parts. the parts read the vars,
// so media bleeds and divided footers line up at every size
const SIZES: Record<CardSize, string> = {
  sm: "[--card-padding:16px] [--card-gap:12px]",
  md: "[--card-padding:16px] [--card-gap:16px] sm:[--card-padding:20px]",
  lg: "[--card-padding:20px] [--card-gap:20px] sm:[--card-padding:24px]",
};

// the surface radii (md 16px, lg 24px); --card-radius lets inset media follow the corner
const RADII: Record<CardRadius, string> = {
  none: "rounded-none [--card-radius:0px]",
  sm: "rounded-[12px] [--card-radius:12px]",
  md: "rounded-2xl [--card-radius:16px]",
  lg: "rounded-3xl [--card-radius:24px]",
  full: "rounded-3xl [--card-radius:24px]",
};

// neutral surfaces. soft is the flat gray tile; in dark mode it is a tint, since --card is the same gray as a dark
// stage or sidebar and would vanish there. the title and description colors reset here, so a card nested in a
// tinted one is neutral again
const VARIANTS: Record<CardVariant, string> = {
  elevated: "bg-surface text-surface-foreground shadow-raised",
  outline: "border border-foreground/10",
  soft: "bg-card text-card-foreground dark:bg-foreground/7",
  ghost: "",
};
const NEUTRAL_TEXT = "[--card-title:currentcolor] [--card-muted:var(--muted-foreground)]";

// a tone other than neutral (or a custom color) tints soft and outline cards and colors their title; the
// description deepens on the tint so it keeps 4.5:1
const TINTED: Record<CardVariant, string> = {
  elevated: cn(VARIANTS.elevated, NEUTRAL_TEXT),
  outline: "border border-(--tone-border) [--card-title:var(--tone-soft-foreground)] [--card-muted:var(--muted-foreground)]",
  soft: "bg-(--tone-soft) text-foreground [--card-title:var(--tone-soft-foreground)] [--card-muted:color-mix(in_oklab,var(--foreground)_75%,transparent)]",
  ghost: NEUTRAL_TEXT,
};

// a ring in the tone for selectable cards; outline cards turn their border into the inner pixel of it
const SELECTED: Record<CardVariant, string> = {
  elevated: "data-selected:ring-2 data-selected:ring-(--tone)",
  outline: "data-selected:border-(--tone) data-selected:ring-1 data-selected:ring-(--tone)",
  soft: "data-selected:ring-2 data-selected:ring-(--tone)",
  ghost: "data-selected:ring-2 data-selected:ring-(--tone)",
};

// hover: only fires where hover exists (tailwind wraps it in @media (hover: hover)), so a tap never leaves a card
// lifted. ghost cards have no surface to lift, so they tint instead
const HOVER: Record<CardVariant, string> = {
  elevated: "hover:shadow-floating motion-safe:hover:-translate-y-0.5",
  outline: "hover:shadow-raised motion-safe:hover:-translate-y-0.5",
  soft: "hover:shadow-raised motion-safe:hover:-translate-y-0.5",
  ghost: "hover:bg-foreground/5 active:bg-foreground/7",
};

// the card dips while pressed, except while a control inside it (a like button, a menu trigger, a footer link) is the
// one pressed. radios and checkboxes are left out: a pressed label marks its input :active, and a radio card should
// still dip
const PRESS =
  "motion-safe:[&:active:not(:has(:is(button,select,textarea,[role=button],a:not([data-slot=card-link]),input:not([type=radio],[type=checkbox])):active))]:scale-[0.98]";

// the lift rides the smooth spring and the press the snappy one, both as css easings (DESIGN motion tokens), so a
// grid of fifty cards runs on the compositor with no js
const MOTION =
  "[transition:translate_var(--motion-duration-spring)_var(--motion-ease-spring),scale_var(--motion-duration-snappy)_var(--motion-ease-snappy),box-shadow_var(--motion-duration-spring)_var(--motion-ease-spring),background-color_var(--motion-duration-fast)_var(--motion-ease-out),border-color_var(--motion-duration-fast)_var(--motion-ease-out),opacity_var(--motion-duration-fast)_var(--motion-ease-out)]";
const STILL = "transition-[box-shadow,background-color,border-color,opacity] duration-normal ease-smooth";

const INTERACTIVE =
  "cursor-pointer touch-manipulation select-none [-webkit-tap-highlight-color:transparent] data-disabled:cursor-default";

// the outline sits 2px off the card and follows its radius (4px off a selected ring). a stretched CardLink or the
// hidden radio of a selectable card holds focus, so the card shows the ring for them
const FOCUS =
  "outline-hidden outline-offset-2 data-selected:outline-offset-4 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring has-[[data-slot=card-link]:focus-visible]:outline-2 has-[[data-slot=card-link]:focus-visible]:outline-solid has-[[data-slot=card-link]:focus-visible]:outline-ring has-[>input:focus-visible]:outline-2 has-[>input:focus-visible]:outline-solid has-[>input:focus-visible]:outline-ring";

// isolate keeps the stretched link's z-index inside the card; a footer at the end of a stretched card (equal
// heights in a grid row) sits on the bottom edge
const BASE =
  "group/card relative isolate flex min-w-0 flex-col gap-(--card-gap) overflow-hidden p-(--card-padding) text-start *:data-[slot=card-footer]:mt-auto data-disabled:pointer-events-none data-disabled:opacity-50";

// title / description / body type per size
const TITLES: Record<CardSize, string> = {
  sm: "text-sm/5",
  md: "text-[15px]/5",
  lg: "text-[17px]/6",
};
const TEXTS: Record<CardSize, string> = {
  sm: "text-[13px]/[18px]",
  md: "text-sm/5",
  lg: "text-[15px]/6",
};

// elements a card can be rendered as that are not controls themselves; asChild onto them keeps the card still
const STATIC_TAGS = new Set(["article", "section", "div", "li", "aside", "figure", "header", "footer", "main"]);

type CardContextValue = {
  size: CardSize;
  orientation: CardOrientation;
  // lifts on hover (and not disabled): media zooms along
  live: boolean;
  divided: boolean;
  // a stretched CardLink leaves the tab order and ignores clicks
  disabled: boolean;
  // the simple api's description, read out after a CardLink title
  descriptionId?: string;
};

const CardContext = createContext<CardContextValue | null>(null);

const has = (node: ReactNode) => node != null && node !== false && node !== "";

export type CardProps = Omit<
  ComponentProps<"div">,
  // title is the heading here, color the custom tone
  "title" | "color"
> & {
  // elevated (a raised panel), outline (a hairline frame), soft (the flat gray tile, tinted by a tone) or ghost (padding only)
  variant?: CardVariant;
  // padding 16 / 20 / 24px and the gap between parts; md and lg use one step less on phones
  size?: CardSize;
  radius?: CardRadius;
  // tints soft and outline cards and colors the selected ring
  tone?: Tone;
  // any css color; replaces the tone
  color?: string;
  // hover lift, press, pointer cursor and focus ring. on by default with onClick, with a CardLink as the title, and
  // with asChild onto a link, button or label
  interactive?: boolean;
  // a ring in the tone, for selectable cards (plans, addresses, payment methods)
  selected?: boolean;
  // dims the card and blocks pointer input
  disabled?: boolean;
  // horizontal puts the media at the start from 640px up; phones always stack
  orientation?: CardOrientation;
  // a hairline above the footer; the default for every CardFooter inside
  divided?: boolean;
  // simple api: rendered into the header, the media slot and the footer for you
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  // an image url, a CardMedia, or any node (a chart, a map) that fills the media slot
  media?: ReactNode;
  // footer content, or a CardFooter for its own align / divided
  footer?: ReactNode;
  // renders the single child (an <a>, a router Link, a <label>) as the card
  asChild?: boolean;
  classNames?: Partial<Record<CardSlot, string>>;
};

export function Card(cardProps: CardProps) {
  const {
    variant = "elevated",
    size = "md",
    radius = "md",
    tone = "neutral",
    color,
    interactive: interactiveProp,
    selected,
    disabled = false,
    orientation = "vertical",
    divided = false,
    title,
    description,
    action,
    media,
    footer,
    asChild = false,
    classNames,
    className,
    style,
    onClick,
    onKeyDown,
    onKeyUp,
    children,
    ...props
  } = useDefaults("card", cardProps);
  const look = VARIANTS[variant] !== undefined ? variant : "elevated";
  const scale = SIZES[size] ? size : "md";
  const shape = RADII[radius] ? radius : "md";
  const toneName = toneClasses[tone] ? tone : "neutral";
  const direction: CardOrientation = orientation === "horizontal" ? "horizontal" : "vertical";
  const tinted = Boolean(color) || toneName !== "neutral";
  // a card with onClick and no element of its own becomes a keyboard-reachable button (never a mute clickable div)
  const clickable = Boolean(onClick) && !asChild;
  const staticChild = isValidElement(children) && typeof children.type === "string" && STATIC_TAGS.has(children.type);
  // asChild onto a link, button or label: the card is the control, so it carries the disabled state itself
  const control = asChild && !staticChild;
  const linkTitle = isValidElement(title) && title.type === CardLink;
  const interactive = interactiveProp ?? (Boolean(onClick) || control || linkTitle);
  const live = interactive && !disabled;

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    // a disabled link card can still be activated by a script or assistive tech
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  // enter clicks on keydown and space on keyup, like a native button; keys from controls inside are theirs
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (!clickable || disabled || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.click();
    } else if (event.key === " ") {
      // no page scroll
      event.preventDefault();
    }
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyUp?.(event);
    if (!clickable || disabled || event.defaultPrevented || event.target !== event.currentTarget) return;
    if (event.key === " ") event.currentTarget.click();
  };

  const descriptionId = useId();
  const headed = has(title) || has(description) || has(action);
  const simple = headed || has(media) || has(footer);

  const renderMedia = () => {
    if (typeof media === "string") return <CardMedia src={media} className={classNames?.media} />;
    if (isValidElement(media) && media.type === CardMedia) return media;
    return (
      <CardMedia aspect="auto" className={classNames?.media}>
        {media}
      </CardMedia>
    );
  };

  // the simple api lays the parts out; the children become the body
  const layout = (body: ReactNode) => (
    <>
      {has(media) && renderMedia()}
      <CardContent className={classNames?.content}>
        {headed && (
          <CardHeader className={classNames?.header}>
            {has(title) && <CardTitle className={classNames?.title}>{title}</CardTitle>}
            {has(description) && (
              <CardDescription id={descriptionId} className={classNames?.description}>
                {description}
              </CardDescription>
            )}
            {has(action) && <CardAction className={classNames?.action}>{action}</CardAction>}
          </CardHeader>
        )}
        {has(body) && <CardBody className={classNames?.body}>{body}</CardBody>}
        {has(footer) &&
          (isValidElement(footer) && footer.type === CardFooter ? (
            footer
          ) : (
            <CardFooter className={classNames?.footer}>{footer}</CardFooter>
          ))}
      </CardContent>
    </>
  );

  const shared = {
    "data-slot": "card",
    "data-variant": look,
    "data-size": scale,
    "data-tone": color ? "custom" : toneName,
    "data-orientation": direction,
    "data-interactive": interactive || undefined,
    "data-selected": selected || undefined,
    "data-disabled": disabled || undefined,
    className: cn(
      BASE,
      toneClasses[toneName],
      SIZES[scale],
      RADII[shape],
      tinted ? TINTED[look] : [VARIANTS[look], NEUTRAL_TEXT],
      direction === "horizontal" && "sm:flex-row sm:gap-(--card-padding)",
      SELECTED[look],
      FOCUS,
      interactive ? [INTERACTIVE, MOTION, live && [HOVER[look], PRESS]] : STILL,
      className,
    ),
    style: { ...colorVars(color), ...style },
    onClick: onClick || asChild ? handleClick : undefined,
    onKeyDown: clickable ? handleKeyDown : onKeyDown,
    onKeyUp: clickable ? handleKeyUp : onKeyUp,
  };

  const context: CardContextValue = {
    size: scale,
    orientation: direction,
    live,
    divided,
    disabled,
    descriptionId: has(description) ? descriptionId : undefined,
  };

  if (asChild) {
    return (
      <CardContext.Provider value={context}>
        <Slot
          {...shared}
          aria-disabled={(control && disabled) || undefined}
          tabIndex={control && disabled ? -1 : undefined}
          {...props}
        >
          {simple ? <Slottable child={children}>{(content) => layout(content)}</Slottable> : children}
        </Slot>
      </CardContext.Provider>
    );
  }

  return (
    <CardContext.Provider value={context}>
      <div
        {...shared}
        {...(clickable && {
          role: "button",
          tabIndex: disabled ? -1 : 0,
          "aria-disabled": disabled || undefined,
          // a selectable card announces its state as a toggle button
          "aria-pressed": selected,
        })}
        {...props}
      >
        {simple ? layout(children) : children}
      </div>
    </CardContext.Provider>
  );
}

// ---------------------------------------------------------------- media

// controls laid directly in the media or the footer sit above a stretched CardLink, so a like or a call button keeps
// working while a click anywhere else follows the link (footer children are flex items, overlays are positioned, so
// z-index applies to both)
const ABOVE_LINK = "[&>:where(a,button,input,select,textarea,[role=button]):not([data-slot=card-link])]:z-[2]";

const ASPECTS: Record<CardMediaAspect, string> = {
  video: "aspect-video",
  square: "aspect-square",
  "4/3": "aspect-[4/3]",
  "16/10": "aspect-[16/10]",
  auto: "",
};

// media bleeds to the card edges through negative margins of the card padding: top media on the top edge (and the
// bottom edge when it comes last), start media on the top, bottom and start edges from 640px up
const BLEED: Record<CardMediaPosition, string> = {
  top: "-mx-(--card-padding) first:-mt-(--card-padding) last:-mb-(--card-padding)",
  start:
    "max-sm:-mx-(--card-padding) max-sm:first:-mt-(--card-padding) sm:-my-(--card-padding) sm:-ms-(--card-padding) sm:min-h-40 sm:w-2/5 sm:self-stretch sm:aspect-auto",
};

// inset media keeps the padding and takes the card radius minus it (8px at least, 0 on square cards)
const INSET: Record<CardMediaPosition, string> = {
  top: "rounded-[max(min(var(--card-radius),8px),calc(var(--card-radius)-var(--card-padding)))]",
  start:
    "rounded-[max(min(var(--card-radius),8px),calc(var(--card-radius)-var(--card-padding)))] sm:min-h-36 sm:w-2/5 sm:self-stretch sm:aspect-auto",
};

export type CardMediaProps = Omit<ComponentProps<"div">, "children"> & {
  // image url, drawn with object-cover
  src?: string;
  // "" (decorative) unless the image says something the text does not
  alt?: string;
  // the box ratio; auto takes the content's own height
  aspect?: CardMediaAspect;
  // top or start; inferred from the card's orientation
  position?: CardMediaPosition;
  // keep the card padding around the media and round its corners, instead of bleeding to the edges
  inset?: boolean;
  // in an interactive card the image scales up a touch on hover
  zoom?: boolean;
  loading?: "lazy" | "eager";
  // overlays on the image (a badge, a like button), or the media itself when there is no src
  children?: ReactNode;
  classNames?: Partial<Record<"image", string>>;
};

export function CardMedia(cardMediaProps: CardMediaProps) {
  const {
    src,
    alt = "",
    aspect = "16/10",
    position,
    inset = false,
    zoom = true,
    loading = "lazy",
    classNames,
    className,
    children,
    ...props
  } = useDefaults("card-media", cardMediaProps);
  const card = useContext(CardContext);
  const where: CardMediaPosition = position ?? (card?.orientation === "horizontal" ? "start" : "top");
  const ratio: CardMediaAspect = ASPECTS[aspect] !== undefined ? aspect : "16/10";
  const auto = ratio === "auto";

  return (
    <div
      data-slot="card-media"
      data-position={where}
      data-aspect={ratio}
      data-inset={inset || undefined}
      className={cn(
        "relative shrink-0 overflow-hidden bg-foreground/5",
        ABOVE_LINK,
        ASPECTS[ratio],
        inset ? INSET[where] : BLEED[where],
        className,
      )}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-slot="card-media-image"
          src={src}
          alt={alt}
          loading={loading}
          decoding="async"
          draggable={false}
          className={cn(
            "size-full object-cover",
            // an auto box grows with the image; a sized one (or a start column) is covered by it
            auto ? "block h-auto" : "absolute inset-0",
            auto && where === "start" && "sm:absolute sm:inset-0 sm:h-full",
            card?.live &&
              zoom &&
              "transition-transform duration-slow ease-smooth motion-safe:group-hover/card:scale-[1.04]",
            classNames?.image,
          )}
        />
      ) : null}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- content, header, body, footer

// the column next to start media in a horizontal card; the simple api always renders it
export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-(--card-gap) *:data-[slot=card-footer]:mt-auto",
        className,
      )}
      {...props}
    />
  );
}

// title and description on the start, the action at the end: centered on a single line, top-aligned (spanning
// both rows) when there is a title and a description
const HEADER =
  "grid min-w-0 grid-cols-1 items-center gap-x-3 gap-y-1 has-[>[data-slot=card-action]]:grid-cols-[minmax(0,1fr)_auto] [&:has(>[data-slot=card-title]):has(>[data-slot=card-description])]:items-start [&:has(>[data-slot=card-title]):has(>[data-slot=card-description])>[data-slot=card-action]]:row-end-3";

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn(HEADER, className)} {...props} />;
}

export type CardTitleProps = ComponentProps<"h3"> & {
  // render your own heading level (<h2>) or element
  asChild?: boolean;
};

export function CardTitle({ asChild = false, className, ...props }: CardTitleProps) {
  const card = useContext(CardContext);
  const Comp = asChild ? Slot : "h3";
  return (
    <Comp
      data-slot="card-title"
      className={cn(
        "min-w-0 font-semibold tracking-tight text-[color:var(--card-title,currentcolor)]",
        TITLES[card?.size ?? "md"],
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  const card = useContext(CardContext);
  return (
    <p
      data-slot="card-description"
      className={cn(
        "min-w-0 text-[color:var(--card-muted,var(--muted-foreground))]",
        card?.size === "sm" ? "text-[13px]/[18px]" : "text-sm/5",
        className,
      )}
      {...props}
    />
  );
}

// a control in the header's end column (a menu, a like, a badge). it stays clickable above a stretched CardLink
export function CardAction({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("relative z-[2] col-start-2 row-start-1 flex items-center gap-1 justify-self-end", className)}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  const card = useContext(CardContext);
  return <div data-slot="card-body" className={cn("min-w-0", TEXTS[card?.size ?? "md"], className)} {...props} />;
}

const ALIGN: Record<CardFooterAlign, string> = {
  start: "justify-start",
  end: "justify-end",
  between: "justify-between",
};

// a divided footer's hairline runs edge to edge; next to start media it stops at the media
const DIVIDED: Record<CardOrientation, string> = {
  vertical: "-mx-(--card-padding) border-t border-foreground/10 px-(--card-padding) pt-(--card-padding)",
  horizontal:
    "max-sm:-mx-(--card-padding) max-sm:px-(--card-padding) sm:-me-(--card-padding) sm:pe-(--card-padding) border-t border-foreground/10 pt-(--card-padding)",
};

export type CardFooterProps = ComponentProps<"div"> & {
  // a hairline above the footer; defaults to the card's divided
  divided?: boolean;
  align?: CardFooterAlign;
};

export function CardFooter({ divided: dividedProp, align = "end", className, ...props }: CardFooterProps) {
  const card = useContext(CardContext);
  const divided = dividedProp ?? card?.divided ?? false;
  const where = ALIGN[align] ? align : "end";
  return (
    <div
      data-slot="card-footer"
      data-align={where}
      data-divided={divided || undefined}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-2",
        ABOVE_LINK,
        ALIGN[where],
        divided && DIVIDED[card?.orientation ?? "vertical"],
        className,
      )}
      {...props}
    />
  );
}

// ---------------------------------------------------------------- stretched link

export type CardLinkProps = ComponentProps<"a"> & {
  // render a router Link (or any anchor component) as the stretched link
  asChild?: boolean;
};

// the title link whose ::after covers the whole card, so the card opens on a click anywhere (with native new-tab,
// middle-click and long-press menus) while controls stay separate: CardAction and the direct controls of CardMedia and
// CardFooter sit above it; give anything else relative z-[2]. as the title prop it turns interactive on by itself
export function CardLink({ asChild = false, className, onClick, ...props }: CardLinkProps) {
  const card = useContext(CardContext);
  const disabled = card?.disabled ?? false;
  const Comp = asChild ? Slot : "a";

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    // aria-disabled does not stop a link: a script or assistive tech can still activate it
    if (disabled) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <Comp
      data-slot="card-link"
      aria-disabled={disabled || undefined}
      aria-describedby={card?.descriptionId}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        "outline-hidden [-webkit-tap-highlight-color:transparent] after:absolute after:inset-0 after:z-[1]",
        className,
      )}
      onClick={handleClick}
      {...props}
    />
  );
}
