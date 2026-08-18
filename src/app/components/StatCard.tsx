import styles from "./StatCard.module.css";

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}

export function StatCard({
  label,
  wide = false,
  children,
}: {
  label: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${styles.card} ${wide ? styles.wide : ""}`}>
      <p className={styles.label}>{label}</p>
      {children}
    </div>
  );
}

export function StatValue({
  small = false,
  children,
  ...rest
}: { small?: boolean; children: React.ReactNode } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`${styles.value} ${small ? styles.small : ""}`} {...rest}>
      {children}
    </p>
  );
}

export function StatUnit({ children }: { children: React.ReactNode }) {
  return <span className={styles.unit}>{children}</span>;
}
