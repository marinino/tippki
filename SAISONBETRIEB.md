# Saisonbetrieb 2026/27

Die Saison ist der Vorwärtstest. Alles, was hier steht, dient einem Zweck: dass die Zahl am
Saisonende etwas bedeutet.

Eingefroren am **2026-08-19**, vor dem ersten Spieltag (28.08.2026).

```
Konfigurations-Hash    8ccc38ce
Prompt-Fingerabdruck   d7212c76
Zuordnungs-Abdruck     0c522175
LLM-Modell             claude-haiku-4-5
Kalibrierungstemperatur 1,20
```

Die Temperatur ist die letzte Änderung vor dem Einfrieren. Gescannt auf Validation
(2018–2022, 1529 Spiele), Testset unangetastet: mittlerer Kalibrierungsfehler 2,62 → 1,21
Prozentpunkte, LogLoss 1,0035 → 0,9954 (p < 0,0001), und die Verbesserung trägt jede der
fünf Saisons einzeln. Details und Messtabelle in `scoreMatrix.ts`.

---

## Der Ablauf je Spieltag

Die Reihenfolge ist nicht kosmetisch.

**Donnerstag, vor dem Spieltag**

```bash
npm run refresh-llm
```

Recherchiert Ausfälle, Belastung und Motivation für alle neun Partien. Kostet rund 0,11 USD
je Aufruf. Nur von Hand, nie automatisch — der inhaltliche Wert hängt am Zeitpunkt, und ein
Aufruf zehn Tage vorher überschreibt den Cache mit einem leeren Befund.

```bash
npm run forward-log
```

Friert beide Varianten ein, `model` und `withLlm`, für jede Partie. **Erst nach
`refresh-llm`.** Läuft es vorher, fällt `withLlm` mit `model` zusammen, und die
Idempotenz-Prüfung überspringt die Partien danach — die Zeilen wären dauerhaft wertlos für
den gepaarten Test.

**Nach dem Spielwochenende**

```bash
npm run refresh
npm run refresh-market
npm run forward-eval
```

`refresh` holt Ergebnisse (OpenLigaDB) und xG (Understat), `refresh-market` die
Buchmacher-Schlussquoten von football-data. Die kommen ein bis drei Tage nach dem Spieltag —
zu früh abgerufen fehlen sie noch. `forward-eval` rechnet ab: Spielkontext gegen Basismodell,
beide gegen den Buchmacher.

---

## Eingefroren — nicht anfassen

**Die Faustregel: steht es im `configHash`, ist es eingefroren.** Das ist keine Konvention,
sondern mechanisch geprüft — [selfCheck.ts](src/scripts/selfCheck.ts), Abschnitt
„Konfigurations-Hash", geht jedes einzelne Feld durch und verlangt, dass es den Hash bewegt.

| Was | Wo | Wert |
|---|---|---|
| Saison-Gewichte | `teamStrength.ts` | `SEASON_RECENCY_WEIGHTS` |
| Form-Fenster und -Gewicht | `xgForm.ts` | `XG_FORM_WINDOW`, `XG_FORM_WEIGHT` |
| Matrix-Parameter | `scoreMatrix.ts` | `RHO`, `DRAW_BOOST`, `MAX_GOALS` |
| Kalibrierungstemperatur | `scoreMatrix.ts` | `DEFAULT_OUTCOME_TEMPERATURE` = 1,20 |
| Ridge | `pipelineConfig.ts` | `ridgePseudoMatches` |
| LLM-Dämpfung | `llmAdjustment.ts` | `DEFAULT_LLM_GAIN` = 0,6 |
| LLM-Klammer | `llmAdjustment.ts` | `DEFAULT_LLM_MAX_LOG_ADJUSTMENT` = 0,15 |
| Rechercheanweisung | `matchContext.ts` | `SYSTEM_PROMPT`, `buildMatchdayPrompt` |
| Faktengewichte | `factMapping.ts` | `ROLE_WEIGHTS`, `IMPORTANCE_SCALE`, Aggregation |
| Sprachmodell | `modelProfile.ts` / `LLM_MODEL` | `claude-haiku-4-5` |

**Warum.** Der LLM-Layer lässt sich nicht backtesten — das Modell hinter dem LLM kennt den
Ausgang alter Spiele. Das Vorwärts-Log ist die einzige ehrliche Evidenz, die es je geben
wird. Diese Parameter im Saisonverlauf an den eigenen Ergebnissen nachzuziehen verbrennt sie
genauso, wie Tunen auf dem Testset das Testset verbrennt — nur ohne Rettungsanker: ein
zweites Vorwärtsjahr kostet ein Jahr.

Dazu die Fallzahl. 306 Spiele je Saison, davon vielleicht die Hälfte mit echtem Unterschied.
Ein Effekt von 0,005 RPS — die Größenordnung, die den Marktabstand schließen würde — braucht
ein Vielfaches davon. Was nach zehn Spieltagen sichtbar wird, ist Rauschen, und ein
Parameter, der auf Rauschen gedreht wird, wird schlechter.

**Wie lange.** Nicht bis Saisonende, sondern bis genug Vorwärtsevidenz da ist, sie zu
bewegen. Realistisch zwei bis drei Saisons. 0,6 ist ein bewusst zurückhaltender Prior, kein
gefitteter Wert.

**Was passiert, wenn doch.** Der Hash ändert sich, `forward-eval` gruppiert danach und
weigert sich ohne `--pool`, darüber hinweg zu mitteln. Aus einer Saison à 306 werden zwei à
150, und keine davon löst etwas auf. Das ist kein Schutz vor der Änderung — nur davor, dass
sie unbemerkt bleibt.

---

## Frei — jederzeit änderbar

Alles, was die Vorhersage nicht verändert:

- **Auswertung** (`src/eval/`) — Metriken, Signifikanztests, Kalibrierung, Ausgabeformate.
  Rückwirkend auf alle geloggten Zeilen anwendbar, deshalb harmlos.
- **UI** (`src/app/`) — Darstellung, Sortierung, was angezeigt wird.
- **Skripte und CLI-Ausgaben** (`src/scripts/`) — solange sie nichts an der Pipeline drehen.
- **Datenaktualisierung** — `refresh`, `refresh-market`, Teamnamen-Zuordnungen, Fixtures.
- **Tests** — neue Prüfungen sind immer willkommen.

---

## Beobachten, aber nicht nachdrehen

Diese drei Dinge sagen etwas über das *Verhalten* des Layers, nicht über seine Trefferquote.
Sie kosten deshalb nichts und sollten laufend angeschaut werden:

1. **Größe der Korrekturen** — `homeLogAdj` / `awayLogAdj` in jeder Logzeile, in der UI als
   „Torerwartung Heim −8 %, Auswärts +6 %". Liegen sie durchweg bei 0,01, ist der Layer
   faktisch inert und die Frage nach dem richtigen Gain verfrüht.
2. **Wie oft die Klammer greift** — schlägt sie ständig an, ist die Recherche zu
   enthusiastisch oder die Aggregation zu additiv.
3. **Qualität der Fakten** — findet das LLM die Ausfälle, die es wirklich gab? War
   „bestätigt" bestätigt? Stimmen die Quellen? Das prüfst du gegen die öffentliche Realität,
   nicht gegen Ergebnisse. Hier sitzt vermutlich der größere Hebel: ein falsch extrahierter
   Fakt ist durch keinen Gain zu retten.

Beobachtung ist keine Erlaubnis zum Nachdrehen. Wird ein Befund groß genug, wird er
aufgeschrieben und **nach** der Saison umgesetzt.

---

## Sonderfall: ein echter Fehler

Ein Fehler ist kein Tuning-Wunsch. Fällt in der Saison auf, dass etwas nachweislich falsch
rechnet — nicht „suboptimal", sondern falsch —, wird es repariert. Dann gilt:

1. Reparieren, Grund im Code dokumentieren.
2. Der Hash ändert sich. Das ist richtig so: es *ist* eine andere Pipeline.
3. Im Log stehen ab da zwei Gruppen. `forward-eval` wertet sie getrennt aus. Nicht `--pool`
   benutzen, um das zu übertünchen.

Die Grenze ist nicht immer scharf. Der Test: lässt sich die Änderung begründen, **ohne** auf
die Ergebnisse dieser Saison zu schauen? Dann ist es eine Reparatur. Sonst ist es Tuning.

---

## Am Saisonende

`npm run forward-eval` über die volle Saison. Erwartungshaltung: die Zahl wird das
Konfidenzintervall nicht verlassen. Das ist kein Scheitern, sondern die Fallzahl — 306 Spiele
sind ein Anfang, keine Antwort. Der Wert liegt darin, dass die Zahl **ehrlich** ist und mit
der nächsten Saison zusammengelegt werden kann.

Erst dann werden die eingefrorenen Parameter wieder angefasst.
