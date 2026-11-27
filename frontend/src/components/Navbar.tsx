"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, LineChart, Settings, Upload } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_ITEMS = [
  { href: "/watchlist", label: "Watchlist", icon: LineChart },
  { href: "/journal", label: "Trade Journal", icon: BookOpen },
  { href: "/dashboard", label: "Analytics", icon: BarChart3 },
  { href: "/journal/import", label: "MT5 Import", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/watchlist" className="group flex items-center gap-2.5 text-xl tracking-tight">
            <span className="flex size-10 items-center justify-center overflow-hidden rounded-2xl bg-white p-1 shadow-md ring-1 ring-emerald-500/25 transition-transform group-hover:scale-105">
              <Image
                src="/candlenote-icon.png"
                alt="CandleNote Logo"
                width={36}
                height={36}
                priority
                className="size-full object-contain"
              />
            </span>
            <span className="font-extrabold tracking-tight">
              <span className="text-[#00a878] dark:text-[#10b981]">Candle</span>
              <span className="text-[#263547] dark:text-slate-100">Note</span>
            </span>
          </Link>

          <div className="flex items-center gap-1 rounded-full border border-border/60 bg-muted/50 p-1">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/journal"
                  ? pathname === "/journal"
                  : pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-all ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                  }`}
                >
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        <ThemeToggle />
      </nav>
    </header>
  );
}
