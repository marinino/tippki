# Messlauf zu den eingefrorenen Punkten 1, 6, 15 und 18

Die Konfiguration ist seit dem 19.08.2026 eingefroren (`SAISONBETRIEB.md`). Umgestellt wird
frühestens zur Saison 2027/28. Gemessen werden darf vorher, und ohne Messung gäbe es im
Sommer keine Grundlage für eine Umstellung. Dieses Dokument legt **vor** dem Lauf fest, was
gemessen wird und wann ein Ergebnis zählt. Die Ergebnisse stehen darunter.

---

## Plan (festgelegt am 18.11.2026, vor dem ersten Lauf)

**Daten.** Nur `VALIDATION_SEASONS` (2018 bis 2022). Die Testsaisons 2023 bis 2025 und die
laufende Saison 2026/27 werden **nicht** angefasst. Sie sind die Bestätigung im Sommer, mit
der dann festgelegten Konfiguration, genau einmal.

**Aufbau.** Walk-forward wie `npm run walk-forward`: vor jedem Block von 9 Spielen neu
fitten, mit allem davor Gespielten. Fit-Einstellung wie produktiv (500 Tage, Ridge 8).
Bewertet werden nur Spiele mit Buchmacherquote, wie in jedem Backtest dieses Projekts.

**Bezug.** Die produktive Variante: rohe Form (`mean(xG − xGA)` der letzten bis zu 3 Spiele
dieser Saison), Gewicht 0,2, keine Klammer, Ridge-Ziel 0 für alle Teams.

**Kandidaten.** Genau diese sieben Tests, keine weiteren:

| Kürzel | Punkt | Variante |
|---|---|---|
| A1 | 1 | Form als Residuum (`computeXgFormResidual`, eigenes Niveau der letzten 17 Spiele abgezogen) |
| A2 | 1 | Form „gegen Erwartung“: je Fensterspiel (xG eigen − xG Gegner) − (λ eigen − λ Gegner), λ aus dem Walk-forward-Modell vor jenem Spiel, ohne Form; davon das Mittel |
| B1 | 6 | rohe Form, Exponent `0,2 × Form` auf ±0,15 geklammert |
| B2 | 6 | rohe Form, Exponent auf ±0,25 geklammert |
| C1 | 18 | geteilte Form: λ_heim × exp(0,2 × (Angriff_heim + Abwehr_gast)), λ_gast entsprechend. Angriff = mittleres xG im Fenster − μ, Abwehr = mittleres xGA im Fenster − μ, μ = mittleres xG je Team und Spiel über alle Spiele vor Saisonbeginn |
| C1-OU | 18 | dieselbe Variante, Zielgröße LogLoss „mehr als 2,5 Tore“ (die eigentliche Hypothese von Punkt 18) |
| D1 | 15 | Rückkehrer (Team spielt diese Saison, fehlte in der Vorsaison, kommt in älteren Daten vor): Ridge zieht zu `promotedTeamDefault` statt zum Ligadurchschnitt, die ganze Saison über |

Alle Varianten benutzen dasselbe Formfenster wie die Produktion (bis zu 3 Spiele dieser
Saison, strikt vor Anpfiff).

**Kennzahlen.** Primär 1X2-RPS (für C1-OU: LogLoss Über/Unter 2,5). Daneben berichtet, ohne
Entscheidungskraft: 1X2-LogLoss, LogLoss Über/Unter 2,5, LogLoss exaktes Ergebnis. Δ =
Bezug − Kandidat, positiv heißt: der Kandidat ist besser. Gepaarter Bootstrap
(`pairedBootstrap`, Standardseed).

**Entscheidungsregel.** Ein Kandidat ist ein Kandidat für die Bestätigung im Sommer, wenn
1. Δ der primären Kennzahl positiv ist **und** das Holm-korrigierte p über alle sieben
   Tests unter 0,05 liegt, **und**
2. der 1X2-LogLoss nicht signifikant schlechter ist (rohes p < 0,05 in die falsche
   Richtung schließt aus).

Alles andere ist „kein Nachweis“, ausdrücklich nicht „kein Effekt“. Liegen mehrere
Kandidaten aus verschiedenen Punkten vor, wird ihre Kombination auf Validation nur
**beschrieben**. Entschieden wird sie im Sommer auf Test und Vorwärtssaison.

**Konsistenzprüfungen, vor dem Lesen der Ergebnisse.** Schlägt eine fehl, zählt der Lauf
nicht:
1. Der Bezug im Messskript ist bitgleich mit `evaluateRun` in der produktiven Einstellung.
2. Das Formfenster im Messskript (aus den Kontexten der Saison gebaut) ergibt für
   xG − xGA dieselbe rohe Form wie `computeXgForm`. Abweichungen werden gezählt und berichtet.
3. D1 mit leerer Rückkehrerliste ist bitgleich mit dem Bezug. Das belegt, dass die neue
   Fit-Option ohne Angabe nichts tut.
4. Die produktiven Vorhersagen von Spieltag 10 sind vor und nach der Fit-Option bitgleich,
   und der `configHash` bleibt `3cc0ddad`.

**Was nicht gemessen wird.** Punkt 19 (Reihenfolge im LLM-Mapping): der LLM-Layer lässt sich
nicht backtesten. Punkt 2 (Rest): betrifft nur einen fehlerhaften Datenstand, den es
historisch nicht gibt. Kein Nachjustieren von Gewichten, Klammerbreiten oder μ nach dem
Lauf. Wer eine andere Variante sehen will, schreibt sie als neuen Plan auf.

---

## Ergebnisse (Lauf vom 18.11.2026, `npm run messlauf`)

**Konsistenzprüfungen: alle bestanden.**
1. Der Bezug über den Variantenpfad ist bitgleich mit `evaluateRun`.
2. Das Formfenster im Messskript stimmt in **3.060 von 3.060** Fällen exakt mit
   `computeXgForm` überein, kein Fenster mit fehlendem xG.
3. Ridge-Ziel 0 für alle Rückkehrer ist bitgleich mit dem Bezug. Die neue Fit-Option ist
   also inert.
4. Spieltag 10 ist vor und nach der Fit-Option bitgleich, alle neun Partien samt sämtlicher
   Teamstärken, `configHash` `3cc0ddad`.

Rückkehrer in Validation: 2019 Köln und Paderborn, 2020 Stuttgart, 2022 Schalke und Werder.

Bezug (produktiv), n = 1.224 Spiele mit Quote: RPS 0,2049, LogLoss 0,9959, Ü/U-LogLoss
0,6712, LogLoss exaktes Ergebnis 3,0910.

Δ = Bezug − Kandidat, positiv = Kandidat besser. Holm über die sieben primären Tests.

| | primär | Δ primär [95 %-KI] | p | Holm-p | Δ LogLoss (p) | Δ Ü/U (p) | Δ Ergebnis | Urteil |
|---|---|---|---|---|---|---|---|---|
| A1 Residuum | RPS | −0,0013 [−0,0034; +0,0009] | 0,25 | 1,00 | −0,0014 (0,71) | +0,0020 (0,66) | +0,0126 | kein Nachweis |
| A2 gegen Erwartung | RPS | −0,0014 [−0,0035; +0,0007] | 0,19 | 1,00 | −0,0026 (0,50) | +0,0001 (0,97) | +0,0085 | kein Nachweis |
| B1 Klammer ±0,15 | RPS | +0,0001 [−0,0015; +0,0018] | 0,90 | 1,00 | +0,0033 (0,37) | +0,0081 (0,022) | +0,0243 | kein Nachweis |
| B2 Klammer ±0,25 | RPS | +0,0004 [−0,0006; +0,0015] | 0,49 | 1,00 | +0,0037 (0,13) | +0,0047 (0,045) | +0,0168 | kein Nachweis |
| C1 geteilte Form | RPS | −0,0005 [−0,0013; +0,0002] | 0,16 | 1,00 | −0,0028 (0,22) | −0,0102 (0,19) | −0,0143 | kein Nachweis |
| C1-OU geteilte Form | Ü/U | −0,0102 [−0,0251; +0,0049] | 0,19 | 1,00 | −0,0028 (0,22) | −0,0102 (0,19) | −0,0143 | kein Nachweis |
| D1 Rückkehrer | RPS | +0,0001 [−0,0001; +0,0003] | 0,46 | 1,00 | +0,0002 (0,54) | −0,0003 (0,015) | −0,0008 | kein Nachweis |

Beschreibend, D1 nur auf Spielen mit Rückkehrer-Beteiligung: erste rund 10 Wochen n = 43,
ΔRPS +0,0028 [−0,0006; +0,0064], p = 0,11; ganze Saison n = 166, ΔRPS +0,0005, p = 0,49.

### Was das heißt

**Nach der vorab festgelegten Regel: kein Kandidat.** Keine der sieben Varianten verbessert
den 1X2-RPS nachweisbar, das kleinste Holm-p ist 1,00. Das ist „kein Nachweis“, nicht
„kein Effekt“: auf 1.224 Spielen sind Unterschiede um 0,001 RPS nicht auflösbar.

Einzeln:
- **Punkt 1 (doppelte Zählung):** beide Ersatzformen sind im 1X2 tendenziell *schlechter*
  (−0,0013 und −0,0014), im exakten Ergebnis etwas besser. Die doppelte Zählung kostet hier
  messbar nichts. Ein Grund, die Form umzubauen, ergibt sich daraus nicht.
- **Punkt 18 (geteilte Form):** die Hypothese war, dass die geteilte Form den
  Über/Unter-Markt verbessert. Die Richtung ist umgekehrt: Ü/U −0,0102, also schlechter,
  ebenso 1X2 und exaktes Ergebnis. Nicht signifikant, aber nichts spricht dafür.
- **Punkt 15 (Rückkehrer):** über alle Spiele praktisch null, weil es nur fünf
  Rückkehrer-Saisons gibt. Auf deren ersten zehn Wochen +0,0028 RPS bei n = 43, p = 0,11.
  Die Richtung passt zum Befund, die Fallzahl reicht nicht.
- **Punkt 6 (Klammer):** im 1X2 neutral. Siehe nächster Abschnitt.

### Explorativ, ohne Entscheidungskraft: die Klammer und die Verteilungsmärkte

Beide Klammervarianten verbessern die Märkte, die von der ganzen Verteilung abhängen:
Ü/U-LogLoss +0,0081 (B1, p = 0,022) und +0,0047 (B2, p = 0,045), exaktes Ergebnis +0,024
und +0,017. Das 1X2 bleibt gleich. Das passt zum Mechanismus aus Punkt 6: eine extreme
Form treibt λ über 5 oder 6, und dann liegt die Torsumme weit daneben, während die
Tendenz ohnehin klar ist.

Das ist **kein Ergebnis dieses Laufs**. Ü/U und exaktes Ergebnis waren Nebenkennzahlen, es
gab 21 davon, und zwei p-Werte um 0,02 bis 0,05 sind unter so vielen Vergleichen zu
erwarten. Es ist eine Hypothese, die erst hier entstanden ist, und sie wird deshalb neu
festgelegt und auf anderen Daten geprüft:

**Folgeplan (festgelegt am 18.11.2026, nach diesem Lauf):** Im Sommer 2027, einmal, auf den
Testsaisons 2023 bis 2025: B1 (Klammer ±0,15) gegen den Bezug, Zielgröße Ü/U-LogLoss,
einseitig, α = 0,05. Zusätzlich darf der 1X2-RPS nicht signifikant schlechter sein.
Ausgewählt nach der Zielgröße auf Validation (+0,0081 gegen +0,0047 für ±0,25); im 1X2
sind beide unauffällig. Gewählt wird das hier und jetzt, nicht nach dem Testlauf. Die Vorwärtssaison 2026/27 kommt
als zweite Bestätigung dazu, sobald sie abgeschlossen ist.
