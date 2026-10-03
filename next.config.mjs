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
      ],
    }];
  },
};
