import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import './chips.css';

interface Option<T extends string> {
  value: T;
  label: string;
}

export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = options.findIndex((o) => o.value === value);
  const tabbable = checked >= 0 ? checked : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = options.length;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  };

  return (
    <div role="radiogroup" aria-label={label} className="chip-group">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={i === checked}
          tabIndex={i === tabbable ? 0 : -1}
          className="chip"
          ref={(el) => {
            refs.current[i] = el;
          }}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ToggleChip({
  pressed,
  onToggle,
  children,
}: {
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onToggle}>
      {children}
    </button>
  );
}

export function MenuChip({
  label,
  valueLabel,
  options,
  value,
  onChange,
  disabled,
  allLabel,
}: {
  label: string;
  valueLabel: string | null;
  options: Option<string>[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const items: Option<string>[] = [{ value: '', label: allLabel }, ...options];
  // Options can change while the menu is open (e.g. data refetch); keep the active index in range.
  const current = Math.min(active, items.length - 1);
  const itemsKey = JSON.stringify(items.map((o) => o.value));

  const openMenu = () => {
    if (disabled) return;
    setActive(Math.max(0, items.findIndex((o) => o.value === value)));
    setTop((buttonRef.current?.getBoundingClientRect().bottom ?? 0) + 4);
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (v: string) => {
    onChange(v);
    close(true);
  };

  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true }); // a focus scroll would close the menu
  }, [open]);

  // When the options change, follow the selected value if it is still listed, else clamp.
  useEffect(() => {
    const selected = items.findIndex((o) => o.value === value);
    setActive((a) => (selected >= 0 ? selected : Math.min(a, items.length - 1)));
  }, [itemsKey]); // only when the option values change, not on every render

  // A fixed-position popup would drift from its button; close on scroll (any scroller) or resize.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      // Scrolling the option list itself is fine; anything else moves the button.
      if (!(e.target instanceof Node && rootRef.current?.contains(e.target))) setOpen(false);
    };
    const onResize = () => setOpen(false);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (open) close(false);
      else openMenu();
    }
  };

  const onListKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const n = items.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((a) => Math.min(a + 1, n - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(n - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (items[current]) pick(items[current].value);
        break;
      case 'Escape':
        e.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(true);
        break;
    }
  };

  return (
    <div className="menu-chip" ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className="chip"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        disabled={disabled}
        data-active={valueLabel ? 'true' : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onButtonKey}
      >
        {valueLabel ? `${label}: ${valueLabel}` : label}
        <span aria-hidden="true" className="menu-chip-caret">
          &#9662;
        </span>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-opt-${current}`}
          className="menu-chip-list"
          style={{ '--menu-top': `${top}px` } as CSSProperties}
          onKeyDown={onListKey}
        >
          {items.map((o, i) => (
            <li
              key={o.value || '__all'}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={i === current ? 'menu-chip-option is-active' : 'menu-chip-option'}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
