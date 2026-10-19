/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#121318",
        surface: "#1A1B23",
        recessed: "#16171F",
        amber: "#FFB300",
        magma: "#FF5100",
        magenta: "#E60067",
        ink: "#E7E8EF",
        muted: "#8A8CA0",
        line: "#2B2D3A",
      },
      fontFamily: {
        sans: [
          "Inter",
          "SF Pro Display",
          "Segoe UI",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "monospace"],
      },
      backgroundImage: {
        brand: "linear-gradient(135deg, #FFB300 0%, #FF5100 50%, #E60067 100%)",
        "brand-soft":
          "linear-gradient(135deg, rgba(255,179,0,0.18) 0%, rgba(255,81,0,0.16) 50%, rgba(230,0,103,0.18) 100%)",
      },
      boxShadow: {
        raised: "4px 4px 8px #0c0d10, -4px -4px 8px #262734",
        "raised-sm": "2px 2px 4px #0c0d10, -2px -2px 4px #262734",
        recessed: "inset 3px 3px 6px #0c0d10, inset -3px -3px 6px #222330",
        "recessed-sm": "inset 2px 2px 4px #0c0d10, inset -2px -2px 4px #222330",
        glow: "0 0 0 1px rgba(255,179,0,0.35), 0 0 18px rgba(255,81,0,0.35)",
      },
      transitionTimingFunction: {
        tactile: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};
