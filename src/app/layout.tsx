import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
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
  title: "Pathways — NY Community Climate Dashboard",
  description:
    "Open-source dashboard tracking NYSDEC Climate Smart Communities (CSC) and NYSERDA Clean Energy Communities (CEC) progress across New York State municipalities. Not affiliated with NYSDEC or NYSERDA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-surface text-ink`}
      >
        <header className="sticky top-0 z-40 border-b border-line bg-panel/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Pathways
            </Link>
            <nav className="flex items-center gap-5 text-sm font-medium text-ink-muted">
              <Link href="/map" className="hover:text-ok-solid">
                Map
              </Link>
              <Link href="/communities" className="hover:text-ok-solid">
                Communities
              </Link>
              <Link href="/tree" className="hover:text-ok-solid">
                Skill Tree
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}