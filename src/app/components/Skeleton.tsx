import styles from "./Skeleton.module.css";

// Platzhalter in der Form dessen, was gleich kommt. Eine Zeile "Lade …" sagt nur, dass
// etwas passiert; ein Geruest sagt zusaetzlich, wie viel und in welchem Layout -- und
// die Seite springt beim Eintreffen der Daten nicht.
export function SkeletonCards({ count = 9 }: { count?: number }) {
  return (
    <div className="card-list" aria-busy="true" aria-label="Lade Vorhersagen">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.head} />
          <div className={styles.body}>
            <div className={styles.teams}>
              <div className={styles.team} />
              <div className={styles.team} />
            </div>
            <div className={styles.verdict} />
          </div>
          <div className={styles.bar} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 18 }: { rows?: number }) {
  return (
    <div className={styles.tableWrap} aria-busy="true" aria-label="Lade Tabelle">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row} />
      ))}
    </div>
  );
}
