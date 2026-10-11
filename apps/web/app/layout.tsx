import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { TopBar } from "@/components/TopBar";
import { StreamProvider } from "@/components/stream";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cassandra",
  description: "AI forecasts on Gemini prediction markets, recorded on-chain before each market closes.",
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
