import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TopBar } from "@/components/TopBar";
import { StreamProvider } from "@/components/stream";
import "./globals.css";

const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument-serif" });

export const metadata: Metadata = {
  title: "Cassandra — proof of calibration for prediction markets",
  description: "Cassandra was always right and never believed. Now she has a ledger.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <StreamProvider>
          <TopBar />
          <main className="relative z-10">{children}</main>
        </StreamProvider>
        <div className="vignette" aria-hidden />
        <svg className="grain" aria-hidden width="100%" height="100%">
          <filter id="grain-f"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" /></filter>
          <rect width="100%" height="100%" filter="url(#grain-f)" />
        </svg>
      </body>
    </html>
  );
}
