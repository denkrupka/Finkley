import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/**
 * Источник правды для палитры/типографики — Design/project/tokens.jsx,
 * описано в decisions/007-design-tokens.md.
 *
 * Маппинг shadcn-токенов на Finkley-токены — в src/styles/globals.css.
 * Здесь — Tailwind-обёртки для удобства классов вида `bg-brand-navy`.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
    },
    extend: {
      colors: {
        // shadcn aliases (читают CSS-переменные из globals.css)
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
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Доменные акценты
        profit: 'hsl(var(--profit))',
        loss: 'hsl(var(--loss))',
        // Finkley brand palette — прямой доступ
        brand: {
          navy: {
            DEFAULT: 'hsl(var(--brand-navy))',
            soft: 'hsl(var(--brand-navy-soft))',
            deep: 'hsl(var(--brand-navy-deep))',
            ink: 'hsl(var(--brand-navy-ink))',
          },
          teal: {
            DEFAULT: 'hsl(var(--brand-teal))',
            soft: 'hsl(var(--brand-teal-soft))',
            deep: 'hsl(var(--brand-teal-deep))',
          },
          sage: {
            DEFAULT: 'hsl(var(--brand-sage))',
            soft: 'hsl(var(--brand-sage-soft))',
            deep: 'hsl(var(--brand-sage-deep))',
          },
          red: {
            DEFAULT: 'hsl(var(--brand-red))',
            soft: 'hsl(var(--brand-red-soft))',
          },
          yellow: {
            DEFAULT: 'hsl(var(--brand-yellow))',
            deep: 'hsl(var(--brand-yellow-deep))',
          },
          gold: 'hsl(var(--brand-gold))',
          'text-faint': 'hsl(var(--brand-text-faint))',
          'border-strong': 'hsl(var(--brand-border-strong))',
        },
      },
      borderRadius: {
        // Finkley scale: rSm=6 / rMd=10 / rLg=14 / rXl=20
        sm: '0.375rem', // 6px (rSm)
        md: '0.625rem', // 10px (rMd, default --radius)
        lg: '0.875rem', // 14px (rLg) — карточки
        xl: '1.25rem', // 20px (rXl) — модалки
      },
      fontFamily: {
        // Тексты, заголовки, кнопки — Plus Jakarta Sans
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Inline-fallback (там где Plus Jakarta Sans не подгрузился)
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        // Числа KPI/таблиц — JetBrains Mono с tabular figures
        mono: ['JetBrains Mono', 'SF Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Finkley shadow scale
        finsm: '0 1px 2px rgba(20,20,40,0.04), 0 1px 1px rgba(20,20,40,0.03)',
        finmd: '0 2px 4px rgba(20,20,40,0.04), 0 6px 18px rgba(20,20,40,0.05)',
        finlg: '0 4px 12px rgba(20,20,40,0.06), 0 24px 48px rgba(20,20,40,0.10)',
        finxl: '0 12px 24px rgba(20,20,40,0.10), 0 40px 80px rgba(20,20,40,0.18)',
      },
    },
  },
  plugins: [animate],
}

export default config
