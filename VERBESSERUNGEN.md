# Verbesserungen

Gesammelt aus den Fragerunden über den Code. Hier steht, was auffiel — nicht, was schon
repariert ist. Erledigtes wandert nach unten unter *Abgeschlossen*, mit Commit.

**Eine Regel gilt über allem:** die Konfiguration ist am 2026-08-19 eingefroren
(`SAISONBETRIEB.md`). Jede Änderung, die den `configHash` bewegt, spaltet das
Vorwärts-Log. Punkte, die das täten, sind unten als **[eingefroren]** markiert — sie
werden gemessen und dokumentiert, umgestellt wird zur nächsten Saison.

---

## Offen

### 1. Produktiv läuft die Formkurve, die der eigene Kommentar als doppelte Zählung beschreibt [eingefroren]

`src/model/xgForm.ts`, `src/model/predictPipeline.ts:80`

`predictPipeline` multipliziert `baseLambdas` (enthält attack/defense) mit
`exp(XG_FORM_WEIGHT * computeXgForm(...))` — der rohen xG-Differenz. Die korreliert laut
`npm run form` mit r = 0,73 mit eben diesen Stärken, die Stärke geht also zweimal ein.
Der Kommentar über `computeXgFormResidual` beschreibt das ausführlich, inklusive der
Größenordnung (dauerhaft +36 % für ein Team, das den Bonus nicht verdient hat).

Die Alternative existiert und ist messbar: `backtestCore.ts:415` hat
`formMode: "diff" | "residual"`. Kein produktiver Aufrufer setzt ihn — `predict.ts`,
`forwardLog.ts`, `simulateSeason.ts` und `/api/predictions` nehmen ausnahmslos die rohe
Variante.

**Nächster Schritt:** `npm run walk-forward` mit `formMode: "residual"` gegen `"diff"`,
gepaart. Ergebnis hierher, Umstellung frühestens zur Saison 2027/28.

**Achtung beim Umstellen:** `formMode` steht nicht in `PipelineConfig`. Ohne Punkt 8
bemerkt der Hash den Wechsel nicht.

### 2. Ein hängender xG-Feed zieht Vorsaison-Spiele ins Formfenster

`src/model/xgForm.ts:131-146`

`n` kommt aus `gamesPlayedThisSeason(...)`, also aus der Ergebnis-CSV. Die Summe läuft
dann über die Understat-Liste, und die ist **nicht** auf die Saison beschränkt:
`start = available - n` indiziert rückwärts über die Saisongrenze hinweg. Fehlt ein Spiel
der laufenden Saison im xG-Feed, entsteht kein Loch im Fenster — es rutscht ein Spiel der
Vorsaison hinein. Genau der Zustand, gegen den das Hochfahren des Fensters gebaut wurde.

Nachgestellt am echten Bestand (Bayern, Stichtag 10.09.2026, n = 2): bei einem Spiel
Rückstand im Feed steht das Spiel vom 16.05.2026 im Fenster, der Formfaktor verschiebt
sich von 1,5892 auf 1,6103.

Möglich, weil `refreshResults.ts:193` beide Quellen mit `Promise.all` holt: scheitert der
Understat-Abruf nach dem CSV-Schreiben, bleibt der halbe Stand liegen.

**Fix:** das Fenster zusätzlich am Saisonanfang abschneiden — nur Einträge mit
`time >= Saisonstart` zählen, statt blind `n` Einträge rückwärts zu nehmen. Verändert die
Zahlen nur in genau der Lage, die ohnehin falsch ist. Betrifft `computeXgForm` **und**
`computeXgFormResidual`. Zusätzlich erwägen: `refreshSeasonData` soll bei halbem Erfolg
laut sein, nicht still.

**Achtung:** dieser Fix ist eine Logikänderung und bewegt den `configHash` **nicht**
(siehe Punkt 8). Erst Punkt 8, dann dieser — sonst mischt das Log beide Varianten unter
derselben Kennung.

### 3. `llmStatus` behauptet "nicht recherchiert" für jeden vergangenen Spieltag

`src/app/api/predictions/route.ts:54`, `src/llm/llmCache.ts:108`

`data/llm_context_cache.json` hält immer nur **einen** Spieltag; ein Refresh überschreibt
den vorherigen. Die UI lässt aber über `availableMatchdays` frei blättern. Sobald
Spieltag 4 recherchiert ist, zeigen alle Partien von Spieltag 3 `"nicht_recherchiert"` —
obwohl dort recherchiert, gefunden und korrigiert wurde. `llmStatusOf` ist korrekt, der
Aufrufer reicht ihm nur `null`.

Das untergräbt genau den Zweck der vier Zustände: der stille Ausfall der Automatik soll
sich vom unauffälligen Spieltag unterscheiden lassen. Beim Zurückblättern tut er es nicht.

**Fix (Vorschlag):** fünfter Zustand `"nicht_mehr_im_cache"`, oder den Status für
vergangene Spieltage aus `data/forward_log.jsonl` lesen — dort steht die Wahrheit, und
die Datei ist append-only.

**Nachtrag 16.09.:** zurückgestellt, geht in Punkt 12 auf. Die angezeigten Zahlen *sind*
für vergangene Spieltage reines Modell (die Route reicht keinen Kontext durch), das
Etikett stimmt also für die Zahlen. Das eigentliche Problem ist, welche Zahlen dort
überhaupt stehen.

### 4. Zwei Stellschrauben des LLM-Layers fehlen im `configHash` [eingefroren]

`src/llm/matchContext.ts:254`, `src/llm/anthropicClient.ts:66`

- `EXTRACTION_BLOCK_SIZE = 3` — `canonicalUserPrompt()` rendert zwei feste Fixtures und
  sieht die Blockgröße nie. Dass diese Zahl das Ergebnis verändert, ist hier keine
  Theorie: der Ausfall an Spieltag 1 hing genau daran.
- `MAX_SEARCHES = 14` — bestimmt, wie viel die Recherche überhaupt findet, und taucht im
  Abdruck nirgends auf. `searchErrors` protokolliert bereits, wenn das Limit greift.

Beide gehören in `PipelineConfig` und in `configHash()`. **Aber:** das Aufnehmen ändert
den Hash und spaltet das Log. Also entweder jetzt mit bewusstem Schnitt, oder zur
nächsten Saison zusammen mit Punkt 1.

### 6. Die Formkurve ist ungeklammert und größer als der geklammerte LLM-Layer [eingefroren]

`src/model/predictPipeline.ts:80`, `src/llm/llmAdjustment.ts:43`

Der LLM-Layer wird auf ±0,15 im Log-Raum geklammert, mit der Begründung, dass er auf
schwacher Basis steht und nur nachjustieren darf. Die Formkurve hat eine noch schwächere
Basis (drei Spiele, zählt Stärke doppelt, siehe Punkt 1) und gar keine Klammer.

Gemessen über 6.786 Team-Spiele seit 2015:

| | Log-Wert | Faktor |
|---|---|---|
| LLM realistisch (Schlüsselstürmer fehlt, nach Gain) | 0,06 | −6 % |
| LLM Maximum | 0,15 | −14 % / +16 % |
| Form Schalke, 12.09.2026 | 0,55 | −42 % |
| Form historisches Maximum (Schalke, 26.09.2020) | 0,89 | −59 % |

Anteil der Spiele, in denen `|0,2 × form|` über der LLM-Klammer liegt: **roh 42,4 %,
residual 28,1 %**. Auch die Residual-Variante braucht also eine Grenze.

**Nächster Schritt:** im Walk-forward eine geklammerte Form messen (z. B. ±0,15 oder
±0,25), zusammen mit Punkt 1. Umstellung zur nächsten Saison.

### 8. Der `configHash` sieht keine Logikänderung auf der Modellseite

`src/model/pipelineConfig.ts:189`, `SAISONBETRIEB.md` (Sonderfall)

`configHash()` hasht 13 Werte: zehn Zahlen, zwei LLM-Fingerabdrücke, den Modellnamen.
Keiner davon sieht Code in `xgForm.ts`, `teamStrength.ts`, `predictMatch.ts` oder
`scoreMatrix.ts`. Eine Reparatur dort, etwa Punkt 2, lässt den Hash unverändert, und das
Log sammelt alte und neue Logik unter derselben Kennung.

Damit trägt der Reparaturprozess in `SAISONBETRIEB.md` nicht: „Der Hash ändert sich. Das
ist richtig so" stimmt nur für Änderungen an Zahlen. Für den LLM-Layer ist genau dieses
Problem mit `llmMappingFingerprint` (Verhalten statt Konstanten) bereits gelöst, für die
Modellseite nicht.

**Fix (Vorschlag), zwei Stufen:**
1. Sofort: `modelLogicVersion` als Feld in `PipelineConfig` und im Hash, bei jeder
   Logikreparatur von Hand hochzählen. Plus eine Zeile im Sonderfall-Abschnitt.
2. Besser: ein Verhaltensabdruck wie beim LLM-Layer. `buildDixonColesMatrix`,
   `applyOutcomeTemperature` und `baseLambdas` lassen sich auf festen Eingaben rechnen und
   hashen. `computeXgForm` liest Dateien und braucht dafür erst eine injizierbare
   Datenquelle.

Stufe 1 bewegt den Hash einmalig; das ist ein bewusster Schnitt und gehört vor jede
weitere Reparatur auf der Modellseite.

### 14. Ein zuverlässiger Auslöser statt GitHubs Zeitplan (optional)

`.github/workflows/spielkontext.yml`, `src/data/dispatchWorkflow.ts`

Rest von Punkt 13. Das breitere Fenster, das Basis-Log ab 48 Stunden und der Alarm machen
den Betrieb robust gegen ausgelassene Ticks, aber nicht unabhängig davon. Liefert GitHub an
einem Freitag zwischen 200 und 90 Minuten vor Anpfiff keinen einzigen Lauf, bleibt der
Spieltag ohne Kontext (Basis ist gesichert, Alarm meldet sich nicht, weil Zeilen da sind).

Ein externer Zeitplan, der `workflow_dispatch` auslöst, würde das Fenster zuverlässig
treffen. Der Weg existiert schon (`dispatchWorkflow`). Erst angehen, wenn die nächsten
Spieltage zeigen, dass das Fenster trotz allem verfehlt wird — `llm: null` in den Zeilen
eines Spieltags ist das Signal.

### 12. Vergangene Spieltage zeigen weder die echte noch eine ehrliche Vorhersage

`src/app/api/predictions/route.ts:48-49`

Die Route fittet für **jeden** gewählten Spieltag `buildLeagueModel(loadAllMatches())`,
also mit allen bisherigen Ergebnissen, auch denen des angezeigten Spieltags. Wer
zurückblättert, sieht Zahlen, die weder vor Anpfiff so geloggt wurden noch vor Anpfiff so
hätten entstehen können. Nirgends gekennzeichnet.

Gemessen an den 18 abgeschlossenen Partien mit Variante `model` (Spieltag 1 und 2):

| | Abweichung Heimsieg | RPS |
|---|---|---|
| echte Vorhersage (Log) | — | 0,2436 |
| ehrlich nachgerechnet (heutiger Fit, nur Spiele vor Anpfiff) | 12,0 pp zum Log | 0,2051 |
| Anzeige heute | 2,4 pp zu „ehrlich", max. 10,6 pp | 0,1834 |

Die 12 pp gehen auf die Fit-Reparatur vom 10.09. zurück, die 2,4 pp auf das
Ergebniswissen. Größter Einzelfall durch Ergebniswissen: Elversberg–Leverkusen 3:2,
ehrlich 11,0 % Heimsieg, angezeigt 21,5 %. Die Anzeige sieht dadurch rund 11 % besser aus,
als ein ehrlich gerechnetes Modell wäre.

Punkt 3 (Status-Etikett beim Zurückblättern) ist ein Teil davon.

**Optionen (Entscheidung offen):**
1. Vergangene Spieltage zeigen die **geloggte** Vorhersage aus `forward_log.jsonl`. Das Log
   enthält 1X2, Torerwartung, Over 2,5, BTTS, Handicaps und die zehn wahrscheinlichsten
   Ergebnisse — kein vollständiges Preisblatt, keine Matrix.
2. Ehrlich nachrechnen (nur Spiele vor Anpfiff) und als „nachträglich gerechnet"
   kennzeichnen.
3. Für vergangene Spieltage nur Ergebnisse zeigen, keine Vorhersage.

---

## Abgeschlossen

### 7. Nach einer gescheiterten Recherche gab es keinen Nachtrag, auch nicht vor Anpfiff

Der Idempotenzschlüssel in `forwardLog.ts` war `Saison|Spieltag|Hash|Heim|Auswärts` und
kannte nicht, ob ein Spielkontext vorlag. Scheiterte die Recherche, schrieb der Workflow
neun Zeilen `llm: null`; eine Reparatur vor Anpfiff erzeugte denselben Hash (nachgerechnet:
`3cc0ddad` mit und ohne Cache) und wurde komplett übersprungen. Der Spieltag war für den
gepaarten Test verloren.

**Umgesetzt** in `src/eval/forwardLogRules.ts`, gemeinsam genutzt von `forwardLog` und
`forwardEval`:
- `logDecision`: eine Partie mit bisher nur kontextlosen Zeilen bekommt einen Nachtrag
  (`"nachtrag": true`), sobald Kontext vorliegt. Eine Zeile **mit** Kontext wird nie
  ersetzt, sonst ließe sich recherchieren, bis der Befund gefällt.
- `latestPerKey`: `forwardEval` wertet je Partie und Hash die zuletzt geschriebene Zeile
  aus. Vorab festgelegt, hängt an keinem Ergebnis.

Geprüft mit 22 Checks im selfCheck und einem Lauf des echten Skripts in einer isolierten
Kopie (9 Zeilen ohne Kontext → 2 Nachträge für die 2 Partien mit Kontext → dritter Lauf
schreibt nichts → `forward-eval` meldet 2 ersetzte Zeilen). Workflow-Kommentar und
`SAISONBETRIEB.md` nachgezogen.

### 11. `erzwingen` überging die 90-Minuten-Grenze, die Doku sagte das Gegenteil

Gefunden beim Umsetzen von Punkt 7. Kommentar an `force` und `SAISONBETRIEB.md` sagten:
das Fenster wird übergangen, die Untergrenze bleibt. Im Code stand `if (force) return due`
vor der Prüfung auf `HARD_FLOOR_MINUTES`, und selfCheck hielt genau das fest. So seit dem
ersten Commit der Datei. Mit dem Nachtrag aus Punkt 7 wäre eine Recherche mit bekannten
Aufstellungen in den gepaarten Test gekommen.

**Entschieden:** die Grenze gilt auch von Hand. **Umgesetzt** in
`src/data/researchWindow.ts` (Untergrenze vor dem Handbetrieb, Meldung „auch von Hand"),
selfCheck-Abschnitt „Recherchefenster" umgedreht und an der Grenze geschärft (100, 90, 89,
30 Minuten). Die Doku stimmte schon und blieb unverändert.

### 9. Ein Admin-Token verriet das Passwort an jeden, der raten kann

Die Signatur war `HMAC-SHA256(Schlüssel = ADMIN_PASSWORD, "tippki-admin-v1|<Ablauf>")`,
Nachricht und Ergebnis standen beide im Token. Wer an ein Token kam, konnte Passwörter
offline durchprobieren. Nachgestellt: `schalke04` aus 120.010 Kandidaten in 0,43 s, rund
280.000 Versuche/s auf einem CPU-Kern.

**Umgesetzt** in `src/data/adminAuth.ts`: signiert wird mit einem eigenen
`ADMIN_TOKEN_SECRET` (≥ 32 Zeichen, nicht das Passwort). Das Passwort geht nur noch als
Fingerabdruck *unter* dem Geheimnis ein — dadurch meldet ein neues Passwort weiterhin alle
Sitzungen ab, ohne dass das Token etwas verrät. selfCheck-Abschnitt „Admin-Token verraet
das Passwort nicht" (15 Checks) prüft unter anderem, dass der alte Angriff mit dem
richtigen Passwort nicht mehr trifft. Die Route-Handler mit vier Konfigurationen
durchgespielt.

**Betrieb:** bei Vercel `ADMIN_TOKEN_SECRET` setzen, sonst ist der Admin-Link nach dem
nächsten Deployment weg. Grund steht dann im Server-Log.

### 10. Die Login-Bremse bremste keinen parallelen Angriff

Der Kommentar versprach, 400 ms je Versuch „machen das Durchprobieren teuer". Parallel
sind es trotzdem 125 Versuche/s bei 50 Anfragen, bezahlt vom Betreiber.

**Umgesetzt** zusammen mit Punkt 9 (dieselbe Datei): Kommentar in der Login-Route
korrigiert, `ADMIN_PASSWORD` muss mindestens 20 Zeichen haben (`MIN_PASSWORD_LENGTH`).
Eine echte Ratenbegrenzung gehört, wenn überhaupt, vor die Funktion und ist nicht Teil
dieser Änderung.

**Betrieb:** ist das Passwort bei Vercel kürzer als 20 Zeichen, ist der Admin-Link nach
dem nächsten Deployment ebenfalls weg.

### 13. Die Automatik hatte das Recherchefenster nie getroffen — Spieltag 3 fehlt komplett

Gefunden am 16.09. beim Nachrechnen von Punkt 3. Im Vorwärts-Log steht **keine einzige
Zeile für Spieltag 3**. Über die öffentliche Actions-API nachvollzogen: der Zeitplan
`*/15 8-16` sah an einem Freitag 36 Läufe vor, GitHub startete an den drei
Spieltags-Freitagen **2, 3 und 2**. Das Fenster war 180 ± 20 Minuten, kein geplanter Lauf
lag je darin.

| Spieltag | geplante Läufe (UTC) | was passiert ist |
|---|---|---|
| 1 (28.08.) | 20:05 (nach Anpfiff) | von Hand, 121 min vor Anpfiff |
| 2 (04.09.) | 12:36, 16:36, 19:09 | von Hand, **31 min** vor Anpfiff |
| 3 (11.09.) | 12:42, 16:46 | **nichts** — beide Läufe „nicht fällig", grün |

Spieltag 3 ist endgültig verloren. `forward-log` lief nur zusammen mit der Recherche, ohne
Fälligkeit wurde auch das Basismodell nicht protokolliert. Und der Ausfall war lautlos.

**Umgesetzt** (Entscheidung 16.09.: Optionen 1, 2 und 4, vor Spieltag 4):
- **Fenster** `researchWindow.ts`: fällig ist der erste Lauf zwischen 200 und 90 Minuten
  vor dem ersten Anpfiff. Regressionstest: der Lauf vom 11.09. um 16:46 UTC ist jetzt
  fällig.
- **Basis-Log** `decideBaseLog`: ab 48 Stunden vor dem ersten Anpfiff protokolliert der
  Workflow das Basismodell auch ohne Recherche; der Nachtrag aus Punkt 7 ergänzt den
  Kontext. Zeitplan jetzt täglich und 08–18 UTC (mit 08–16 wären 13 Spieltage nicht ganz
  abgedeckt gewesen, darunter jeder Freitagsauftakt).
- **Alarm** `npm run forward-log-check`: rot, sobald eine angepfiffene Partie keine
  Logzeile hat. Läuft am Spielabend in `ergebnisse.yml` und in der Nachbereitung.
  Spieltag 3 steht mit Grund in `KNOWN_GAPS`.
- **Auswertung** `forwardEval`: Partien, deren Recherche näher als 90 Minuten an ihrem
  eigenen Anpfiff lag, gehen nicht in den gepaarten Test. Im echten Log genau eine, die
  Freitagspartie von Spieltag 2; ein selfCheck hält fest, dass keine dazukommt.

Option 3, ein externer Auslöser, bleibt als Punkt 14 offen.

### 5. Das Understat-Namensmapping war nur halb bewacht

**Korrektur am Befund:** die Behauptung „unbewachtes Gebiet" war falsch. Seit dem
10.09.2026 prüft selfCheck („xG-Form == Referenzimplementierung"), dass jede Mannschaft der
laufenden Saison einen Eintrag hat. Das wurde in Runde 1 übersehen. Der vorgeschlagene
Umweg über `fixtures.json` bringt praktisch nichts: an Spieltag 1 ist die Form ohnehin 0,
und die Montags-Nachbereitung läuft `npm test`, bevor Spieltag 2 protokolliert wird.

**Die echte Lücke:** geprüft wurde nur, *dass* es einen Eintrag gibt, nicht, ob der
**Wert** in den xG-Daten vorkommt. Ein Tippfehler rechts wäre durchgerutscht, mit
demselben stillen `return 0`.

**Umgesetzt:** der bestehende Abschnitt prüft zusätzlich jeden Wert gegen die Namen in
`xg_bundesliga.json`, sobald der Feed die laufende Saison führt (davor hat ein Aufsteiger
dort keinen Namen). Gegenprobe mit `Elversberg: "Elversburg"` schlägt an; auf dem echten
Stand grün. Aktuell ist kein Wert betroffen.
