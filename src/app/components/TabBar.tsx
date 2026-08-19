import type { Tab } from "../types";
import styles from "./TabBar.module.css";

const TABS: { key: Tab; label: string; nurAdmin?: boolean }[] = [
  { key: "predictions", label: "Quoten" },
  { key: "table", label: "Tabelle" },
  { key: "backtest", label: "Backtest" },
  { key: "simulate", label: "Simulieren" },
  { key: "data", label: "Daten", nurAdmin: true },
];

export function TabBar({
  active,
  onChange,
  admin,
}: {
  active: Tab;
  onChange: (t: Tab) => void;
  admin: boolean;
}) {
  return (
    <div className={styles.bar}>
      {TABS.filter((t) => !t.nurAdmin || admin).map((t) => (
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
