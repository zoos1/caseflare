/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f1ff', 100: '#e4e5ff', 200: '#ccceff',
          300: '#a9acff', 400: '#817eff', 500: '#5c55fb',
          600: '#4a52eb', 700: '#3a3ecf', 800: '#3134a8',
          900: '#2c2f85', 950: '#1a1c4e',
        },
        slate: { 950: '#0b0f1a' },
      },
    },
  },
  plugins: [],
};
