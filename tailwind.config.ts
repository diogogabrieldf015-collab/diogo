import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 20px -5px hsl(var(--primary) / 0.45)" },
          "50%": { boxShadow: "0 0 40px -5px hsl(var(--accent) / 0.65)" },
        },
        "engagement-drift-a": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg) scale(1)" },
          "20%": { transform: "translate(4vw, -3vh) rotate(14deg) scale(1.1)" },
          "40%": { transform: "translate(-3vw, 3vh) rotate(-10deg) scale(0.92)" },
          "60%": { transform: "translate(2vw, 4vh) rotate(8deg) scale(1.06)" },
          "80%": { transform: "translate(-3vw, -2vh) rotate(-12deg) scale(1)" },
        },
        "engagement-drift-b": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg) scale(1)" },
          "16%": { transform: "translate(-4vw, -3vh) rotate(-16deg) scale(1.12)" },
          "38%": { transform: "translate(5vw, 1vh) rotate(12deg) scale(0.9)" },
          "55%": { transform: "translate(2vw, 4vh) rotate(6deg) scale(1.08)" },
          "72%": { transform: "translate(-2vw, -3vh) rotate(-8deg) scale(0.95)" },
          "88%": { transform: "translate(3vw, -1vh) rotate(10deg) scale(1.02)" },
        },
        "engagement-drift-c": {
          "0%, 100%": { transform: "translate(0, 0) rotate(0deg) scale(1)" },
          "12.5%": { transform: "translate(3vw, 3vh) rotate(18deg) scale(1.08)" },
          "25%": { transform: "translate(5vw, -1vh) rotate(-6deg) scale(0.88)" },
          "37.5%": { transform: "translate(1vw, -4vh) rotate(-14deg) scale(1.04)" },
          "50%": { transform: "translate(-4vw, -2vh) rotate(10deg) scale(1)" },
          "62.5%": { transform: "translate(-3vw, 3vh) rotate(-12deg) scale(0.94)" },
          "75%": { transform: "translate(3vw, 2vh) rotate(16deg) scale(1.1)" },
          "87.5%": { transform: "translate(-2vw, -3vh) rotate(-4deg) scale(0.96)" },
        },
        "engagement-drift-d": {
          "0%": { transform: "translate(0, 0) rotate(0deg) scale(1)" },
          "25%": { transform: "translate(4vw, 3vh) rotate(20deg) scale(1.14)" },
          "50%": { transform: "translate(-1vw, -5vh) rotate(-18deg) scale(0.86)" },
          "75%": { transform: "translate(-5vw, 2vh) rotate(11deg) scale(1.06)" },
          "100%": { transform: "translate(0, 0) rotate(0deg) scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "engagement-drift-a": "engagement-drift-a 22s ease-in-out infinite",
        "engagement-drift-b": "engagement-drift-b 26s ease-in-out infinite",
        "engagement-drift-c": "engagement-drift-c 20s ease-in-out infinite",
        "engagement-drift-d": "engagement-drift-d 24s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
