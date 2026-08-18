import styles from "./AppHeader.module.css";

export function AppHeader({
  onRefresh,
  loading,
  message,
}: {
  onRefresh: () => void;
  loading: boolean;
  message: string | null;
}) {
  return (
    <div className={styles.header}>
      <div>
        <p className={styles.eyebrow}>Bundesliga</p>
        <h1 className={styles.title}>Tippki</h1>
      </div>
      <div className={styles.refreshBlock}>
        <button className="button secondary" onClick={onRefresh} disabled={loading}>
          {loading ? "Aktualisiert …" : "Ergebnisse aktualisieren"}
        </button>
        {message && <p className="refresh-message">{message}</p>}
      </div>
    </div>
  );
}
