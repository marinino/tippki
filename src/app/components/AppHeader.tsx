import styles from "./AppHeader.module.css";

// `canRefresh` ist auf der gehosteten Instanz false: dort ist data/ schreibgeschuetzt,
// der Knopf liefe ins Leere. Aktualisiert wird lokal per npm-Skript, danach gepusht.
export function AppHeader({
  onRefresh,
  loading,
  message,
  canRefresh,
}: {
  onRefresh: () => void;
  loading: boolean;
  message: string | null;
  canRefresh: boolean;
}) {
  return (
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Bundesliga</p>
        <h1 className={styles.title}>Tippki</h1>
      </div>
      {canRefresh && (
        <div className={styles.refreshBlock}>
          <button className="button secondary" onClick={onRefresh} disabled={loading}>
            {loading ? "Aktualisiert …" : "Ergebnisse aktualisieren"}
          </button>
          {message && <p className="refresh-message">{message}</p>}
        </div>
      )}
    </div>
  );
}
