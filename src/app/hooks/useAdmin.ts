"use client";

import { useCallback, useEffect, useState } from "react";

// Der Admin-Modus ist reine Bequemlichkeit: er entscheidet, ob die Oberflaeche die
// Aktualisierungsknoepfe zeigt. Die Sperre selbst sitzt serverseitig in den Routen -- wer
// dieses Flag im Browser umbiegt, sieht Knoepfe, die 403 liefern.
export interface AdminState {
  // Ist ueberhaupt ein Passwort gesetzt? Ohne eines gibt es keinen Login zu zeigen.
  configured: boolean;
  admin: boolean;
  // Liegt auf der Instanz ein GitHub-Token? Ohne ihn sind die Knoepfe da, aber wirkungslos.
  canDispatch: boolean;
}

const UNKNOWN: AdminState = { configured: false, admin: false, canDispatch: false };

export function useAdmin() {
  const [state, setState] = useState<AdminState>(UNKNOWN);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin");
      setState(await res.json());
    } catch {
      setState(UNKNOWN);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const login = useCallback(
    async (password: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError((body.error as string) ?? "Anmeldung fehlgeschlagen.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Anmeldung fehlgeschlagen.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const logout = useCallback(async () => {
    await fetch("/api/admin", { method: "DELETE" });
    await load();
  }, [load]);

  return { state, error, busy, login, logout };
}
