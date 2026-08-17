// Gepaarte Signifikanztests fuer Modellvergleiche.
//
// WARUM DAS HIER STEHT: bei n = 2448 Spielen und p ~ 0.525 ist der Standardfehler der
// Trefferquote sqrt(0.525 * 0.475 / 2448) = 1.01 Prozentpunkte. Das 95%-Intervall um
// 52.5% reicht also von ~50.5% bis ~54.5%. Jede in diesem Projekt bisher dokumentierte
// Verbesserung (50.7 -> 51.3 -> 52.3 -> 52.5 -> 53.0) liegt schrittweise INNERHALB
// dieses Rauschens und ist mit einem ungepaarten Vergleich schlicht nicht belegbar.
//
// Der Ausweg ist der GEPAARTE Vergleich: zwei Varianten sehen exakt dieselben Spiele
// und stimmen auf den allermeisten davon ueberein. Nur die Spiele, auf denen sie sich
// unterscheiden, tragen Information -- und ueber die laesst sich sehr wohl entscheiden.
//
// Keine Dependencies: McNemar exakt ueber die Binomialverteilung, Bootstrap ueber einen
// eigenen PRNG.

// Kleiner, schneller PRNG mit reproduzierbarem Seed. Ein ungeseedeter Bootstrap, der bei
// jedem Lauf einen anderen p-Wert liefert, ist schlechter als gar keiner -- dann laesst
// sich naemlich so lange neu wuerfeln, bis das Ergebnis gefaellt.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface McNemarResult {
  b: number;
  c: number;
  pValue: number;
}

// Exakter zweiseitiger McNemar-Test fuer den Vergleich zweier Klassifikatoren auf
// denselben Spielen.
//   b = Variante A richtig, Variante B falsch
//   c = Variante A falsch,  Variante B richtig
// Uebereinstimmende Spiele (beide richtig / beide falsch) tragen nichts bei und werden
// gar nicht erst uebergeben. Unter H0 ist b ~ Binomial(b + c, 0.5).
//
// Die Binomialkoeffizienten werden im Log-Raum akkumuliert, sonst laeuft C(600, 300)
// ueber, lange bevor der Test bei realistischen Stichprobengroessen gebraucht wird.
export function mcnemarExact(b: number, c: number): McNemarResult {
  const n = b + c;
  if (n === 0) return { b, c, pValue: 1 };

  const k = Math.min(b, c);
  let logTerm = -n * Math.LN2; // log(C(n,0) * 0.5^n)
  let sum = Math.exp(logTerm);

  for (let i = 0; i < k; i++) {
    logTerm += Math.log(n - i) - Math.log(i + 1); // C(n,i+1) / C(n,i)
    sum += Math.exp(logTerm);
  }

  return { b, c, pValue: Math.min(1, 2 * sum) };
}

export interface BootstrapResult {
  meanDiff: number;
  ciLow: number;
  ciHigh: number;
  pValue: number;
  iterations: number;
  n: number;
}

export interface BootstrapOptions {
  iterations?: number;
  seed?: number;
}

const DEFAULT_ITERATIONS = 10000;
const DEFAULT_SEED = 20260817;

// Gepaarter Bootstrap auf den spielweisen Metrikdifferenzen (metrikA[i] - metrikB[i],
// gleiche Spiele in gleicher Reihenfolge). Fuer stetige Metriken wie RPS oder Punkte,
// wo McNemar nicht anwendbar ist.
//
// Resampled werden die INDIZES mit Zuruecklegen -- dadurch bleibt die Paarung erhalten,
// was den ganzen Punkt der Uebung ausmacht.
export function pairedBootstrap(diffs: number[], opts: BootstrapOptions = {}): BootstrapResult {
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const n = diffs.length;

  if (n === 0) {
    return { meanDiff: 0, ciLow: 0, ciHigh: 0, pValue: 1, iterations: 0, n: 0 };
  }

  const observedMean = diffs.reduce((sum, d) => sum + d, 0) / n;

  const random = mulberry32(opts.seed ?? DEFAULT_SEED);
  const means = new Float64Array(iterations);

  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += diffs[Math.floor(random() * n)];
    }
    means[it] = sum / n;
  }

  means.sort();

  const ciLow = means[Math.floor(0.025 * (iterations - 1))];
  const ciHigh = means[Math.ceil(0.975 * (iterations - 1))];

  // Nicht-strikte Vergleiche auf beiden Seiten: sind alle Differenzen exakt 0 (die
  // beiden Varianten tippen identisch), liefern beide Anteile 1 und der p-Wert wird 1.
  // Mit strikten Vergleichen kaeme in genau diesem Fall p = 0 heraus -- also maximale
  // Signifikanz fuer "es hat sich nichts geaendert".
  let leqZero = 0;
  let geqZero = 0;
  for (let it = 0; it < iterations; it++) {
    if (means[it] <= 0) leqZero++;
    if (means[it] >= 0) geqZero++;
  }

  const pValue = Math.min(1, (2 * Math.min(leqZero, geqZero)) / iterations);

  return { meanDiff: observedMean, ciLow, ciHigh, pValue, iterations, n };
}

export function formatBootstrap(label: string, r: BootstrapResult): string {
  const sig = r.pValue < 0.01 ? "**" : r.pValue < 0.05 ? "* " : "  ";
  return (
    `${label.padEnd(28)} Δ ${r.meanDiff >= 0 ? "+" : ""}${r.meanDiff.toFixed(4)}  ` +
    `95% CI [${r.ciLow >= 0 ? "+" : ""}${r.ciLow.toFixed(4)}, ${r.ciHigh >= 0 ? "+" : ""}${r.ciHigh.toFixed(4)}]  ` +
    `p = ${r.pValue.toFixed(4)} ${sig}`
  );
}

export function formatMcNemar(label: string, r: McNemarResult): string {
  const sig = r.pValue < 0.01 ? "**" : r.pValue < 0.05 ? "* " : "  ";
  return (
    `${label.padEnd(28)} A besser auf ${String(r.b).padStart(4)}, ` +
    `B besser auf ${String(r.c).padStart(4)}  p = ${r.pValue.toFixed(4)} ${sig}`
  );
}
