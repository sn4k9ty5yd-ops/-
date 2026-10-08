import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Assistant } from "./Assistant";
import { ViewAs } from "./ViewAs";

export const metadata: Metadata = {
  title: "ALBUM",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "ALBUM" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fff9f0" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}<Assistant /><ViewAs /></body>
    </html>
  );
}
