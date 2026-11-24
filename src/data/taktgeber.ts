// Lebt der Taktgeber? (SAISONBETRIEB.md, "Taktgeber")
//
// Anlass (24.11.2026): der externe Taktgeber galt seit dem 18.11. als umgesetzt und hatte
// bis dahin keinen einzigen Lauf gestartet. Aufgefallen ist das erst nach Anpfiff von
// Spieltag 10, ueber die fehlenden Anpfiff-Schnappschuesse -- fuer acht Partien zu spaet.
// forward-log-check sieht nur den Schaden, und zwar erst, wenn er eingetreten ist. Diese
// Pruefung sieht die Ursache, Tage vorher: kam in den letzten 24 Stunden ueberhaupt ein
// Lauf vom Taktgeber an?
//
// Erkannt wird ein Taktgeber-Lauf am Titel. spielkontext.yml setzt dafuer den run-name
// "Spielkontext (<grund>)", und der Taktgeber schickt grund=taktgeber. Der Knopf auf der
// Seite schickt grund=manuell, und GitHubs eigener Zeitplan heisst "planmaessig".

// Der Takt aus SAISONBETRIEB.md: viertelstuendlich, in jeder Stunde von 8 bis 18 Uhr UTC.
export const TAKTGEBER_STUNDEN_UTC = { von: 8, bis: 18 } as const;

// 11 Stunden zu je 4 Ticks. Ein Fenster von genau 24 Stunden enthaelt jeden Tick des Tages
// genau einmal, gleich zu welcher Uhrzeit die Pruefung laeuft -- deshalb steht das Fenster
// fest und ist kein Parameter.
export const TAKTGEBER_TICKS_PRO_TAG = 4 * (TAKTGEBER_STUNDEN_UTC.bis - TAKTGEBER_STUNDEN_UTC.von + 1);
export const TAKTGEBER_FENSTER_STUNDEN = 24;

// Die Felder, die die Actions-API je Lauf liefert und die hier gebraucht werden.
export interface WorkflowRunSummary {
  event: string;
  display_title: string;
  created_at: string;
}

export function isTaktgeberRun(run: WorkflowRunSummary): boolean {
  return run.event === "workflow_dispatch" && run.display_title.includes("(taktgeber)");
}

//   lebt   -- mindestens die Haelfte der erwarteten Ticks kam an
//   duenn  -- weniger als die Haelfte: frisch eingerichtet, oder cron-job.org verliert
//             Aufrufe. Nur ein Hinweis, kein Alarm.
//   stumm  -- kein einziger. Das ist der Alarm.
export type TaktgeberStatus = "lebt" | "duenn" | "stumm";

export interface TaktgeberBefund {
  status: TaktgeberStatus;
  seit: string;
  taktgeber: number;
  erwartet: number;
  // workflow_dispatch-Laeufe ohne grund=taktgeber. Kommen solche an und Taktgeber-Laeufe
  // nicht, schickt der Taktgeber vermutlich den falschen Request-Body.
  andereDispatch: number;
  juengster: string | null;
}

export function taktgeberBefund(runs: readonly WorkflowRunSummary[], now: Date): TaktgeberBefund {
  const seit = now.getTime() - TAKTGEBER_FENSTER_STUNDEN * 3600000;
  const imFenster = runs.filter((r) => {
    const t = new Date(r.created_at).getTime();
    return t >= seit && t <= now.getTime();
  });
  const takt = imFenster.filter(isTaktgeberRun);
  const andere = imFenster.filter((r) => r.event === "workflow_dispatch" && !isTaktgeberRun(r));
  const erwartet = TAKTGEBER_TICKS_PRO_TAG;
  let juengster: string | null = null;
  for (const r of takt) {
    if (juengster === null || new Date(r.created_at) > new Date(juengster)) juengster = r.created_at;
  }
  const status: TaktgeberStatus =
    takt.length === 0 ? "stumm" : takt.length * 2 < erwartet ? "duenn" : "lebt";
  return {
    status,
    seit: new Date(seit).toISOString(),
    taktgeber: takt.length,
    erwartet,
    andereDispatch: andere.length,
    juengster,
  };
}
