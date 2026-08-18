import type { Tab } from "../types";
import styles from "./TabBar.module.css";

const TABS: { key: Tab; label: string }[] = [
  { key: "predictions", label: "Tipps" },
  { key: "table", label: "Tabelle" },
  { key: "backtest", label: "Backtest" },
  { key: "simulate", label: "Simulieren" },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className={styles.bar}>
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`${styles.tab} ${active === t.key ? styles.active : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
