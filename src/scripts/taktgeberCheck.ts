// Schlaegt Alarm, wenn der externe Taktgeber in den letzten 24 Stunden keinen einzigen
// Spielkontext-Lauf gestartet hat. Regel und Anlass: src/data/taktgeber.ts.
//
//   npm run taktgeber-check
//
// Laeuft in der Nachbereitung, montags, dienstags und donnerstags -- also vor jedem
// Spielwochenende und nicht erst nach dem ersten verpassten Anpfiff wie forward-log-check.
// Lokal geht es ohne Token, weil das Repository oeffentlich ist. Nach einer Aenderung bei
// cron-job.org ist das der schnellste Test, ob die Aufrufe auch ankommen.
//
// Exit 1, wenn kein einziger Taktgeber-Lauf ankam oder die Actions-API nicht antwortet:
// eine Pruefung, die nicht pruefen konnte, darf nicht gruen aussehen.

import { readFileSync } from "fs";
import { join } from "path";
import {
  TAKTGEBER_FENSTER_STUNDEN,
  TAKTGEBER_STUNDEN_UTC,
  taktgeberBefund,
  type WorkflowRunSummary,
} from "../data/taktgeber";

// In Actions setzt GitHub GITHUB_REPOSITORY. Lokal steht das Repository in package.json.
function repository(): string {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
  const m = String(pkg.repository?.url ?? "").match(/github\.com[/:]([^/]+\/[^/.]+)/);
  if (!m) throw new Error('Repository unbekannt. GITHUB_REPOSITORY auf "eigentuemer/repo" setzen.');
  return m[1];
}

const now = new Date();
// Ohne Millisekunden: so steht das Datum in GitHubs Suchsyntax fuer `created`.
const seit = new Date(now.getTime() - TAKTGEBER_FENSTER_STUNDEN * 3600000)
  .toISOString()
  .replace(/\.\d{3}Z$/, "Z");
const headers: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const runs: WorkflowRunSummary[] = [];
try {
  const repo = repository();
  for (let page = 1; page <= 5; page++) {
    const url =
      `https://api.github.com/repos/${repo}/actions/workflows/spielkontext.yml/runs` +
      `?event=workflow_dispatch&created=${encodeURIComponent(`>=${seit}`)}&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Actions-API antwortet ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const batch = ((await res.json()) as { workflow_runs?: WorkflowRunSummary[] }).workflow_runs ?? [];
    runs.push(...batch);
    if (batch.length < 100) break;
  }
} catch (err) {
  console.log(`Taktgeber nicht pruefbar: ${err instanceof Error ? err.message : String(err)}`);
  console.log("Ohne diese Pruefung meldet sich ein stummer Taktgeber erst nach dem naechsten Anpfiff.");
  process.exit(1);
}

const b = taktgeberBefund(runs, now);
const takt = `viertelstuendlich ${TAKTGEBER_STUNDEN_UTC.von}-${TAKTGEBER_STUNDEN_UTC.bis} Uhr UTC`;
console.log(`Spielkontext-Laeufe seit ${b.seit} (${TAKTGEBER_FENSTER_STUNDEN} Stunden):`);
console.log(`  ${b.taktgeber} vom Taktgeber (grund=taktgeber), erwartet ${b.erwartet} (${takt})`);
console.log(`  ${b.andereDispatch} andere ueber workflow_dispatch (Knopf auf der Seite, von Hand)`);
if (b.juengster) console.log(`  juengster Taktgeber-Lauf: ${b.juengster}`);

if (b.status === "lebt") {
  console.log("\nDer Taktgeber lebt.");
} else if (b.status === "duenn") {
  console.log(
    "\nHinweis: weniger als die Haelfte der erwarteten Laeufe. Frisch eingerichtet? Sonst bei\n" +
      "cron-job.org den Verlauf ansehen -- jeder verlorene Tick ist eine Chance weniger, ein\n" +
      "Recherche- oder Einfrierfenster zu treffen."
  );
} else {
  console.log(
    "\nKein einziger Lauf vom Taktgeber. Dann startet nur GitHubs eigener Zeitplan den\n" +
      "Spielkontext, zwei- bis dreimal am Tag, und Recherche und Anpfiff-Schnappschuesse des\n" +
      "naechsten Spieltags fallen fast sicher aus. Bei cron-job.org den Verlauf des Jobs\n" +
      "ansehen: 204 heisst angenommen, 401 Token falsch oder abgelaufen, 403 oder 404 fehlende\n" +
      "Berechtigung (Actions: Read and write), Tippfehler im Pfad oder GET statt POST. Fehlt\n" +
      'der Job oder ist er deaktiviert: SAISONBETRIEB.md, Abschnitt "Taktgeber".'
  );
  if (b.andereDispatch > 0) {
    console.log(
      "\nAndere workflow_dispatch-Laeufe kamen an. Schickt der Taktgeber den Request-Body\n" +
        '{"ref":"main","inputs":{"grund":"taktgeber"}}? Ohne grund=taktgeber zaehlt sein Lauf nicht.'
    );
  }
}

process.exit(b.status === "stumm" ? 1 : 0);
