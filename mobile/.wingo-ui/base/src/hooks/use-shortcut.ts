import { useEffect, useInsertionEffect, useMemo, useRef } from "react";
import { isApple, useIsApple } from "@/hooks/use-media-query";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

// shortcuts are written as "mod+k", "shift+mod+p", "alt+n", "/", "escape". mod is ⌘ on apple devices and Ctrl
// elsewhere; ctrl, meta (cmd), alt (option) and shift can also be named directly
export type ParsedShortcut = {
  // the key, lowercased ("k", "enter", "arrowup", "/", " " for space)
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

const MODIFIERS: Record<string, "mod" | "ctrl" | "meta" | "alt" | "shift"> = {
  mod: "mod",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  super: "meta",
  win: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  ins: "insert",
  pgup: "pageup",
  pgdn: "pagedown",
  plus: "+",
};

// physical key codes, used when event.key is not a latin character (cyrillic layouts, option+letter on a mac)
const SYMBOL_CODES: Record<string, string> = {
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
};

const cache = new Map<string, ParsedShortcut | null>();

// "shift+mod+p" -> { key: "p", mod: true, shift: true, ... }; null for an empty or modifier-only string
export function parseShortcut(shortcut: string): ParsedShortcut | null {
  const source = shortcut.trim().toLowerCase();
  if (cache.has(source)) return cache.get(source)!;
  // a trailing "+" is the plus key itself: "mod++" or "+"
  const tokens = source.replace(/\+\+$/, "+plus").replace(/^\+$/, "plus").split("+");
  const parsed: ParsedShortcut = { key: "", mod: false, ctrl: false, meta: false, alt: false, shift: false };
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    const modifier = MODIFIERS[token];
    if (modifier) parsed[modifier] = true;
    else parsed.key = KEY_ALIASES[token] ?? token;
  }
  const result = parsed.key ? parsed : null;
  cache.set(source, result);
  return result;
}

const LETTER_OR_DIGIT = /^[a-z0-9]$/;
const LATIN = /^[\x20-\x7e]$/;

// the parts of a keyboard event a shortcut reads; dom and react events both fit
export type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

function matchesKey(event: ShortcutEvent, key: string) {
  const pressed = event.key.toLowerCase();
  if (pressed === key) return true;
  // event.key is not a latin character: compare the physical key instead
  if (event.key.length === 1 && LATIN.test(event.key) && !event.altKey) return false;
  if (/^[a-z]$/.test(key)) return event.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}` || event.code === `Numpad${key}`;
  const code = SYMBOL_CODES[key];
  return code ? event.code === code : false;
}

// true when the keyboard event is exactly this shortcut. apple decides what mod means (defaults to the device)
export function matchesShortcut(
  event: ShortcutEvent,
  shortcut: string | ParsedShortcut,
  apple = isApple(),
) {
  const parsed = typeof shortcut === "string" ? parseShortcut(shortcut) : shortcut;
  if (!parsed) return false;
  const ctrl = parsed.ctrl || (parsed.mod && !apple);
  const meta = parsed.meta || (parsed.mod && apple);
  if (event.ctrlKey !== ctrl || event.metaKey !== meta || event.altKey !== parsed.alt) return false;
  // letters, digits and named keys need shift to match exactly; a symbol like "?" may need shift just to be typed
  const strictShift = LETTER_OR_DIGIT.test(parsed.key) || parsed.key.length > 1;
  if (parsed.shift ? !event.shiftKey : strictShift && event.shiftKey) return false;
  return matchesKey(event, parsed.key);
}

const APPLE_KEYS: Record<string, string> = {
  enter: "↩",
  escape: "esc",
  backspace: "⌫",
  delete: "⌦",
  tab: "⇥",
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
  capslock: "⇪",
};

const OTHER_KEYS: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  backspace: "Backspace",
  delete: "Del",
  tab: "Tab",
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
  home: "Home",
  end: "End",
  capslock: "Caps Lock",
};

function keyLabel(key: string, apple: boolean) {
  const named = (apple ? APPLE_KEYS : OTHER_KEYS)[key];
  if (named) return named;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}

// one label per key, in the platform's order: apple ["⇧", "⌘", "P"], elsewhere ["Ctrl", "Shift", "P"]
export function formatShortcut(shortcut: string, apple: boolean): string[] {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return [];
  const ctrl = parsed.ctrl || (parsed.mod && !apple);
  const meta = parsed.meta || (parsed.mod && apple);
  const keys: string[] = [];
  if (apple) {
    // apple's order: control, option, shift, command
    if (ctrl) keys.push("⌃");
    if (parsed.alt) keys.push("⌥");
    if (parsed.shift) keys.push("⇧");
    if (meta) keys.push("⌘");
  } else {
    if (ctrl) keys.push("Ctrl");
    if (parsed.alt) keys.push("Alt");
    if (parsed.shift) keys.push("Shift");
    if (meta) keys.push("Win");
  }
  keys.push(keyLabel(parsed.key, apple));
  return keys;
}

// the combo as one string for menus and plain text: "⇧⌘P" on apple devices, "Ctrl+Shift+P" elsewhere
export function formatShortcutText(shortcut: string, apple: boolean) {
  return formatShortcut(shortcut, apple).join(apple ? "" : "+");
}

const ARIA_KEYS: Record<string, string> = { " ": "Space", escape: "Escape", enter: "Enter", "+": "Plus" };

// the value for aria-keyshortcuts: "Meta+K" on apple devices, "Control+Shift+P" elsewhere
export function ariaKeyShortcuts(shortcut: string, apple: boolean) {
  const parsed = parseShortcut(shortcut);
  if (!parsed) return undefined;
  const parts: string[] = [];
  if (parsed.ctrl || (parsed.mod && !apple)) parts.push("Control");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  if (parsed.meta || (parsed.mod && apple)) parts.push("Meta");
  const key = ARIA_KEYS[parsed.key] ?? (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key[0].toUpperCase() + parsed.key.slice(1));
  parts.push(key);
  return parts.join("+");
}

// focus is somewhere the user types: an input, textarea, select or contenteditable element
export function isTypingTarget(target: EventTarget | null) {
  if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["button", "checkbox", "radio", "range", "color", "file", "image", "reset", "submit"].includes(type);
}

export type UseShortcutOptions = {
  // turn the binding off without unmounting, e.g. while a dialog is closed
  enabled?: boolean;
  // fire while focus is in a text field. default: only combos with ctrl / meta / mod / alt do
  allowInInputs?: boolean;
  // call event.preventDefault() when the shortcut fires (default true)
  preventDefault?: boolean;
  // fire again while the key is held down (default false)
  repeat?: boolean;
  // listen in the capture phase, before handlers inside the page (default false)
  capture?: boolean;
};

// binds one shortcut (or several alternatives) on window while mounted. null / "" / false binds nothing, so a
// component can take a `shortcut` prop the caller clears. the handler may change every render
export function useShortcut(
  shortcut: string | readonly string[] | null | undefined | false,
  handler: (event: KeyboardEvent) => void,
  { enabled = true, allowInInputs, preventDefault = true, repeat = false, capture = false }: UseShortcutOptions = {},
) {
  const latest = useRef(handler);
  useInsertionEffect(() => {
    latest.current = handler;
  });

  const key = shortcut ? (typeof shortcut === "string" ? shortcut : shortcut.join("|")) : "";

  useEffect(() => {
    if (!enabled || !key) return;
    const parsed = key
      .split("|")
      .map(parseShortcut)
      .filter((p): p is ParsedShortcut => p !== null);
    if (!parsed.length) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || (!repeat && event.repeat)) return;
      const apple = isApple();
      const hit = parsed.find((p) => matchesShortcut(event, p, apple));
      if (!hit) return;
      const modified = hit.mod || hit.ctrl || hit.meta || hit.alt;
      if (!(allowInInputs ?? modified) && isTypingTarget(event.target)) return;
      if (preventDefault) event.preventDefault();
      latest.current(event);
    };

    window.addEventListener("keydown", onKeyDown, { capture });
    return () => window.removeEventListener("keydown", onKeyDown, { capture });
  }, [key, enabled, allowInInputs, preventDefault, repeat, capture]);
}

export type ShortcutLabel = {
  // one label per key, for separate key caps
  keys: string[];
  // the combo as one string, for menus and tooltips
  text: string;
  // for aria-keyshortcuts
  aria: string | undefined;
};

// the display form of a shortcut for the current device. renders the non-apple form on the server and during
// hydration, then swaps (see useIsApple)
export function useShortcutLabel(shortcut: string | null | undefined): ShortcutLabel {
  const apple = useIsApple();
  return useMemo(
    () =>
      shortcut
        ? {
            keys: formatShortcut(shortcut, apple),
            text: formatShortcutText(shortcut, apple),
            aria: ariaKeyShortcuts(shortcut, apple),
          }
        : { keys: [], text: "", aria: undefined },
    [shortcut, apple],
  );
}
