/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Wide enough that the /my sidebar can sit in the left gutter without
        // squeezing the listing column (see MyPage).
        wide: '90rem',
      },
      // Polish Poster School palette: one ink, one paper, one red. Everything
      // else is a grey step. The same values live in src/lib/tokens.ts — the
      // category swatches need them as inline styles.
      colors: {
        ink: '#141414',
        paper: '#eae6df',
        panel: '#f4f1ea',
        accent: '#c62828',
        muted: '#6b6660',
        faint: '#8a8378',
        body: '#3a3632',
        rule: '#cfc9bf',
      },
      fontFamily: {
        sans: ['Archivo', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Anton', 'Impact', 'ui-sans-serif', 'sans-serif'],
      },
      borderWidth: {
        3: '3px',
        5: '5px',
      },
      maxWidth: {
        readable: '64rem',
      },
    },
  },
  plugins: [],
};
