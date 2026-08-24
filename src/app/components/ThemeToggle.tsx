"use client";

import { useTheme } from "../hooks/useTheme";
import styles from "./ThemeToggle.module.css";

// Gezeigt wird das Ziel, nicht der Zustand: in der dunklen Ansicht steht die Sonne,
// weil ein Druck darauf hell macht. Ein Symbol fuer den aktuellen Zustand liest sich
// an einem Knopf als Behauptung statt als Angebot.
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const zielIstHell = theme === "dark";
  const label = zielIstHell ? "Zur hellen Ansicht wechseln" : "Zur dunklen Ansicht wechseln";

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {zielIstHell ? <SonneIcon /> : <MondIcon />}
    </button>
  );
}

function SonneIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.1v1.5M8 13.4v1.5M14.9 8h-1.5M2.6 8H1.1M12.88 3.12l-1.06 1.06M4.18 11.82l-1.06 1.06M12.88 12.88l-1.06-1.06M4.18 4.18 3.12 3.12" />
    </svg>
  );
}

function MondIcon() {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.4 9.9A5.8 5.8 0 0 1 6.1 2.6 5.8 5.8 0 1 0 13.4 9.9Z" />
    </svg>
  );
}
