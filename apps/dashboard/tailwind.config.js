/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    container: { center: true, padding: "1rem" },
    extend: {
      colors: {
        // Core surfaces and text
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
        },
        border: "hsl(var(--divider-border))",

        // Conversion-centric semantic colors
        accent: {
          DEFAULT: "hsl(var(--accent))",
          hover: "hsl(var(--accent-hover))",
          foreground: "hsl(var(--accent-foreground))",
          muted: "hsl(var(--accent-muted))",
          ring: "hsl(var(--accent-ring) / 0.35)",
          bg: {
            subtle: "hsl(var(--accent-bg-subtle))",
          },
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },

        // Keep legacy aliases working
        "text-primary": "hsl(var(--text-primary))",
        "text-secondary": "hsl(var(--text-secondary))",
        "text-muted": "hsl(var(--text-muted))",
      },

      // Back-compat utility aliases you used (unchanged API)
      backgroundColor: {
        primary: "hsl(var(--sidebar-bg))",
        secondary: "hsl(var(--controls-bg))",
        "accent-blue": "hsl(var(--accent-blue-bg))",
        // translucent red background for alerts
        "accent-red": "hsl(var(--accent-red-bg))",
      },
      textColor: {
        primary: "hsl(var(--text-primary))",
        secondary: "hsl(var(--text-secondary))",
        muted: "hsl(var(--text-muted))",
        hover: "hsl(var(--text-hover))",
        "accent-blue": "hsl(var(--accent-blue))",
        "accent-red": "hsl(var(--destructive))",
        "accent-green": "hsl(var(--success))",
      },
      borderColor: {
        primary: "hsl(var(--sidebar-border))",
        "accent-blue": "hsl(var(--accent-blue-border))",
        accent: "hsl(var(--accent))",
      },
      ringColor: {
        DEFAULT: "hsl(var(--accent-ring) / 0.35)",
        accent: "hsl(var(--accent-ring))",
        success: "hsl(var(--success))",
        destructive: "hsl(var(--destructive))",
      },

      backgroundImage: {
        "gradient-primary":
          "linear-gradient(to bottom right, hsl(var(--bg-gradient-start)), hsl(var(--bg-gradient-end)))",
        "gradient-logo":
          "linear-gradient(to bottom right, hsl(var(--logo-gradient-start)), hsl(var(--logo-gradient-via)), hsl(var(--logo-gradient-end)))",
        "gradient-logout":
          "linear-gradient(to right, hsl(var(--logout-bg-start)), hsl(var(--logout-bg-end)))",
        "gradient-nav-hover":
          "linear-gradient(to right, hsl(var(--nav-hover-start)), transparent)",
        "gradient-nav-active":
          "linear-gradient(to right, hsl(var(--nav-active-start)), transparent)",
      },

      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },

      animation: {
        fadeIn: "fadeIn 0.3s ease-out",
      },
    },
  },
  plugins: [],
};