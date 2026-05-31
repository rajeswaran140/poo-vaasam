import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // `class` strategy — admin layout toggles a `dark` class on its root div
  // based on the user's choice (persisted to localStorage). Public site is
  // unaffected; its dark visuals are baked in directly, not via `dark:`.
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        tamil: ['var(--font-tamil)', 'sans-serif'],
        kavivanar: ['var(--font-kavivanar)', 'cursive'],
        poem: ['var(--font-baloo-thambi)', 'var(--font-tamil)', 'sans-serif'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
    },
  },
  plugins: [],
} satisfies Config;
