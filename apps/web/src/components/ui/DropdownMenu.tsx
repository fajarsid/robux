'use client';

import Link from 'next/link';
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { Icon, type IconName } from './Icon';

export type DropdownItem =
  | {
      label: string;
      icon?: IconName;
      onSelect: () => void;
      tone?: 'default' | 'danger';
      disabled?: boolean;
      /** Marks the current choice in a single-select menu (e.g. theme). */
      selected?: boolean;
    }
  | { label: string; icon?: IconName; href: string };

interface DropdownMenuProps {
  /** Renders the trigger; spread `props` onto a button (IconButton, Button or custom). */
  trigger: (props: {
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  }) => ReactNode;
  items: DropdownItem[];
  /** Optional non-interactive header (e.g. the signed-in account). */
  header?: ReactNode;
  align?: 'start' | 'end';
  /** Accessible name of the menu. */
  label: string;
}

/**
 * Action and choice menus. Arrow keys move between items, Escape closes and returns focus to the
 * trigger, a click outside closes. Items are links or callbacks; destructive items are `danger`.
 */
export function DropdownMenu({ trigger, items, header, align = 'end', label }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const focusItem = useCallback((index: number) => {
    const elements = containerRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    );
    if (elements && elements.length > 0) {
      elements[(index + elements.length) % elements.length]?.focus();
    }
  }, []);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    focusItem(0);
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, focusItem, close]);

  function onMenuKeyDown(event: KeyboardEvent) {
    const elements = [
      ...(containerRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? []),
    ];
    const current = elements.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(current + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(current - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(elements.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  }

  const itemClass = (tone: 'default' | 'danger' = 'default') =>
    `flex w-full items-center gap-2.5 rounded-panel px-3 py-2 text-left text-sm outline-none transition-colors focus:bg-muted hover:bg-muted disabled:opacity-50 ${
      tone === 'danger' ? 'text-danger' : 'text-foreground'
    }`;

  return (
    <div ref={containerRef} className="relative inline-flex">
      <span
        className="contents"
        ref={(node) => {
          triggerRef.current = (node?.firstElementChild as HTMLElement | null) ?? null;
        }}
      >
        {trigger({
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': menuId,
          onClick: () => setOpen((value) => !value),
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault();
              setOpen(true);
            }
          },
        })}
      </span>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-40 mt-2 w-60 rounded-panel border border-border bg-surface p-1.5 shadow-overlay ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {header && <div className="border-b border-border px-3 pt-2 pb-3 mb-1">{header}</div>}
          {items.map((item) =>
            'href' in item ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                onClick={() => close(false)}
                className={itemClass()}
              >
                {item.icon && <Icon name={item.icon} />}
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                aria-current={item.selected ? 'true' : undefined}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={itemClass(item.tone)}
              >
                {item.icon && <Icon name={item.icon} />}
                <span className="flex-1">{item.label}</span>
                {item.selected && <Icon name="success" className="text-primary" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
