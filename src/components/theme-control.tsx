"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { useThemePreference, type ThemePreference } from "@/components/theme-provider";

const options: { value: ThemePreference; label: string; description: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", description: "Always use the light appearance", Icon: Sun },
  { value: "dark", label: "Dark", description: "Always use the dark appearance", Icon: Moon },
  { value: "system", label: "System", description: "Follow this device's setting", Icon: Monitor },
];

export function ThemeControl() {
  const { preference, setPreference } = useThemePreference();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  const currentIndex = Math.max(0, options.findIndex((option) => option.value === preference));
  const CurrentIcon = options[currentIndex].Icon;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(currentIndex);
    const frame = window.requestAnimationFrame(() => itemRefs.current[currentIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [currentIndex, open]);

  const closeMenu = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };

  const selectTheme = (value: ThemePreference) => {
    setPreference(value);
    closeMenu();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let next = activeIndex;
    if (event.key === "ArrowDown") next = (activeIndex + 1) % options.length;
    if (event.key === "ArrowUp") next = (activeIndex - 1 + options.length) % options.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  return (
    <div className="theme-control" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-control-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <CurrentIcon size={15} aria-hidden="true" />
        <span className="theme-control-label">{options[currentIndex].label}</span>
        <ChevronDown size={13} aria-hidden="true" className={open ? "is-open" : undefined} />
        <span className="sr-only">Color theme</span>
      </button>

      {open && (
        <div
          id={menuId}
          className="theme-control-menu"
          role="menu"
          aria-label="Color theme"
          onKeyDown={handleMenuKeyDown}
        >
          <p className="theme-control-menu-title">Appearance</p>
          {options.map(({ value, label, description, Icon }, index) => {
            const selected = value === preference;
            return (
              <button
                key={value}
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`theme-control-option${selected ? " is-selected" : ""}`}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onClick={() => selectTheme(value)}
              >
                <Icon size={15} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
                <Check size={14} aria-hidden="true" className="theme-control-check" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
