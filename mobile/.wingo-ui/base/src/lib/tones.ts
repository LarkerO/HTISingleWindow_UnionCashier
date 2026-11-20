import type { CSSProperties } from "react";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

// every component with a `tone` prop paints through the same five css vars, so a tone, a custom `color`
// and a className override all go through one path:
//   --tone                     solid fill                 bg-(--tone)
//   --tone-foreground          text / icons on the fill   text-(--tone-foreground)
//   --tone-soft                tinted surface             bg-(--tone-soft)
//   --tone-soft-foreground     tone text on the tint and on any neutral surface
//   --tone-border              outline and divider color  border-(--tone-border)
export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

export const TONES: Tone[] = ["neutral", "brand", "success", "warning", "danger", "info"];

// static strings so tailwind sees every class; spread with cn(toneClasses[tone], ...)
export const toneClasses: Record<Tone, string> = {
  neutral:
    "[--tone:var(--primary)] [--tone-foreground:var(--primary-foreground)] [--tone-soft:color-mix(in_oklab,var(--foreground)_7%,transparent)] [--tone-soft-foreground:var(--foreground)] [--tone-border:color-mix(in_oklab,var(--foreground)_16%,transparent)]",
  brand:
    "[--tone:var(--brand)] [--tone-foreground:var(--brand-foreground)] [--tone-soft:var(--brand-soft)] [--tone-soft-foreground:var(--brand-soft-foreground)] [--tone-border:color-mix(in_oklab,var(--brand)_45%,transparent)]",
  success:
    "[--tone:var(--success)] [--tone-foreground:var(--success-foreground)] [--tone-soft:var(--success-soft)] [--tone-soft-foreground:var(--success-soft-foreground)] [--tone-border:color-mix(in_oklab,var(--success)_45%,transparent)]",
  warning:
    "[--tone:var(--warning)] [--tone-foreground:var(--warning-foreground)] [--tone-soft:var(--warning-soft)] [--tone-soft-foreground:var(--warning-soft-foreground)] [--tone-border:color-mix(in_oklab,var(--warning)_55%,transparent)]",
  danger:
    "[--tone:var(--destructive)] [--tone-foreground:var(--destructive-foreground)] [--tone-soft:var(--destructive-soft)] [--tone-soft-foreground:var(--destructive-soft-foreground)] [--tone-border:color-mix(in_oklab,var(--destructive)_45%,transparent)]",
  info: "[--tone:var(--info)] [--tone-foreground:var(--info-foreground)] [--tone-soft:var(--info-soft)] [--tone-soft-foreground:var(--info-soft-foreground)] [--tone-border:color-mix(in_oklab,var(--info)_45%,transparent)]",
};

// the same five vars from any css color (hex, rgb, oklch, var(--x)), for a `color` prop. text on the fill turns
// black or white by the color's lightness; tone text is mixed toward the foreground so it stays readable in both themes.
// force the text color with className="[--tone-foreground:white]"
export function colorVars(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--tone": color,
    "--tone-foreground": `oklch(from ${color} clamp(0, (0.7 - l) * 1000, 1) 0 0)`,
    "--tone-soft": `color-mix(in oklab, ${color} 14%, transparent)`,
    "--tone-soft-foreground": `color-mix(in oklab, ${color} 72%, var(--foreground))`,
    "--tone-border": `color-mix(in oklab, ${color} 45%, transparent)`,
  } as CSSProperties;
}

// tone from a string prop (playground values, cms data), falling back to neutral
export function toTone(value: unknown, fallback: Tone = "neutral"): Tone {
  return TONES.includes(value as Tone) ? (value as Tone) : fallback;
}
