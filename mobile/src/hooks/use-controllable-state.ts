import { useCallback, useInsertionEffect, useRef, useState, type SetStateAction } from "react";

// Wingo UI · MIT License · https://wingo-ui.com/legal/license#mit

export type UseControllableStateParams<T> = {
  // pass it to control the state from outside; leave it undefined to let the hook own the state
  value?: T;
  // starting value while uncontrolled
  defaultValue: T;
  // fires with the next value whenever it changes, controlled or not
  onChange?: (value: T) => void;
};

// state that is controlled when `value` is defined and uncontrolled otherwise, with one setter for both:
//   const [open, setOpen] = useControllableState({ value: props.open, defaultValue: false, onChange: props.onOpenChange })
// the setter is stable, accepts a value or an updater, and skips onChange when nothing changed (Object.is)
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: UseControllableStateParams<T>): [T, (next: SetStateAction<T>) => void] {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : uncontrolled;

  // the latest render's values, read by the stable setter
  const latest = useRef({ current, controlled, onChange });
  useInsertionEffect(() => {
    latest.current = { current, controlled, onChange };
  });

  const setValue = useCallback((next: SetStateAction<T>) => {
    const { current: prev, controlled: isControlled, onChange: notify } = latest.current;
    const resolved = typeof next === "function" ? (next as (prev: T) => T)(prev) : next;
    if (Object.is(resolved, prev)) return;
    if (!isControlled) {
      // updaters called twice in one event build on each other, like useState
      latest.current = { ...latest.current, current: resolved };
      setUncontrolled(resolved);
    }
    notify?.(resolved);
  }, []);

  return [current, setValue];
}
