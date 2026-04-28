/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Slack/Inngest webhooks need raw body access in app-router routes.
    // We handle bodies manually in each route.ts via req.text().
  },
};

module.exports = nextConfig;
