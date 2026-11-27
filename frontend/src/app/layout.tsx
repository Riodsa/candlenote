import type { Metadata } from "next";
import { Suspense } from "react";
import { Quicksand } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Providers } from "@/components/providers";

const quicksand = Quicksand({
  variable: "--font-quicksand",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "CandleNote \u2014 Watchlist & MT5 Trading Journal",
  description: "Real-time stock & gold watchlist and MT5 trading journal",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${quicksand.variable} dark h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("candlenote-theme");if(t==="light")document.documentElement.classList.remove("dark");else if(t==="dark")document.documentElement.classList.add("dark");}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        <Suspense fallback={<div className="h-16 border-b border-border/60" />}>
          <Navbar />
        </Suspense>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7">
          <Providers>{children}</Providers>
        </main>
      </body>
    </html>
  );
}
