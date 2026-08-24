// Helle und dunkle Ansicht.
//
// Bewusst ohne "use client": das Layout ist eine Server-Komponente und braucht den
// Bootstrap-Text unten als echte Zeichenkette. Aus einem Client-Modul bekaeme es
// stattdessen nur einen Platzhalter.

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "tippki-theme";

// Dunkel ist die Vorgabe -- sie steht in :root und braucht deshalb kein Attribut.
// Nur die helle Ansicht setzt data-theme auf <html>.
export const DEFAULT_THEME: Theme = "dark";

// Laeuft als Inline-Skript im <head>, also vor dem ersten Anstrich. Ohne das wuerde die
// Seite bei einem Leser mit heller Ansicht kurz dunkel aufblitzen, weil React die
// gespeicherte Wahl erst nach der Hydration kennt.
export const THEME_BOOTSTRAP = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;
