import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "株式会社ALBUM",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "ALBUM" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0071e3" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
