/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Be Vietnam Pro', 'Inter', 'sans-serif'],
      },
      colors: {
        primary: {
          '50': '#E6FAF5',
          '100': '#CCF5EB',
          '200': '#99EBD7',
          '300': '#66E0C3',
          '400': '#33D6AF',
          '500': '#1DCD9F',
          '600': '#169976',
          '700': '#127259',
          '800': '#0D4C3C',
          '900': '#09261E',
          DEFAULT: '#1DCD9F',
        },
        secondary: {
          DEFAULT: '#169976',
          dark: '#0D4C3C',
        },
        dark: {
          DEFAULT: '#000000',
          '200': '#202122',
        },
        accent: {
          cyan: '#1DCD9F',
          teal: '#169976',
        }
      },
    },
  },
  plugins: [],
}