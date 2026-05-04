import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./emails/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tamtam: {
          DEFAULT: "#0F172A",
          accent: "#F59E0B",
        },
        // Dakar Night theme — used by /dashboard/[token].
        dakar: {
          bg: "#0A0A1A",
          surface: "#0F0F1F",
          border: "#1a1a2e",
          orange: "#D35400",
          teal: "#1ABC9C",
          purple: "#6C63FF",
          text: "#FFFFFF",
          muted: "#8892A4",
          error: "#E74C3C",
        },
      },
    },
  },
  plugins: [],
};

export default config;
