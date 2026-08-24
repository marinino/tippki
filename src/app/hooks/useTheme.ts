"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme } from "../lib/theme";

export function useTheme() {
  // Der erste Rendergang muss der Vorgabe folgen: der Server kennt den Speicher des
  // Browsers nicht, und ein davon abweichender erster Client-Rendergang zerbricht die
  // Hydration. Die Flaechen stehen zu diesem Zeitpunkt laengst richtig -- das
  // Bootstrap-Skript im <head> hat das Attribut gesetzt -- nachgezogen wird hier also
  // nur das Knopfsymbol.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [gelesen, setGelesen] = useState(false);

  useEffect(() => {
    const attribut = document.documentElement.dataset.theme;
    if (attribut === "light" || attribut === "dark") setTheme(attribut);
    setGelesen(true);
  }, []);

  // Attribut und Speicher folgen dem Zustand statt dem Klick. Die Nebenwirkung in die
  // Aktualisierungsfunktion von setTheme zu legen waere naheliegender, aber falsch:
  // React darf die zweimal aufrufen und tut es im StrictMode auch.
  //
  // Das Gatter ist noetig, weil Effekte in Deklarationsreihenfolge laufen. Ohne es
  // schriebe dieser Effekt im ersten Durchgang noch die Vorgabe -- und loeschte damit
  // die gespeicherte helle Wahl, bevor der Effekt darueber sie durchgereicht hat.
  useEffect(() => {
    if (!gelesen) return;
    if (theme === DEFAULT_THEME) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    // Privater Modus kann den Speicher verweigern. Dann gilt die Wahl eben nur fuer
    // diesen Besuch, statt dass der Umschalter gar nichts tut.
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* egal */
    }
  }, [theme, gelesen]);

  const toggle = useCallback(() => {
    setTheme((vorher) => (vorher === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
