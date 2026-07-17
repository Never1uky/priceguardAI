/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      spacing: {
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        5: '20px',
        6: '24px',
        8: '32px',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        purple: {
          DEFAULT: 'hsl(var(--pg-purple))',
          foreground: 'hsl(var(--pg-purple-foreground))',
        },
        success: 'hsl(var(--pg-green))',
        warning: 'hsl(var(--pg-orange))',
        danger: 'hsl(var(--pg-red))',
        info: 'hsl(var(--pg-blue))',
        hero: {
          DEFAULT: 'hsl(var(--pg-hero))',
          foreground: 'hsl(var(--pg-hero-foreground))',
        },
      },
      borderRadius: {
        sm: '12px',
        DEFAULT: '16px',
        md: '16px',
        lg: '20px',
        xl: '20px',
      },
      boxShadow: {
        soft: '0 1px 2px hsl(var(--pg-shadow)), 0 4px 12px hsl(var(--pg-shadow))',
        lift: '0 2px 8px hsl(var(--pg-shadow)), 0 8px 24px hsl(var(--pg-shadow))',
      },
      transitionDuration: {
        DEFAULT: '200ms',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
