/** @type {import('tailwindcss').Config} */

/*
 * Ink on Cream. Navy ink on a cream page, cobalt for the hand that acts, vermilion for a refusal,
 * ochre for anything still waiting for a signature. Colour marks a state and always sits beside a
 * word; numbers stay in ink.
 *
 * The semantic tokens (cream, navy, cobalt, ...) are what new components use. Below them, the
 * legacy palettes the older screens were written against (white, gray, emerald, amber, red...)
 * are remapped onto the same ink, so every screen follows the theme without a rewrite: "white"
 * text on the old dark background becomes navy ink on cream, and so on.
 */

const ink = {
  cream: '#F4F0E5',
  creamDeep: '#EBE5D6',
  cobalt: '#2547C9',
  navy: '#1B2B6B',
  inkSoft: '#5A679E',
  vermilion: '#C0391B',
  ochre: '#A06A12',
};

/** A legacy hue scale on cream: low numbers and 900 are pale wells, the middle is the hue, 200/300/800 are text. */
const hue = (base, deep, tint, wash) => ({
  50: wash,
  100: tint,
  200: deep,
  300: deep,
  400: base,
  500: base,
  600: deep,
  700: deep,
  800: deep,
  900: tint,
  950: tint,
});

const cobaltHue = hue(ink.cobalt, '#1F3BA8', '#DDE2F2', '#ECEEF6');
const vermilionHue = hue(ink.vermilion, '#9A2E15', '#F2DCD2', '#F7EBE4');
const ochreHue = hue('#B98222', ink.ochre, '#F1E3C6', '#F6EEDC');

/** Gray inverted: what was light text on dark is now ink on cream. */
const gray = {
  50: ink.navy,
  100: ink.navy,
  200: '#26367A',
  300: '#3B4985',
  400: ink.inkSoft,
  500: '#7D86B0',
  600: '#DCD5C3',
  700: '#E4DECE',
  800: ink.creamDeep,
  900: ink.cream,
  950: ink.cream,
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        cream: { DEFAULT: ink.cream, deep: ink.creamDeep },
        navy: ink.navy,
        cobalt: ink.cobalt,
        'ink-soft': ink.inkSoft,
        vermilion: ink.vermilion,
        ochre: ink.ochre,
        orb: { cobalt: '#2547C9', cyan: '#35C8E8', violet: '#3A1F9E' },

        // Legacy palettes, remapped (see the note at the top)
        white: ink.navy,
        black: ink.cream,
        gray,
        slate: gray,
        zinc: gray,
        neutral: gray,
        dark: { DEFAULT: ink.cream, 200: ink.creamDeep },
        primary: {
          50: '#ECEEF6',
          100: '#DDE2F2',
          200: '#B9C4EA',
          300: '#1F3BA8',
          400: '#3A58D3',
          500: ink.cobalt,
          600: '#2140B5',
          700: ink.cobalt,
          800: '#1A318C',
          900: '#DDE2F2',
          DEFAULT: ink.cobalt,
        },
        secondary: { DEFAULT: ink.navy, dark: ink.navy },
        accent: { cyan: ink.cobalt, teal: ink.navy },
        emerald: cobaltHue,
        green: cobaltHue,
        teal: cobaltHue,
        cyan: cobaltHue,
        sky: cobaltHue,
        blue: cobaltHue,
        indigo: cobaltHue,
        purple: cobaltHue,
        violet: cobaltHue,
        red: vermilionHue,
        rose: vermilionHue,
        amber: ochreHue,
        yellow: ochreHue,
        orange: ochreHue,
      },
      fontSize: {
        11: ['0.6875rem', { lineHeight: '1.2' }],
        12: ['0.75rem', { lineHeight: '1.45' }],
        14: ['0.875rem', { lineHeight: '1.55' }],
        16: ['1rem', { lineHeight: '1.65' }],
        20: ['1.25rem', { lineHeight: '1.55' }],
        28: ['1.75rem', { lineHeight: '1.25' }],
        40: ['2.5rem', { lineHeight: '1.1' }],
        56: ['3.5rem', { lineHeight: '1.02' }],
        72: ['4.5rem', { lineHeight: '0.98' }],
      },
      borderRadius: { card: '4px', well: '3px' },
      boxShadow: {
        'ink-sm': '0 1px 2px rgba(27, 43, 107, 0.04)',
        ink: '0 1px 2px rgba(27, 43, 107, 0.03), 0 8px 24px rgba(27, 43, 107, 0.05)',
        'ink-lg': '0 2px 4px rgba(27, 43, 107, 0.03), 0 18px 48px rgba(27, 43, 107, 0.06)',
      },
    },
  },
  plugins: [],
};
