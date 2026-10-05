/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite", "pg", "web-push"],
  // 画面側（ブラウザ）には、サーバー専用の通知送信ライブラリを入れない
  turbopack: { resolveAlias: { "web-push": { browser: "./lib/empty-module.ts" } } },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        // 読みこめる場所を、自分のサイト・YouTube（マニュアルの動画）・文字読み取り（OCR）の部品に限る
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "font-src 'self' data:",
          "connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://*.projectnaptha.com",
          "worker-src 'self' blob:",
          "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
          "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
        ].join("; ") },
      ],
    }];
  },
};
