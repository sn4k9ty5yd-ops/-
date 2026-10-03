/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
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
