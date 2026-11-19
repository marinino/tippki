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

**Gemessen 18.11. (MESSLAUF.md, A1 und A2), kein Nachweis.** Auf Validation (Walk-forward,
1.224 Spiele) sind beide Ersatzformen im 1X2 tendenziell *schlechter* als die rohe Form:
Residuum ΔRPS −0,0013 (p = 0,25), „gegen Erwartung“ −0,0014 (p = 0,19). Im exakten
Ergebnis sind sie etwas besser (+0,013, +0,009). Die doppelte Zählung ist auf dem Papier
richtig beschrieben, kostet aber messbar nichts. Ohne neue Evidenz kein Umbau.

**Achtung beim Umstellen:** `formMode` steht nicht in `PipelineConfig`. Seit dem 18.11.
reicht es, `MODEL_LOGIC_VERSION` hochzuzählen (Punkt 8). Sauberer zur neuen Saison:
`formMode` als eigenes Feld in die Konfiguration aufnehmen.

**Nachtrag 17.09., dritter Kandidat „gegen Erwartung“** (Idee aus der Fragerunde): auch
`residual` bereinigt nicht um den **Gegner** und Heim/Auswärts, sondern nur um das eigene
Niveau der letzten 17 Spiele. Direkter wäre: je Spiel tatsächliche xG-Differenz minus die
Differenz, die das Modell für genau diese Paarung erwartet hat (`λ_eigen − λ_gegner` aus
`baseLambdas`), und davon das Mittel. Nachgerechnet für Spieltag 4, Stärken aus dem Fit vor
Saisonbeginn:

| | roh (produktiv) | gegen Erwartung |
|---|---|---|
| Bayern (Stuttgart 2,83 / erw. 1,85; Schalke 1,80 / 2,13; Elversberg 2,03 / 2,13) | +2,22 → ×1,56 | +0,18 → ×1,04 |
| Union (Frankfurt 0,16 / −0,08; Leverkusen −3,14 / −1,32; Schalke −1,30 / 0,62) | −1,43 → ×0,75 | −1,17 → ×0,79 |

Bayerns „Form“ ist fast vollständig „Bayern ist Bayern“, Unions Einbruch ist echt. Offene
Frage beim Messen: xG-Differenz gegen eine Erwartung aus einem **Tore**-Fit zu stellen
mischt zwei Skalen. Die Variante braucht außerdem das Modell zum Zeitpunkt jedes Formspiels
(im Walk-forward vorhanden, produktiv ein Fit mehr). In den Vergleich aus dem nächsten Schritt
als dritten `formMode` aufnehmen.

### 2. Ein hängender xG-Feed zieht Vorsaison-Spiele ins Formfenster [Rest eingefroren]

`src/model/xgForm.ts:131-146`

**Stand 18.11.:** die laute Hälfte ist umgesetzt (siehe Abgeschlossen, „Wächter für den
xG-Feed“), der Zustand kommt nicht mehr ins Repo. Offen ist nur noch das Abschneiden
des Fensters am Saisonanfang in `computeXgForm` und `computeXgFormResidual`. Das ist eine
Änderung an der eingefrorenen Formkurve und gehört mit `MODEL_LOGIC_VERSION` + 1 zur
Saison 2027/28. Bis dahin ist es nur noch eine zweite Sicherung, die nach dem Wächter
eigentlich nie greifen dürfte.

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

**Achtung:** dieser Fix ist eine Logikänderung und bewegt den `configHash` nicht von selbst.
Seit dem 18.11. gibt es dafür `MODEL_LOGIC_VERSION` (Punkt 8): im selben Commit hochzählen.
Das ist dann ein echter Schnitt im Log, also eine bewusste Entscheidung mitten in der Saison.
Deshalb zur nächsten Saison.

`Promise.all` in `refreshResults.ts` ist geblieben. Scheitert der xG-Teil, liegt die neue CSV
lokal schon auf der Platte. Im Workflow ist das harmlos (kein Commit), lokal sagt die
Abbruchmeldung es dazu.

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

**Gemessen 18.11. (MESSLAUF.md, B1 und B2):** im 1X2 neutral (+0,0001 und +0,0004, kein
Nachweis). Auffällig, aber nur explorativ: beide verbessern die Verteilungsmärkte,
Ü/U-LogLoss +0,0081 (±0,15, p = 0,022) und +0,0047 (±0,25, p = 0,045), exaktes Ergebnis
+0,024 und +0,017. Weil das eine von 21 Nebenkennzahlen war, ist es eine Hypothese, kein
Ergebnis. **Festgelegt:** im Sommer 2027 einmal auf Test (2023–2025) prüfen, ±0,15,
Zielgröße Ü/U-LogLoss, einseitig α = 0,05, 1X2 darf nicht schlechter werden. Fällt das
positiv aus, ist die Klammer der einzige Kandidat aus diesem Lauf für 2027/28.

**Nachtrag 16.09., live am Spieltag 4:** Bayern–Union, `npm run predict`. Form Bayern +2,22
(Faktor ×1,56), Union −1,43 (×0,75). Torerwartung 3,32 : 0,80 ohne Form, 5,17 : 0,60 mit
Form (vor Temperatur). Heimsieg 78,3 % → **93,7 %**. Genau der Bereich über 90 %, den die
Temperatur zurückholen sollte und in dem der Buchmacher praktisch nie eine Quote stellt.

**Nachtrag 18.11., Spieltag 10, Bayern–Köln** (Zahlen am selben Tag korrigiert, siehe
unten): Form Bayern **+2,55** (xG-Differenz +2,27 in Freiburg, +3,15 gegen Dortmund, +2,24
in Mainz), Faktor ×1,67. Torerwartung 3,61 ohne Form, **6,01** mit Form. Das reißt
erstmals die harte Plausibilitätsgrenze 6 im Self-Check. Bei λ = 6,01 liegen 4,3 % der
Poisson-Masse jenseits von 10 Toren, also außerhalb der Ergebnismatrix. Eine Dreierform
über 3 kam seit 2015 nur 28-mal in 7.426 Fällen vor, das Maximum war 4,43.

*Korrektur:* zuerst stand hier +3,20 (Leipzig, Freiburg, Dortmund) und λ = 6,84. Diese
Zahlen kamen aus einem hängenden xG-Feed: Understat war seit Anfang November in Wartung,
Mainz–Bayern vom 07.11. fehlte, und das Fenster lag ein Spiel zu weit hinten. Das ist der
Mechanismus aus Punkt 2, nur innerhalb der Saison. Der Wächter vom 18.11. hätte es gemeldet
(Bayern 9 Ergebnisse, 8 mit xG). Die Grenze 6 wird auch mit den richtigen Zahlen gerissen.

Weil der Freeze gilt, wurde nicht das Modell angefasst, sondern der Check: die harte Grenze
[0,25; 6] gilt jetzt für die **Basis**-Torerwartung, die Form hat einen eigenen Rahmen
(±5), und die Torerwartung mit Form ist nur noch bis 8 hart begrenzt, mit einer lauten
Zeile im Protokoll ab 6. Beim Umstellen zur nächsten Saison die alte Grenze wieder auf die
fertige Torerwartung legen — mit Klammer sollte sie halten.

**Nachtrag 18.11., die Überstreuung beziffert** (walk-forward auf Validation 2018–2022,
Diagnose, kein Test). Gegen den Markt, auf den 1203 Spielen mit Pinnacle-Schlussquote auf
1X2 und Ü/U 2,5: Die Summe der Torerwartungen streut beim Modell mit SD 0,78, beim Markt
mit 0,42. Regressiert man die echte Torsumme darauf, bringt ein vorhergesagtes Tor mehr
beim Modell nur 0,45 echte Tore, beim Markt 1,11. Mit und ohne Form, auf allen 1530
Spielen: SD 0,82 und Steigung 0,39 mit Form, SD 0,39 und Steigung 0,81 ohne. Die
Überstreuung kommt also fast vollständig aus der Formkurve. Bei der Tordifferenz liegt die
Steigung ohne Form bei 1,17 (zu zaghaft), mit Form bei 0,73 (zu weit): die Form trägt
echte Information über die Differenz bei, schießt aber über das Ziel hinaus. Genau dafür
ist eine Klammer da.

Die Ü/U-Schwäche liegt damit nicht an einem zu starren Torniveau, sondern an einem zu
beweglichen. In der Ergebnismatrix zeigt sich das am 2:1, das unterschätzt wird: Modell
7,3 %, mit den Torerwartungen des Marktes in derselben Matrixform 8,2 %, eingetreten 9,2 %.
Nicht von der Klammer zu erwarten ist dagegen eine Korrektur bei 0:0 (Modell 7,0 %, mit
Markt-Torerwartungen 6,3 %, eingetreten 5,1 %). Das liegt zum größeren Teil an der
Dixon-Coles-Form selbst: Innerhalb der Remis landen 26–28 % auf 0:0 (eingetreten 21 %) und
45–47 % auf 1:1 (eingetreten 51 %). RHO kann das nicht trennen, weil es 0:0 und 1:1 in
dieselbe Richtung schiebt. Die festgelegte Prüfung für Sommer 2027 bleibt unverändert.
Gerechnet mit einem Einmal-Skript außerhalb des Repos, das nur `buildWalkForwardContexts`
und `evaluateRun` benutzt.

**Nachtrag 18.11., Spieltag 10 gegen Tipico, und wo der Rückstand sitzt.** Tipicos
Ergebnis-Favoriten (niedrigste Quote je Partie) und unser „Häufigstes" stimmen in 5 von 9
Partien überein, auf beiden Seiten mit viel 1:1. Drei der vier Abweichungen kommen allein
aus der Form:

| Partie | Tipico | wir | ohne Form | Form Heim / Gast |
|---|---|---|---|---|
| Bayern – Köln | 4:0 | 6:0 | 3:0, 4:0 auf Platz 2 | +2,55 / +0,38 |
| Union – Leipzig | 1:1 | 0:2 (Leipzig 68 %) | 1:1 (Leipzig 48 %) | −1,36 / +1,95 |
| Leverkusen – Paderborn | 2:0 | 1:1 (Leverkusen 50 %) | 1:1, 2:0 auf Platz 2 (59 %) | −1,14 / +0,29 |
| Bremen – Hamburg | 2:1 | 1:1, 2:1 auf Platz 2 | 1:1, 2:1 auf Platz 2 | +0,62 / −0,57 |

Ohne Form stünde Tipicos Ergebnis bei uns in allen neun Partien auf Platz 1 oder 2. Nur
Bremen–Hamburg ist eine echte Frage der Matrixform (passt zum unterschätzten 2:1, siehe
oben). Ein Spieltag bleibt eine Anekdote, und Tipicos Ergebnisquoten tragen viel ungleich
verteilte Marge.

Über die ganze Validation (`npm run form`, Abschnitt 4: walk-forward, Pinnacle-Schluss,
1529 Spiele) ergibt sich dasselbe Bild. In den 1319 Spielen, in denen wir mit dem Markt
einig sind (unter 12 pp), liegen wir praktisch gleichauf (RPS −0,0007, p = 0,53). 80 % des
gesamten Rückstands stecken in den 210 deutlich uneinigen Spielen, 54 % allein in den 120,
in denen wir ohne Form einig wären. Dort traut das Modell seinem Favoriten in 60 % der
Fälle mehr zu als der Markt. Die Form ist aber nicht nur Rauschen: insgesamt halbiert sie
den Rückstand (RPS 0,0052 → 0,0029), und in 173 Spielen holt sie uns erst zum Markt heran.
Das erklärt B1/B2 (Klammer im 1X2 neutral): eine harte Klammer nimmt beides. Die Teilmengen
sind nach der Meinung des Marktes geschnitten und damit konfundiert; sie zeigen, wo der
Rückstand sitzt, nicht wie viel eine Änderung brächte. Woche für Woche sichtbar ist das
seit heute in `npm run predict` (Zeile „ohne Form").

**Stand 19.11., Kandidat 2027/28** (MESSLAUF.md, Messplan 2):

- Der Kandidat setzt die Form nur auf das Kräfteverhältnis und lässt die Summe der
  Torerwartungen stehen.
- Das trifft den Mechanismus dieses Punktes direkt, statt ihn wie die Klammer zu begrenzen.
- RECHERCHE.md, Abschnitt 4 stützt das auf fünf Ligen: Form sagt etwas über das
  Kräfteverhältnis, nichts über die Toranzahl.
- Die Klammer B1 läuft im Sommer als Alternative mit, unter Holm.

### 8. Der `configHash` sieht die Logik der Modellseite nur per Handzähler

`src/model/pipelineConfig.ts`, `src/model/xgForm.ts`

Stufe 1 ist seit dem 18.11. erledigt (siehe Abgeschlossen, „Hash-Anker“): `MODEL_LOGIC_VERSION`
steht verankert im Hash und wird bei jeder Logikreparatur von Hand hochgezählt. Ein
Handzähler hält aber nur, solange jemand daran denkt.

**Offen, Stufe 2:** ein Verhaltensabdruck wie beim LLM-Layer. `buildDixonColesMatrix`,
`applyOutcomeTemperature` und `baseLambdas` lassen sich auf festen Eingaben rechnen und
hashen. `computeXgForm` liest Dateien und braucht dafür erst eine injizierbare
Datenquelle. Wird der Abdruck neu aufgenommen, gehört er verankert in den Hash wie die
anderen Felder vom 18.11., sonst schneidet allein das Aufnehmen das Log.

### 15. Ein Rückkehrer gilt als bekannt und wird zum Ligadurchschnitt gezogen, nicht zum Aufsteiger [eingefroren]

`src/model/predictMatch.ts:31-34`, `src/model/teamStrength.ts:344`, `PRODUCTION_MODEL_OPTIONS`

`promotedTeamDefault` (Mittel der acht schwächsten Teams) greift nur, wenn ein Team **gar
nicht** in den Daten seit 2014/15 vorkommt. Ein Aufsteiger, der vor Jahren schon einmal oben
war, ist dagegen „bekannt“. Seine alten Spiele wiegen bei 500 Tagen Halbwertszeit fast
nichts, und der Ridge zieht ihn zum **Ligadurchschnitt**, nicht zum Niveau eines
Aufsteigers.

Nachgerechnet am echten Bestand, Fit nur mit Spielen vor Saison 2026 (Stand Spieltag 1):

| | Qualität (attack − defense) |
|---|---|
| Paderborn (zuletzt 2019/20: Letzter, 20 Punkte) | −0,085 |
| `promotedTeamDefault` | −0,309 |
| Elversberg (unbekannt → Default) | −0,309 |
| zum Vergleich: Werder / Union | −0,063 / −0,056 |

Paderborns Saison 2019/20 zählt heute rund 1 Spiel (34 × 2^(−6,5 J / 500 d) ≈ 1,3) gegen den
Ridge im Durchschnitt (`k = 8`, das entspricht etwa 5 Spielen, siehe Punkt 17 unter
Abgeschlossen). Das Modell hielt einen Aufsteiger damit vor Spieltag 1 für ein
Mittelfeldteam. Nach drei Spielen (1 Punkt, 0:4 Tore) ist er mit −0,280 ganz unten,
der Fehler betrifft also vor allem die ersten Spieltage.

**Nächster Schritt:** messen, ob ein Rückkehrer ohne Vorsaison besser zum Default statt zu 0
gezogen wird (Ridge-Ziel = `promotedTeamDefault` für Teams, die in der Vorsaison fehlten).
Betrifft jede Saison zwei bis drei Teams. Logikänderung, siehe Punkt 8. Umstellung
frühestens zur Saison 2027/28.

**Gemessen 18.11. (MESSLAUF.md, D1), kein Nachweis.** Dafür bekam der Fit eine Option
`ridgeTargets` (Ridge-Ziel je Team). Ohne Angabe ist sie nachweislich bitgleich, produktiv
setzt sie niemand. In Validation gibt es nur fünf Rückkehrer-Saisons (Köln und Paderborn
2019, Stuttgart 2020, Schalke und Werder 2022). Über alle Spiele ΔRPS +0,0001, praktisch
null. Auf den ersten rund zehn Wochen der Rückkehrer +0,0028 bei n = 43, p = 0,11. Die
Richtung passt zum Befund, die Fallzahl reicht nicht. Mehr lässt sich erst mit Test und
den kommenden Aufsteigern sagen.

### 18. Die Formkurve wirft das Torniveau weg [eingefroren]

`src/model/predictPipeline.ts:80-81`, `src/model/xgForm.ts:127`

Die Form ist `mean(xG − xGA)` und wirkt nur auf die **eigene** Torerwartung. Zwei Folgen:

- Eine starke **Abwehrform** (wenig xGA) erhöht die eigenen Tore, senkt aber nicht die des
  Gegners.
- Ein Team mit xG 1,0 / xGA 0,5 und eines mit xG 2,5 / xGA 2,0 bekommen denselben Faktor
  (+0,5 → ×1,105). Dass in den Spielen des zweiten viel mehr passiert, geht verloren. Trifft
  ein formstarkes auf ein formschwaches Team, gleichen sich die beiden Faktoren in der
  Torsumme weitgehend aus.

Das passt zur bekannten Schwäche beim Over/Under (Modell schlechter als die Grundrate),
ist als Ursache aber **nicht gemessen**.

**Nächster Schritt:** auf Validation eine geteilte Form messen: Angriffsform (xG gegen
Ligaschnitt) auf das eigene λ, Abwehrform (xGA gegen Ligaschnitt) auf das λ des Gegners.
Zielgröße O/U-LogLoss und 1X2-LogLoss. Zusammen mit Punkt 1 und 6, Umstellung frühestens
zur Saison 2027/28.

**Gemessen 18.11. (MESSLAUF.md, C1), die Hypothese trägt nicht.** Die geteilte Form ist
überall tendenziell schlechter, gerade im Markt, den sie verbessern sollte: Ü/U-LogLoss
−0,0102 (p = 0,19), 1X2 −0,0005, exaktes Ergebnis −0,014. Die schwache Über/Unter-Leistung
scheint eher an den extremen Formwerten zu liegen (siehe Klammer, Punkt 6) als an der
fehlenden Abwehrseite. Der Punkt kann zur nächsten Saison geschlossen werden, sofern
nichts Neues dazukommt.

**Nachtrag 18.09.:** der Befund war schon bekannt. `src/llm/factMapping.ts:143-144` sagt
über die Abwehr des Gegners: „letzteres fehlt der bestehenden xG-Formkurve komplett, siehe
npm run form“. Der LLM-Layer macht die vorgeschlagene Aufteilung bereits (Abwehr des
Gegners wirkt auf das eigene λ), die Formkurve nicht.

**Nachtrag 19.11.:** Auf fünf Ligen bestätigt sich, dass die Form keine Toranzahl vorhersagt
(RECHERCHE.md, Abschnitt 4). Das Tempo der letzten Spiele, also Tore für plus gegen, bringt
gegenüber dem Modell −0,01 Tore je Standardabweichung. Die geteilte Form ist damit erledigt. Der
Kandidat 2027/28 geht den umgekehrten Weg und wendet die Form nur auf die Differenz an.

### 19. Der Grenzertrag dämpft über Angriff und Abwehr hinweg, und die Reihenfolge des LLM entscheidet [eingefroren]

`src/llm/factMapping.ts:106-133`

Begründet ist der abnehmende Grenzertrag mit „vier fehlende Innenverteidiger machen die
Abwehr nicht viermal schlechter“, also **je Mannschaftsteil**. Gruppiert wird aber nach
`team|direction`. Fallen beim Heimteam Stammstürmer **und** Stammtorwart aus, landen sie in
einer Gruppe, und der zweite zählt nur halb, obwohl sie verschiedene Dinge schwächen.

Beide haben dasselbe Gewicht (0,1), die Sortierung ist ein Gleichstand, und JavaScript
sortiert stabil. **Welcher halbiert wird, hängt davon ab, in welcher Reihenfolge das LLM
sie aufgezählt hat.** Nachgerechnet:

| Reihenfolge der Fakten | homeAttack | homeDefense | Exponent Heim / Gast |
|---|---|---|---|
| Stürmer, dann Torwart | −0,100 | +0,050 | −0,100 / +0,050 |
| Torwart, dann Stürmer | −0,050 | +0,100 | −0,050 / +0,100 |

Dieselben Fakten ergeben also zwei verschiedene Vorhersagen.

**Fix (Vorschlag):** getrennt nach Angriff und Abwehr dämpfen, also je `team` und Dimension
(`attack`/`defense`) auf die Beträge, statt je `team|direction` auf ganze Fakten. Dann
gibt es auch keinen Gleichstand zwischen verschiedenen Dimensionen mehr. Ändert die
Abbildung, also zur nächsten Saison. Seit dem 18.11. bemerkt der Hash das: der breite
Abdruck sampelt geordnete Paare verschiedener Fakten. Nachgestellt mit umgedrehter
Auflösung von Gleichständen: der alte Abdruck bleibt bei `0c522175`, der breite bewegt
sich, der Hash springt von `3cc0ddad` auf `c311cced`.

### 20. Dixon-Coles wird ab einer Torerwartung von 6,67 ungültig [eingefroren]

`src/model/scoreMatrix.ts:63-75` (`dixonColesTau`), `DEFAULT_RHO = -0.15`

Die Korrektur für die Zelle 0:1 ist `1 + λ_heim · ρ`, die für 1:0 `1 + λ_ausw · ρ`. Mit
ρ = −0,15 wird sie ab λ = 1/0,15 = 6,67 negativ, und mit ihr die Wahrscheinlichkeit.
Dixon und Coles verlangen deshalb ρ ≥ −1/λ; geprüft wird das nirgends. Nachgerechnet mit
einer Gast-Torerwartung von 0,9:

| Heim-λ | P(0:1) |
|---|---|
| 6,01 | +9,2·10⁻⁵ |
| 6,67 | −2,5·10⁻⁷ |
| 7,00 | −1,9·10⁻⁵ |
| 8,00 | −3,0·10⁻⁵ |

Zahlenmäßig winzig, aber eine negative Wahrscheinlichkeit ist falsch, nicht nur
suboptimal. Erreicht wurde die Grenze noch nie. Am nächsten dran ist Bayern–Köln vor
Spieltag 10 mit 6,01 (Basis 3,61, Form +2,55, siehe Punkt 6), mit maximalem Spielkontext
(+16 %) wären es 6,98. Aufgefallen ist das bisher nicht, weil der Self-Check „keine
negativen Zellen“ nur bei 1,7 : 1,1 prüft und die Plausibilitätsprüfung mit Form bis 8
durchlässt.

**Seit dem 18.11.:** Die Plausibilitätsprüfung meldet sich laut, sobald die Torerwartung
mit Form die Grenze mit Spielkontext erreichen könnte (ab 6,67 / 1,16 = 5,74), und
gesondert, wenn eine Zelle tatsächlich negativ ist. Laut statt hart aus demselben Grund
wie in Punkt 6: die Ursache ist die eingefrorene Form, und ein dauerhaft roter Lauf würde
echte Fehler verdecken. Ein zweiter Check im Abschnitt „Score-Matrix“ nagelt die Grenze
fest (darunter alle Zellen ≥ 0, darüber 0:1 und 1:0 negativ). Er schlägt an, sobald die
Reparatur kommt; dann diesen Punkt schließen.

**Fix (Vorschlag):** zur nächsten Saison, zusammen mit der Klammer aus Punkt 6. Die allein
holt Bayern weit unter die Grenze (3,61 · e^0,15 = 4,19). Absichern sollte man die
Korrektur trotzdem selbst, etwa τ nicht unter 0 oder λ vor der Matrix begrenzt. Tritt der
Fall vorher ein, ist er ein echter Fehler im Sinne von SAISONBETRIEB.md: dann bewusst
entscheiden, ob repariert wird (neuer Hash, geteiltes Log) oder die winzige Abweichung bis
Saisonende getragen wird.

**Stand 19.11.:** Mit dem Kandidaten 2027/28 ist die Grenze außer Reichweite. Seine Form lässt die
Summe der Torerwartungen stehen, keine Seite kann also über die Basis-Summe hinaus. Bayern–Köln
bliebe unter der Summe der beiden Basis-Torerwartungen, statt von 3,61 auf 6,01 zu steigen.
Absichern sollte man τ trotzdem, wenn ρ einmal angefasst wird (Punkt 22).

### 21. Die Kalibrierungstemperatur zieht zur Gleichverteilung [eingefroren]

`src/model/scoreMatrix.ts` (`applyOutcomeTemperature`)

Gemessen am 19.11. (Validation, walk-forward, 1.529 Spiele mit Pinnacle-Schluss), mittlere
1X2-Masse Heim / Remis / Gast:

| | Heim | Remis | Gast |
|---|---|---|---|
| tatsächlich | 44,3 % | 24,2 % | 31,5 % |
| ohne Temperatur | 44,2 % | 23,7 % | 32,0 % |
| produktiv, T = 1,2 | **42,7 %** | **25,4 %** | 32,0 % |
| zur Grundrate temperiert | 44,5 % | 24,1 % | 31,5 % |

Die Temperatur zieht jede Vorhersage zu einem Drittel je Ausgang. Ein Drittel je Ausgang ist kein
Fußball, und so nimmt sie dem Heimsieg im Schnitt 1,5 Prozentpunkte und gibt sie dem Remis.
`applyOutcomeTemperatureTowards` zieht stattdessen zur Grundrate der Trainingsspiele,
p^(1/T) · q^(1−1/T). Mit gleichverteiltem q ist das die alte Temperatur, selfCheck prüft das.

Teil des Kandidaten 2027/28 (MESSLAUF.md, Messplan 2), dort T = 1,25. Produktiv unverändert bis
zur Entscheidung im Sommer.

### 22. Dixon-Coles überschätzt das 0:0, und das richtige ρ hängt an der Liga [offen]

`src/model/scoreMatrix.ts` (`dixonColesTau`, `DEFAULT_RHO`)

RECHERCHE.md, Abschnitt 2, auf fünf Ligen (Basismodell ohne Form und Temperatur, 2016/17 bis
2022/23):

- Mit ρ = −0,15 überschätzt das Modell das Remis um 2,2 Prozentpunkte und das 0:0 um 1,9 (8,6
  statt 6,7 %).
- Je Liga gerechnet wollen Premier League, La Liga, Serie A und Ligue 1 ρ ≈ −0,05, mit
  +0,003 bis +0,004 LogLoss auf dem exakten Ergebnis.
- Die Bundesliga will −0,15. Dort sind 1:0 und 0:1 selten (12,0 % gegen 16 bis 19 %), und genau
  die drückt ρ nach unten.
- Das 0:0 bleibt aber auch in der Bundesliga überschätzt: 7,1 gegen 5,5 %. Das deckt sich mit
  der Validation (Punkt 6, Nachtrag „die Überstreuung beziffert“).

ρ kann das nicht trennen, weil es 0:0 und 1:1 mit demselben Parameter anhebt. Über fünf Ligen
war **Dixon-Coles ohne Eingriff ins 0:0** am besten (LogLoss exaktes Ergebnis +0,0029 gegenüber
ρ = −0,15). Für die Bundesliga allein ist das nicht gemessen.

**Nächster Schritt:** auf der Mehrliga-Messbasis eine Matrixform wählen, die das 0:0 und die
liga-eigenen 1:0-Raten zugleich trifft. Danach auf frischen Daten prüfen. Nicht Teil des
Kandidaten 2027/28, der ρ = −0,15 behält.

---

## Abgeschlossen

### 12 (mit 3). Was bei Anpfiff dastand, bleibt für immer

Die Route rechnete jede Partie bei jedem Aufruf neu, auch längst gespielte, mit allen bis
dahin bekannten Ergebnissen. Wer zurückblätterte, sah Zahlen, die vor Anpfiff so nie
dastanden. Gemessen am 16.09. an Spieltag 1 und 2: RPS 0,1834 angezeigt gegen 0,2436 im
Log, die Anzeige sah also rund 11 % besser aus als ein ehrlich gerechnetes Modell.
Punkt 3 gehörte dazu: beim Zurückblättern stand dort „nicht recherchiert“, weil der Cache
nur einen Spieltag hält. Jetzt kommt der Status aus Schnappschuss oder Logzeile.

**Entschieden (18.11.):** die Quoten, die bei Anpfiff auf der Seite stehen, dürfen sich nie
wieder ändern. Partien ohne festgehaltenen Stand zeigen die Zeile aus dem Vorwärts-Log,
gekennzeichnet.

**Umgesetzt:**
- `src/data/displayPredictions.ts`: die Zahlen einer Karte an genau einer Stelle gerechnet.
  Die Route und der Schnappschuss rufen dieselbe Funktion (Rest von Punkt 16, für die
  Anzeige). Dazu `displayNumbersFromLog`: nur geloggte Werte und exakte Umformungen davon,
  nichts neu gerechnet.
- `src/data/kickoffSnapshots.ts`: Fenster 60 bis 15 Minuten vor Anpfiff, append-only
  `data/kickoff_snapshots.jsonl`, und `chooseDisplaySource` als einzige Entscheidung, was
  eine Partie zeigt. Ein Schnappschuss gilt vor und nach Anpfiff. Angepfiffen ohne
  Schnappschuss kommt das Log, ohne beides nichts. Nach Anpfiff wird nie live gerechnet. Eine
  nachträglich korrigierte Anstoßzeit gibt eingefrorene Zahlen nicht frei, eine verlegte
  Partie bekommt einen neuen Schnappschuss.
- `npm run kickoff-snapshot` als Schritt in `spielkontext.yml` (jeder Tick), eigener
  Commit-Text, roter Lauf bei Fehler.
- `forward-log-check` meldet angepfiffene Partien ab dem 19.11. ohne Schnappschuss.
- UI: die Karte sagt „eingefroren HH:MM“ oder „Vorwärts-Log vom TT.MM.“. Beim Log heißt die
  Aufklappzeile „Protokollierte Märkte“ und trägt einen Hinweis. Ohne Zahlen gibt es eine
  schlichte Karte.
- selfCheck-Abschnitt „Vorhersage bei Anpfiff eingefroren“ (338 Checks): Fenstergrenzen,
  Auswahlregel, Alarm, Schnappschuss bitgleich nach JSON, Log-Rückfall gegen echte Zeilen,
  mindestens zwei Taktgeber-Ticks im Fenster für jede Partie des Spielplans, echter Bestand
  ohne Duplikat und im Fenster.

Durchgespielt in einer isolierten Kopie mit künstlich auf „in 30 Minuten“ gelegter Partie:
- Der erste Lauf friert ein, der zweite und dritte schreiben nichts.
- Die echte Route liefert für die eingefrorene Partie exakt die Zahlen der Zeile.
- Spieltag 5 kommt aus dem Log, Spieltag 3 hat keine Vorhersage.

Im Browser angesehen: Spieltag 10 live ohne Siegel, Spieltag 5 mit Log-Hinweis und
reduziertem Preisblatt, Spieltag 3 mit leeren Karten.

**Grenze:** Für die Spieltage 1 bis 9 lässt sich nicht mehr herstellen, was bei Anpfiff auf
der Seite stand, weil nie etwas gespeichert wurde. Das Log ist das Nächstbeste, aber älter
(vor dem ersten Anpfiff des Spieltags) und ohne Matrix.

`configHash` unverändert, kein Eingriff ins Modell.

### 2 (laute Hälfte). Wächter für den xG-Feed

Fehlte einem Team ein Spiel der laufenden Saison im xG-Feed, zog die Formkurve ein Spiel der
Vorsaison ins Fenster. Möglich war das auf zwei Wegen: Understat antwortet, führt das
Spiel kurz nach Abpfiff aber noch nicht, und der Ergebnis-Job committet trotzdem. Oder
jemand committet einen halben Stand von Hand. Die Formkurve selbst ist eingefroren, deshalb
wird an der Quelle repariert, nicht im Modell.

**Umgesetzt** in `src/data/xgCoverage.ts` (pure Funktionen) und `refreshResults.ts`:
- `xgCoverageGaps` vergleicht je Team die Spiele dieser Saison in Ergebnis-CSV und xG-Feed.
  Nur „weniger xG als Ergebnisse“ zählt, ein Feed vor der CSV ist harmlos.
- `xgDuplicatePairings` findet eine Paarung, die zweimal in einer Saison steht. Das wäre ein
  FotMob-Lückenfüller mit abweichender Anstoßzeit, der im Fenster doppelt zählte.
- `refreshSeasonData`: hängt Understat nur hinterher, füllt FotMob genau diese Spiele auf,
  nach denselben Regeln wie beim Ausfall (Ausgabe „kamen aus FotMob“, Feld `xgLagFilled`).
  Bleibt eine Lücke oder entsteht ein Duplikat, bricht der Lauf ab. Der Workflow committet
  dann nichts (`pipefail`).
- `forward-log` warnt laut, falls trotzdem ein halber Stand im Repo steht. Es blockiert
  nicht: ein nicht protokollierter Spieltag ist für immer verloren, ein verschobener
  Formfaktor trifft beide Varianten gleich.
- selfCheck-Abschnitt „xG-Feed deckt die Ergebnis-CSV“ (11 Checks), unter anderem am echten
  Stand mit einem herausgenommenen Bayern-Spiel.

In einer isolierten Kopie des Repos durchgespielt, mit echten Abrufen:
- Am aktuellen Stand laufen 81 Ergebnisse und 81 xG-Spiele durch.
- Ein entferntes Bayern-Spiel wird aus FotMob wieder aufgefüllt.
- Ein erfundenes Spiel in der CSV, das keine Quelle kennt, führt zum Abbruch mit Exit 1 und
  der Meldung „Bayern Munich: 10 Ergebnisse, 9 mit xG; Elversberg: 10 Ergebnisse, 9 mit xG“.

Nicht durchgespielt ist der Weg „Understat antwortet, hängt aber hinterher“, weil Understat
derzeit im Wartungsmodus ist. Er nutzt denselben Lückenfüller wie der getestete Weg.

`configHash` unverändert, die Formkurve unverändert. Offen bleibt nur der eingefrorene Rest
von Punkt 2.

### 4 und 8 (Stufe 1). Hash-Anker: der Hash sieht mehr, ohne dass das Log geschnitten wird

Der Hash sah drei Dinge nicht, die die Vorhersage verändern: `EXTRACTION_BLOCK_SIZE` und
`MAX_SEARCHES` (der Ausfall von Spieltag 1 hing an beiden) und jede Logikreparatur auf der
Modellseite. Dazu kam ein Abdruck der Faktenzuordnung, der nur `absence` und nur Paare
gleicher Fakten abtastete. Die Lücken einfach zu schließen hätte den Hash mitten in der
eingefrorenen Saison bewegt, ohne dass sich eine einzige Zahl ändert.

**Umgesetzt** in `src/model/pipelineConfig.ts`: vier neue Felder
(`modelLogicVersion`, `llmExtractionBlockSize`, `llmMaxSearches`,
`llmMappingCoverageFingerprint`). Sie gehen **nur bei Abweichung** vom `HASH_ANCHOR` in den
Hash ein. Der Anker besteht aus Literalen, also aus dem Stand beim Einfrieren. Nachgeprüft:
- unverändert bleibt der Hash `3cc0ddad`, die 61 Zeilen dieser Saison stehen weiter in
  einer Gruppe;
- jedes Feld bewegt ihn, sobald es abweicht;
- Gegenprobe am echten Code: `CATEGORY_SCALE.return` 0,7 → 0,71 lässt den alten Abdruck bei
  `0c522175` stehen, der breite bewegt sich (Hash `2683857f`); ebenso eine umgedrehte
  Auflösung von Gleichständen (Punkt 19). Beides danach zurückgesetzt.

Dazu:
- **Herkunft:** der LLM-Cache schreibt `research: { extractionBlockSize, maxSearches }`, und
  `forward-log` setzt diese Werte in den Hash ein, nicht die gerade im Code stehenden. Das
  ist dieselbe Regel wie beim Modell. Ältere Caches haben das Feld nicht, dann gilt der Code.
- **Freeze mechanisch:** `FROZEN_CONFIG_HASH = "3cc0ddad"`. selfCheck verlangt, dass die
  Voreinstellung ihn trifft, `forward-log` warnt laut, sobald ein Feld abweicht.
- `SAISONBETRIEB.md`: Freeze-Tabelle um drei Zeilen ergänzt, im Sonderfall den Schritt
  „`MODEL_LOGIC_VERSION` hochzählen“ aufgenommen.

Zur nächsten Saison, wenn ohnehin geschnitten wird, dürfen die Felder regulär in die Liste
in `configHash` wandern, und der Anker entfällt. Offen bleibt Stufe 2 von Punkt 8.

### 14. Ein zuverlässiger Auslöser statt GitHubs Zeitplan

Das Signal, auf das der Punkt gewartet hat, kam: von Oktober bis Mitte November startete
GitHub den Zeitplan nur zwei- bis dreimal am Tag, oft Stunden zu spät. Kein Lauf lag in
den Recherchefenstern von **Spieltag 5 bis 9**, die Recherche fiel fünfmal in Folge aus.
Ein Alarm kam nicht, weil das Basismodell immer Zeilen lieferte. Der Zwischenschritt vom
18.09. (Zeitplan weg von :00/:15/:30/:45) hat also nicht gereicht.

**Umgesetzt** in `cb5cf0f` (18.11.): ein cron-job.org-Job löst alle 15 Minuten
`workflow_dispatch` mit `grund=taktgeber` aus, mit einem Token, das nur dieses Repo und
nur Actions darf (`SAISONBETRIEB.md`, Abschnitt „Taktgeber“). Fenster, Untergrenze und
Idempotenz bleiben bei `research-due`, der GitHub-Zeitplan bleibt als zweite Chance.
`forward-log-check` meldet jetzt auch einen angepfiffenen Spieltag ohne eine einzige Zeile
mit Kontext; 5 bis 9 stehen mit Grund in `KNOWN_RESEARCH_GAPS`.

**Für den Freeze:** neun Spieltage gespielt, mit Spielkontext davon nur 1, 2 und 4
(Spieltag 3 fehlt ganz, 5 bis 9 nur Basis). Die Evidenz kommt also noch langsamer als die
zwei bis drei Saisons, mit denen der Freeze gerechnet hat.

### 16. `npm run predict` ging einen eigenen Weg neben der Route

Skript und Route waren auseinandergelaufen: die Route nahm `parseKickoff` und
`nextMatchdayOf`, das Skript `new Date(f.date)` und „kleinste Spieltagsnummer mit
kommenden Partien“. `fixtures.json` hat keine Zeitzone, auf einem Rechner in UTC läge
jeder Anpfiff zwei Stunden daneben. Die eigene Spieltagssuche ist außerdem genau die
Fassung, vor der `kickoff.ts:95-101` warnt: eine verlegte Partie hielte ihren Spieltag bis
zum Nachholtermin für den „nächsten“.

**Umgesetzt:** `predict.ts` nimmt `nextMatchdayOf` und `parseKickoff`. Dieselbe Stelle stand
ein zweites Mal im selfCheck-Abschnitt „Torerwartungen des naechsten Spieltags sind
plausibel“, und der läuft in der Nachbereitung wirklich auf einem UTC-Runner; mitgezogen.
Eine gemeinsame Funktion „Vorhersagen für Spieltag X“ für Skript und Route bleibt offen.

### 17. Fünf Kommentare beschrieben den Code anders, als er lief

Reine Doku, `configHash` unverändert (`3cc0ddad` vor und nach). Korrigiert:
- `predictPipeline.ts`: die „feste Reihenfolge“ hat jetzt fünf Schritte, die Temperatur ist
  Schritt 4, passend zu Zeile 99.
- `llmAdjustment.ts`: „Fakten zusammenfassen, dann Schritt 1 und 2: daempfen, klammern“,
  passend zu „Schritt 3: anwenden“ und zum Dateikopf.
- `scoreMatrix.ts` (`expectedGoals`): tau verschiebt die Randverteilungen nicht, die
  Abweichung von den Lambdas kommt aus Temperatur, Draw-Boost und Abschneiden. Nachgerechnet
  war λ 2,8/0,7 → mit tau 2,799/0,700, mit Temperatur 2,663/0,758.
- `priceSheet.ts`: „je Markt auf 1“ mit Ausnahme der Doppelten Chance (Summe 2), bei Torsumme
  und Handicap je Linie.
- `teamStrength.ts` (zwei Stellen): der Ridge wiegt k **Tore**, nicht k Spiele;
  `k = 8` ≈ 5,2 Durchschnittsspiele ((1,703 + 1,349) / 2 ≈ 1,53 je Spiel). Der Name
  `ridgePseudoMatches` bleibt, er steht in `PipelineConfig`.

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
