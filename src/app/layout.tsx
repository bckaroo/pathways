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
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-50 text-neutral-900`}
      >
        <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Pathways
            </Link>
            <nav className="flex items-center gap-5 text-sm font-medium text-neutral-600">
              <Link href="/map" className="hover:text-emerald-700">
                Map
              </Link>
              <Link href="/communities" className="hover:text-emerald-700">
                Communities
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}