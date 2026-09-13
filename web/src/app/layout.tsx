import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Covenant Sentinel",
  description: "A GenLayer Intelligent Contract for debt-covenant monitoring on tokenized RWA / private-credit facilities.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-[color:var(--surface-border)]">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
            <div>
              <div className="text-sm font-semibold tracking-tight">Covenant Sentinel</div>
              <div className="text-xs text-[color:var(--muted)]">Debt-covenant monitoring on GenLayer</div>
            </div>
            <a
              href="https://github.com/HarrisonJL/covenant-sentinel"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
            >
              Source ↗
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <footer className="border-t border-[color:var(--surface-border)] px-4 py-4 text-center text-xs text-[color:var(--muted)] sm:px-6">
          GenLayer Bradbury testnet only &middot; no real value &middot; covenant compliance is checked by an independent validator committee, not one party
        </footer>
      </body>
    </html>
  );
}
