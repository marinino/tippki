import styles from "./TeamName.module.css";

// Wappen plus Name plus Stern-Markierung. Stand vorher viermal wortgleich im JSX
// (Spielkarte heim/auswaerts, Simulator heim/auswaerts) und einmal verkuerzt in der
// Tabelle.
export function TeamName({
  name,
  logo,
  isEstimated = false,
  muted = false,
  size = "md",
}: {
  name: string;
  logo?: string | null;
  isEstimated?: boolean;
  muted?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`${styles.team} ${muted ? styles.muted : ""} ${size === "sm" ? styles.sm : ""}`}
    >
      {logo ? (
        <span className={styles.badge}>
          <img src={logo} alt="" className={styles.logo} />
        </span>
      ) : (
        <span className={`${styles.badge} ${styles.badgeEmpty}`} aria-hidden="true" />
      )}
      <span className={styles.label}>
        {name}
        {isEstimated && (
          <span className={styles.estimated} title="geschätzt: keine oder wenig Bundesliga-Historie">
            {" *"}
          </span>
        )}
      </span>
    </span>
  );
}
