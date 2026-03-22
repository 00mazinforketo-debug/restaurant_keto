import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        body: ["Noto Sans Arabic", "sans-serif"],
        display: ["Manrope", "sans-serif"]
      },
      boxShadow: {
        glow: "0 20px 60px rgba(14, 165, 233, 0.15)"
      },
      animation: {
        float: "float 8s ease-in-out infinite",
        pulseSoft: "pulseSoft 2.4s ease-in-out infinite"
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" }
        },
        pulseSoft: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.7 }
        }
      }
    }
  },
  plugins: []
} satisfies Config;
