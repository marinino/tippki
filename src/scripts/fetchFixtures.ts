// Holt Spielplan und Team-Logos von OpenLigaDB.
//
//   npm run fetch-fixtures
//   npm run fetch-fixtures -- --season=2026
//
// Muss regelmaessig laufen, nicht einmal vor der Saison. Die DFL setzt die genauen
// Anstosszeiten erst sechs bis acht Wochen im Voraus an; bis dahin liegt bei OpenLigaDB
// jede Partie im Standardslot samstags 15:30. Fuer die Anzeige waere das ein
// Schoenheitsfehler -- fuer die Automatik ist es einer mit Folgen: das Recherchefenster
// berechnet sich aus dem ERSTEN Anpfiff eines Spieltags. Steht dort samstags 15:30,
// waehrend in Wirklichkeit freitags um 20:30 eroeffnet wird, recherchiert die Automatik am
// Samstagmittag -- also nach dem Freitagsspiel.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseKickoff } from "../data/kickoff";
import { OPENLIGADB_TO_OUR_NAME } from "../data/openligaTeamNames";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");

// Ein automatischer Lauf ueberschreibt den Spielplan ungefragt. Liefert OpenLigaDB nach
// einer Stoerung eine halbe Saison, darf das nicht die ganze Datei ersetzen -- der
// Spielplan traegt die Zeitsteuerung der gesamten Automatik.
const MIN_SHARE_OF_EXISTING = 0.9;

interface OpenLigaTeam {
  teamName: string;
  teamIconUrl: string;
}

interface OpenLigaMatch {
  matchDateTime: string;
  team1: OpenLigaTeam;
  team2: OpenLigaTeam;
  group: { groupOrderID: number; groupName: string };
}

interface Fixture {
  homeTeam: string;
  awayTeam: string;
  date: string;
  matchday: number;
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

const season = flag("season") ?? "2026";

const res = await fetch(`https://api.openligadb.de/getmatchdata/bl1/${season}`);
if (!res.ok) throw new Error(`OpenLigaDB-Abruf fehlgeschlagen: ${res.status}`);
const matches: OpenLigaMatch[] = await res.json();

const unmapped = new Set<string>();
const logosFromApi: Record<string, string> = {};

const fixtures: Fixture[] = matches
  .map((m) => {
    const homeTeam = OPENLIGADB_TO_OUR_NAME[m.team1.teamName];
    const awayTeam = OPENLIGADB_TO_OUR_NAME[m.team2.teamName];
    if (!homeTeam) unmapped.add(m.team1.teamName);
    if (!awayTeam) unmapped.add(m.team2.teamName);

    if (homeTeam && m.team1.teamIconUrl) logosFromApi[homeTeam] = m.team1.teamIconUrl;
    if (awayTeam && m.team2.teamIconUrl) logosFromApi[awayTeam] = m.team2.teamIconUrl;

    return {
      homeTeam: homeTeam ?? m.team1.teamName,
      awayTeam: awayTeam ?? m.team2.teamName,
      date: m.matchDateTime,
      matchday: m.group.groupOrderID,
    };
  })
  .sort((a, b) => parseKickoff(a.date).getTime() - parseKickoff(b.date).getTime());

if (unmapped.size > 0) {
  console.warn("WARNUNG: Teams ohne Namens-Mapping:", [...unmapped]);
}

// Jede Anstosszeit muss lesbar sein, bevor sie den bisherigen Spielplan ersetzt. Eine
// einzige unlesbare Zeile wuerde die Automatik an einem Spieltag stumm ausfallen lassen.
for (const f of fixtures) {
  if (Number.isNaN(parseKickoff(f.date).getTime())) {
    throw new Error(`Unlesbare Anstosszeit von OpenLigaDB: "${f.date}"`);
  }
}

const fixturesPath = join(DATA_DIR, "fixtures.json");
const bisher: Fixture[] = existsSync(fixturesPath)
  ? JSON.parse(readFileSync(fixturesPath, "utf-8"))
  : [];

if (bisher.length > 0 && fixtures.length < bisher.length * MIN_SHARE_OF_EXISTING) {
  throw new Error(
    `OpenLigaDB lieferte nur ${fixtures.length} Partien, bisher waren es ${bisher.length}. ` +
      `Der Spielplan wird NICHT ersetzt -- das sieht nach einer Stoerung aus, und an ihm ` +
      `haengt die Zeitsteuerung der Automatik.`
  );
}

// Was sich an Anstosszeiten geaendert hat, gehoert in die Ausgabe: genau das verschiebt
// die Recherchefenster, und im Job-Bericht ist es sonst nicht zu sehen.
const bisherByKey = new Map(bisher.map((f) => [`${f.matchday}|${f.homeTeam}|${f.awayTeam}`, f]));
const verschoben: string[] = [];
for (const f of fixtures) {
  const alt = bisherByKey.get(`${f.matchday}|${f.homeTeam}|${f.awayTeam}`);
  if (alt && alt.date !== f.date) {
    verschoben.push(`  Spieltag ${f.matchday}: ${f.homeTeam} - ${f.awayTeam}  ${alt.date} -> ${f.date}`);
  }
}

writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2));
console.log(`${fixtures.length} Spiele der Saison ${season}/${Number(season) + 1} -> data/fixtures.json`);

if (verschoben.length > 0) {
  console.log(`\n${verschoben.length} Anstosszeiten verschoben:`);
  for (const line of verschoben.slice(0, 40)) console.log(line);
  if (verschoben.length > 40) console.log(`  ... und ${verschoben.length - 40} weitere`);
} else if (bisher.length > 0) {
  console.log("Keine Anstosszeit verschoben.");
}

// Logos: bestehende Eintraege bleiben stehen, nur fehlende kommen dazu. Einige sind von
// Hand gesetzt (OpenLigaDB fuehrt nicht fuer jeden Verein ein brauchbares Wappen) -- ein
// automatischer Lauf, der sie ueberschreibt, macht dieselbe Handarbeit jede Woche noetig.
const logosPath = join(DATA_DIR, "teamLogos.json");
const bestehende: Record<string, string> = existsSync(logosPath)
  ? JSON.parse(readFileSync(logosPath, "utf-8"))
  : {};

const ergaenzt: string[] = [];
const logos = { ...bestehende };
for (const [team, url] of Object.entries(logosFromApi)) {
  if (!logos[team]) {
    logos[team] = url;
    ergaenzt.push(team);
  }
}

writeFileSync(logosPath, JSON.stringify(logos, null, 2));
console.log(
  `\n${Object.keys(logos).length} Team-Logos -> data/teamLogos.json ` +
    `(${Object.keys(bestehende).length} unveraendert übernommen, ${ergaenzt.length} ergaenzt` +
    (ergaenzt.length > 0 ? `: ${ergaenzt.join(", ")}` : "") +
    ")"
);
