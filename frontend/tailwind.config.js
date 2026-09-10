/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Core accent — glowing cyan/sky, kept under the same token names the
        // whole app already references so every existing component reskins
        // automatically.
        primary: "#22d3ee",
        "primary-dark": "#0891b2",
        "primary-hover": "#67e8f9",
        "primary-light": "rgba(34,211,238,0.12)",
        secondary: "#2dd4bf",
        "secondary-light": "rgba(45,212,191,0.12)",

        // Text
        "slate-heading": "#eaf4ff",
        "slate-body": "#aebdd1",
        "slate-subtle": "#7c8aa0",

        // Surfaces
        "border-soft": "rgba(148,163,184,0.14)",
        "border-strong": "rgba(148,163,184,0.28)",
        "bg-canvas": "#050b13",
        "card-white": "rgba(17,28,43,0.62)",

        // Deep space/ocean scale used by the new hero + background layers
        abyss: {
          950: "#02060c",
          900: "#050b13",
          800: "#0a1522",
          700: "#0f1f30",
          600: "#16293c",
        },
      },
      fontFamily: {
        body: ["Inter", "sans-serif"],
        display: ["Hanken Grotesk", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,0.15), 0 0 24px -4px rgba(34,211,238,0.35)",
        "glow-lg": "0 0 0 1px rgba(34,211,238,0.18), 0 8px 40px -8px rgba(34,211,238,0.4), 0 0 60px -12px rgba(45,212,191,0.25)",
        "glow-teal": "0 0 24px -6px rgba(45,212,191,0.45)",
        "glow-rose": "0 0 24px -6px rgba(251,113,133,0.45)",
        "inner-glow": "inset 0 1px 0 0 rgba(255,255,255,0.06)",
      },
      backgroundImage: {
        "mesh-abyss": "radial-gradient(circle at 15% 20%, rgba(34,211,238,0.14), transparent 45%), radial-gradient(circle at 85% 0%, rgba(45,212,191,0.10), transparent 40%), radial-gradient(circle at 50% 100%, rgba(56,189,248,0.10), transparent 50%)",
        "grid-fine": "linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)",
      },
      keyframes: {
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(2%, -3%, 0) scale(1.05)" },
        },
        floatY: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        glowPulse: {
          "0%, 100%": { opacity: 1, filter: "drop-shadow(0 0 6px currentColor)" },
          "50%": { opacity: 0.6, filter: "drop-shadow(0 0 14px currentColor)" },
        },
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(var(--orbit-radius,120px)) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(var(--orbit-radius,120px)) rotate(-360deg)" },
        },
        spin3d: {
          "0%": { transform: "rotateY(0deg) rotateX(8deg)" },
          "100%": { transform: "rotateY(360deg) rotateX(8deg)" },
        },
        scan: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeUp: {
          "0%": { opacity: 0, transform: "translateY(14px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        ringPulse: {
          "0%": { boxShadow: "0 0 0 0 rgba(34,211,238,0.5)" },
          "70%": { boxShadow: "0 0 0 14px rgba(34,211,238,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(34,211,238,0)" },
        },
      },
      animation: {
        drift: "drift 18s ease-in-out infinite",
        floatY: "floatY 6s ease-in-out infinite",
        glowPulse: "glowPulse 2.4s ease-in-out infinite",
        orbit: "orbit 16s linear infinite",
        spin3d: "spin3d 22s linear infinite",
        scan: "scan 3.5s linear infinite",
        shimmer: "shimmer 2.5s linear infinite",
        fadeUp: "fadeUp 0.6s cubic-bezier(0.16,1,0.3,1) both",
        ringPulse: "ringPulse 2.2s ease-out infinite",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
