"use client";

import { useState } from "react";
import type { useAdmin } from "../hooks/useAdmin";
import styles from "./AdminBar.module.css";

// Ein Textfeld, ein Knopf. Mehr soll der Admin-Modus nicht sein -- er schaltet die
// beiden Aktualisierungen frei, wenn die Automatik ausgefallen ist, und sonst nichts.
//
// Ohne gesetztes ADMIN_PASSWORD erscheint hier gar nichts: eine Anmeldemaske, die
// niemand bedienen kann, waere nur eine Einladung zum Probieren.
export function AdminBar({ admin }: { admin: ReturnType<typeof useAdmin> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  if (!admin.state.configured) return null;

  if (admin.state.admin) {
    return (
      <div className={styles.bar}>
        <span className={styles.badge}>Admin</span>
        {!admin.state.canDispatch && (
          <span className={styles.warn}>
            Kein GitHub-Token hinterlegt — die Knöpfe können nichts auslösen.
          </span>
        )}
        <button className={styles.link} onClick={() => admin.logout()}>
          abmelden
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className={styles.bar}>
        <button className={styles.link} onClick={() => setOpen(true)}>
          Admin
        </button>
      </div>
    );
  }

  return (
    <form
      className={styles.bar}
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await admin.login(password);
        // Das Feld wird in jedem Fall geleert -- nach Erfolg, weil es nicht mehr
        // gebraucht wird, nach Fehlschlag, damit kein halb getipptes Passwort stehen
        // bleibt und beim naechsten Versuch mitlaeuft.
        setPassword("");
        if (ok) setOpen(false);
      }}
    >
      <input
        className={styles.field}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Admin-Passwort"
        autoFocus
        autoComplete="current-password"
        disabled={admin.busy}
      />
      <button className="button secondary" type="submit" disabled={admin.busy || !password}>
        {admin.busy ? "…" : "Anmelden"}
      </button>
      <button
        className={styles.link}
        type="button"
        onClick={() => {
          setPassword("");
          setOpen(false);
        }}
      >
        abbrechen
      </button>
      {admin.error && <span className={styles.warn}>{admin.error}</span>}
    </form>
  );
}
