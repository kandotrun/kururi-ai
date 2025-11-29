/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{ts,tsx,html}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        background: '#f8fafc',
        foreground: '#0f172a'
      },
      borderRadius: {
        lg: '12px',
        md: '10px',
        sm: '8px'
      }
    }
  },
  plugins: [require('tailwindcss-animate')]
};
