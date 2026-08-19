"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "../lib/format";
import styles from "./DataPanel.module.css";

interface DataFileRow {
  name: string;
  beschreibung: string;
  vorhanden: boolean;
  groesse: number | null;
  geaendert: string | null;
  editUrl: string | null;
  historieUrl: string | null;
}

function groesse(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Die Daten entstehen in GitHub Actions und liegen im Repository -- diese Instanz zeigt
// sie nur an. Der Panel ist der Weg zurueck: herunterladen zum Auswerten, und je Datei ein
// Link in den GitHub-Editor, der Diff, Historie und Zuruecknehmen mitbringt.
export function DataPanel() {
  const [rows, setRows] = useState<DataFileRow[] | null>(null);
  const [stand, setStand] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/data")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Abruf fehlgeschlagen");
        setRows(body.dateien);
        setStand(body.stand ?? null);
      })
      .catch((e) => setFehler(e instanceof Error ? e.message : "Abruf fehlgeschlagen"));
  }, []);

  if (fehler) return <p className="refresh-message">{fehler}</p>;
  if (!rows) return null;

  return (
    <section className="section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Daten</h2>
          <p className="section-subtitle">
            Gepflegt von der Automatik, versioniert im Repository. Bearbeitet wird auf
            GitHub — dort gibt es Diff, Historie und Zurücknehmen.
            {stand && ` Ausgeliefert wird der Stand von ${formatTimestamp(stand)}.`}
          </p>
        </div>
        <a className="button secondary" href="/api/admin/data/alles.zip" download>
          Alles herunterladen
        </a>
      </div>

      <ul className={styles.list}>
        {rows.map((f) => (
          <li key={f.name} className={styles.row}>
            <div className={styles.main}>
              <span className={styles.name}>{f.name}</span>
              {/* Bewusst ohne Zeitstempel je Datei: in der Cloud stammen die
                  Änderungsdaten aus dem Build, nicht aus der letzten Datenänderung, und
                  stünden für alle Dateien gleich. Der Stand der Auslieferung steht
                  einmal oben, die echte Historie liegt einen Klick entfernt in Git. */}
              <span className={styles.meta}>
                {f.vorhanden ? groesse(f.groesse) : "noch nicht vorhanden"}
              </span>
              <span className={styles.desc}>{f.beschreibung}</span>
            </div>
            <div className={styles.actions}>
              {f.vorhanden && (
                <a
                  className={styles.link}
                  href={`/api/admin/data/${encodeURIComponent(f.name)}`}
                  download
                >
                  herunterladen
                </a>
              )}
              {f.editUrl && f.vorhanden && (
                <a
                  className={styles.link}
                  href={f.editUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  bearbeiten
                </a>
              )}
              {f.historieUrl && f.vorhanden && (
                <a
                  className={styles.link}
                  href={f.historieUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Historie
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="footnote">
        Das Bündel enthält zusätzlich die historischen Saison-CSVs. Eine Änderung auf GitHub
        stößt ein Deployment an — nach ein bis zwei Minuten steht sie hier.
      </p>
    </section>
  );
}
