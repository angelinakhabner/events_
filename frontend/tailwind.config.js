/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Wide enough that the 64rem readable column leaves a gutter big
        // enough to hold the /my menu beside it (see MyPage).
        wide: '90rem',
      },
      // Poster palette (GOI-34), taken from the newsletter's design tokens so
      // the app and the brief read as one product. The newsletter flattens the
      // same surfaces for email (see newsletter-render.ts); these are kept in
      // step with it deliberately.
      colors: {
        /** The content sheet. */
        paper: '#FAF8F0',
        /** Outside the content column — a shade cooler, so the column reads as
         *  a sheet laid on a surface rather than as the page itself. */
        page: '#EAE7E7',
        ink: '#1A1712',
        /** Text on the ink masthead. */
        onInk: '#F3F2F2',
        onInkMuted: '#D2D1D0',
        /** Secondary text: labels, meta lines. */
        muted: '#8D8B87',
        /** Body copy — darker than muted, lighter than ink. */
        body: '#575552',
        /** Rules are drawn 2px in this design, so a mid grey rather than the
         *  near-invisible hairline the old 1px rules needed. */
        rule: '#ACA9A2',
        /** Polish poster design leans on one hot spot against warm paper.
         *  The previous navy read as web-UI chrome on a cream sheet. */
        accent: '#B3321F',
        /** The filled tag's ground — accent-100 in the newsletter tokens. */
        accentSoft: '#F0EAD0',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Source Serif 4"', '"Source Serif Pro"', 'Georgia', 'serif'],
        /** The newsletter's face: a grotesque that goes very heavy at 800.
         *  Masthead and headings only — never body copy. */
        display: ['Archivo', '"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      maxWidth: {
        readable: '64rem',
      },
    },
  },
  plugins: [],
};
