import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TopBar } from "@/components/TopBar";
import { StreamProvider } from "@/components/stream";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cassandra — AI forecasts you can audit",
  description: "Cassandra was always right and never believed. Now she has a ledger.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <StreamProvider>
          <TopBar />
          <main>{children}</main>
        </StreamProvider>
      </body>
    </html>
  );
}
