// Die Next-Typen (u. a. `*.module.css`) kommen sonst nur ueber next-env.d.ts, und die
// erzeugt Next erst beim `next dev`/`next build` -- sie steht in .gitignore. Lokal faellt
// das nie auf, in GitHub Actions scheitert `npm test` am Typecheck. Diese Datei ist
// eingecheckt und macht den Typecheck unabhaengig davon, ob Next schon gelaufen ist.
/// <reference types="next" />
/// <reference types="next/image-types/global" />
