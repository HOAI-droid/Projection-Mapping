import { useEffect, useRef, type ReactNode } from 'react';

/** Button, der beim Gedrückthalten wiederholt auslöst (für Pfeiltasten). */
export function RepeatButton(props: { onFire: () => void; className?: string; label: string; children: ReactNode }) {
  const timer = useRef<number | undefined>(undefined);
  const fire = useRef(props.onFire);
  fire.current = props.onFire;

  const stop = () => {
    window.clearTimeout(timer.current);
    window.clearInterval(timer.current);
    timer.current = undefined;
  };
  useEffect(() => stop, []);

  return (
    <button
      type="button"
      className={props.className}
      aria-label={props.label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fire.current();
        stop();
        timer.current = window.setTimeout(() => {
          timer.current = window.setInterval(() => fire.current(), 70);
        }, 400);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.children}
    </button>
  );
}
