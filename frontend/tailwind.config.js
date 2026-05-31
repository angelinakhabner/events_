/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#FAFAF7',
        ink: '#141414',
        muted: '#6B6B66',
        rule: '#E6E4DD',
        accent: '#1F3A5F',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', '"Source Serif Pro"', 'Georgia', 'serif'],
      },
      maxWidth: {
        readable: '64rem',
      },
    },
  },
  plugins: [],
};
