import styles from "./FormPills.module.css";

const TONE = { S: "win", U: "draw", N: "loss" } as const;
const TITLE = { S: "Sieg", U: "Unentschieden", N: "Niederlage" } as const;

// Die letzten fuenf Ergebnisse, aeltestes links. Ohne diese Spalte sagt die Tabelle nur,
// wo ein Team steht -- nicht, in welche Richtung es sich gerade bewegt.
export function FormPills({ form }: { form: ("S" | "U" | "N")[] }) {
  if (!form || form.length === 0) return <span className={styles.empty}>—</span>;

  return (
    <span
      className={styles.row}
      role="img"
      aria-label={`Form, älteste zuerst: ${form.map((r) => TITLE[r]).join(", ")}`}
    >
      {form.map((result, i) => (
        <span
          key={i}
          className={`${styles.pill} ${styles[TONE[result]]}`}
          title={TITLE[result]}
          aria-hidden="true"
        >
          {result}
        </span>
      ))}
    </span>
  );
}
