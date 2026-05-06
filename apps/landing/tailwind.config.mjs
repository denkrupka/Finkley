/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Палитра Finkley (см. ADR-007 и Design/project/tokens.jsx)
        'brand-navy': '#1A1A2E',
        'brand-navy-soft': '#252543',
        'brand-teal': '#1E6B8A',
        'brand-teal-soft': '#E5F0F4',
        'brand-sage': '#2E9E6B',
        'brand-sage-soft': '#E5F4ED',
        'brand-red': '#C0392B',
        'brand-yellow': '#FFF9C4',
        'brand-gold': '#C9A24B',
        'brand-bg': '#FAFAF8',
        'brand-text': '#1A1A1A',
        'brand-text-muted': '#666666',
        'brand-text-faint': '#9A9A9A',
        'brand-border': '#ECECE7',
      },
      fontFamily: {
        display: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '0.375rem',
        md: '0.625rem',
        lg: '0.875rem',
        xl: '1.25rem',
      },
    },
  },
  plugins: [],
}
