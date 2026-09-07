import { Newsreader } from 'next/font/google';

/* The marketing voice: Newsreader with its optical-size axis — high-contrast
   display cut at headline sizes, sturdier text cut for body. Roman only (the
   italic file costs ~150KB of preloaded font and broke the mobile LCP floor).
   Scoped to marketing surfaces via the .landing class in globals.css; the app
   itself stays on --font-sans. */
export const newsreader = Newsreader({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-newsreader',
  display: 'swap',
});
