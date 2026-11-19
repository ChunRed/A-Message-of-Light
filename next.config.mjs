/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "*.ngrok-free.dev",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
  turbopack: {
    root: import.meta.dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
        ],
      },
    ];
  },
  reactStrictMode: true,
};

export default nextConfig;
