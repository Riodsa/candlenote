"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const THEME_KEY = "candlenote-theme";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getIsDark() {
  return document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getIsDark, () => true);

  const toggle = () => {
    const next = !getIsDark();
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {}
    listeners.forEach((fn) => fn());
  };

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label="Toggle color theme"
      className="rounded-full border-border/60 bg-card/60 backdrop-blur"
    >
      {dark ? <Sun className="size-4 text-amber-400" /> : <Moon className="size-4 text-indigo-600" />}
    </Button>
  );
}
