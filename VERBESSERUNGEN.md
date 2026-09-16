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

### 5. Das Understat-Namensmapping ist unbewachtes Gebiet

`src/data/understatTeamNames.ts`

Fehlt ein Mapping, steigt `computeXgForm` mit `return 0` aus — das Team läuft still ohne
Form, keine Warnung, keine Spur im Log. Passiert am 10.09.2026, im Kommentar der Datei
dokumentiert. Die Reparatur verändert jede Vorhersage dieses Teams und bewegt den
`configHash` nicht.

**Fix:** kein Hash-Eintrag (das Mapping ist eine Datenzuordnung, keine Stellschraube),
sondern ein Test in `selfCheck.ts`, der prüft, dass **jedes** Team der laufenden Saison
aus `fixtures.json` eine Understat-Zuordnung hat. Fällt dann beim Aufstieg sofort auf
statt nach vier Spieltagen.

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

### 9. Ein Admin-Token verrät das Passwort an jeden, der raten kann

`src/data/adminAuth.ts:23`

Die Signatur ist `HMAC-SHA256(Schlüssel = ADMIN_PASSWORD, "tippki-admin-v1|<Ablauf>")`.
Nachricht und Ergebnis stehen beide im Token. Wer an ein Token kommt, kann Passwörter
**offline** durchprobieren: kein Server, keine 400-ms-Bremse, keine Spur.

Nachgestellt mit dem echten `issueToken`: Passwort `schalke04` aus 120.010 Kandidaten
in 0,43 s gefunden, rund 280.000 Versuche/s auf einem CPU-Kern in Node. Online mit 50
parallelen Anfragen hätten dieselben Kandidaten 960 s gebraucht.

**Fix:** eigenes Signaturgeheimnis `ADMIN_TOKEN_SECRET` (32 zufällige Bytes) statt des
Passworts. Das Token verrät dann nichts mehr über das Passwort. Die Eigenschaft „neues
Passwort entwertet alle Token" geht dabei verloren; stattdessen entwertet ein neues
Geheimnis alle Token.

### 10. Die Login-Bremse bremst keinen parallelen Angriff (niedrige Priorität)

`src/app/api/admin/login/route.ts:11`

Der Kommentar sagt, 400 ms je Versuch „machen das Durchprobieren teuer". Parallel
gesendet sind es 50 / 0,4 s = 125 Versuche/s, mit 500 Anfragen 1.250/s. Die Grenze setzt
die Parallelität, nicht die Bremse. Bezahlt wird die Verzögerung als Funktionslaufzeit
vom Betreiber, nicht vom Angreifer.

Praktisch schützt die **Passwortlänge**. **Fix:** Kommentar korrigieren und
`isAdminConfigured()` ein Passwort unter z. B. 20 Zeichen ablehnen lassen. Eine echte
Ratenbegrenzung gehört, wenn überhaupt, vor die Funktion (Edge/Hoster), nicht in sie.

### 11. `erzwingen` übergeht die 90-Minuten-Grenze, die Doku sagt das Gegenteil

`src/data/researchWindow.ts:43` und `:100`, `SAISONBETRIEB.md:224`, `selfCheck.ts:568`

Gefunden beim Umsetzen von Punkt 7. Kommentar an `force` und `SAISONBETRIEB.md` sagen
beide: das Fenster wird übergangen, **die Untergrenze bleibt**. Im Code steht
`if (force) return due` vor der Prüfung auf `HARD_FLOOR_MINUTES`, und selfCheck hält genau
das fest („Von Hand darf die Untergrenze übergangen werden"). So seit dem ersten Commit der
Datei.

Die Begründung der Untergrenze gilt für Handläufe genauso: unter 90 Minuten stehen die
Aufstellungen, „ein Spieltag mit diesem Wissen wäre mit den übrigen nicht vergleichbar".
Mit dem Nachtrag aus Punkt 7 wird das wichtiger — vorher hat die Idempotenzsperre so einen
Lauf teils zufällig aus dem Log gehalten, jetzt nicht mehr.

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
