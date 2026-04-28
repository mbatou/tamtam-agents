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
      },
    },
  },
  plugins: [],
};

export default config;
