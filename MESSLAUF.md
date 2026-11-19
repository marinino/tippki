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

---

# Messplan 2: der Kandidat für die Saison 2027/28

Festgelegt am **19.11.2026**, vor Spieltag 10 der Saison 2026/27. Code: `src/model/candidate.ts`
(der Kandidat), `src/scripts/candidate.ts` (`npm run kandidat`, die Auswertung) und der
selfCheck-Abschnitt „Kandidat 2027/28 festgeschrieben“, der den Abdruck `f89c6088` festhält.
Herkunft der drei Änderungen: die Hebelmessung vom selben Tag (Bundesliga-Validation) und
`RECHERCHE.md` (fünf Ligen, 2014/15 bis 2022/23).

## Der Kandidat (K1)

Drei Änderungen gegenüber der Produktion (configHash `3cc0ddad`), sonst alles gleich:

| | Produktion | Kandidat | Begründung |
|---|---|---|---|
| Fit-Ziel | Tore | 50 % Tore, 50 % xG | Im August an der Saisongrenze leicht positiv, am 19.11. walk-forward bestätigt (LogLoss +0,0032, p 0,01) |
| Form | exp(0,2 · Form) auf die eigene Torerwartung | dieselbe Verschiebung nur auf log(λHeim/λGast), die Summe bleibt fest | Form trägt keine Information über die Toranzahl (RECHERCHE.md, Abschnitt 4); produktiv bläht sie die Torsumme auf |
| Temperatur | T = 1,20, zur Gleichverteilung | T = 1,25, zur Grundrate der Trainingsspiele | Die alte nimmt dem Heimsieg im Schnitt 1,5 Prozentpunkte (VERBESSERUNGEN.md, Punkt 21). T gescannt, Regel vor dem Lauf: kleinster 1X2-LogLoss |

Unverändert bleiben 500 Tage, Ridge 8, die xG-Form der letzten bis zu 3 Spiele, ρ = −0,15,
maxGoals 10 und der Verzicht auf einen Draw-Boost. Der LLM-Layer gehört auf keiner Seite dazu,
er wird im Vorwärts-Log getrennt bewertet.

**Eine Entscheidung beim Festschreiben, offen festgehalten:**

- Vorgesehen war zuerst ρ = −0,05, das Optimum über fünf Ligen.
- Je Liga trägt das aber nur außerhalb der Bundesliga (RECHERCHE.md, Abschnitt 2). In der
  Bundesliga sind 1:0 und 0:1 viel seltener, und −0,15 passt dort besser.
- Die Kontrolle im Kandidaten auf der Validation zeigte dasselbe. ρ wurde deshalb vor dem
  Festschreiben auf den produktiven Wert zurückgesetzt, und T wurde danach gescannt.
- Beides ist eine Entscheidung auf derselben Validation, die damit endgültig verbraucht ist.

**Auf Validation** (2019 bis 2022, 1.224 Spiele mit Marktmittel-Schlusskurs; der Kandidat wurde
dort zusammengesetzt, die Zahlen sind deshalb zu optimistisch):

| | Kandidat gegen Produktion |
|---|---|
| exaktes Ergebnis | +0,031 [+0,014; +0,048] |
| 1X2-LogLoss | +0,0063 (p 0,049) |
| RPS | +0,0013 (p 0,07) |
| Über/Unter 2,5 | +0,011 (p 0,09) |

Der Abstand zum Markt sinkt im 1X2-LogLoss von 0,0123 auf 0,0060 und bei Über/Unter von
0,0218 auf 0,0104. Die uneinigen Spiele gehen von 156 auf 140 zurück, der Rückstand darin von
+0,018 auf +0,010.

## Daten

1. **Test:** Saisons 2023/24 bis 2025/26, walk-forward, Messlatte wie überall das
   Marktmittel zum Anpfiff (100 % Abdeckung).
2. **Vorwärts:** Saison 2026/27, alle Spiele ab dem 20.11.2026. Der erste Anpfiff ist um
   20:30 Uhr, Bayern gegen Köln. Gerechnet wird walk-forward, nach dem letzten Spieltag.
   - Bedingung: Der Commit, der `src/model/candidate.ts` einführt, liegt vor diesem Anpfiff.
     Die Auswertung prüft das gegen git und verweigert sonst.
   - Wird später committet, vorher `firstEvaluatedKickoff` auf den ersten Anpfiff nach dem
     Commit setzen und den Abdruck im selben Commit nachziehen. Danach nie wieder.
3. Die Bundesliga-Validation (2018 bis 2022) ist verbraucht und zählt nicht.

## Kennzahlen und Entscheidungsregel

- **K1, Kandidat gegen Produktion.**
  - Primär: LogLoss auf dem exakten Ergebnis, Test und Vorwärts zusammen, einseitig,
    gepaarter Bootstrap mit Standardseed.
  - Warum diese Kennzahl: Der Kandidat verändert die ganze Verteilung, und der LogLoss auf der
    vollen Matrix ist die strikt propere Bewertung genau dieser Verteilung. Preisblatt,
    Torsumme und Handicap werden aus ihr gelesen. Sie hat außerdem die meiste Trennschärfe:
    Auf Validation liegt der Standardfehler bei rund 0,009. Hält der Effekt, wäre z auf rund
    1.140 Spielen etwa 3,4. Bei halbem Effekt sinkt die Chance auf einen Nachweis auf etwa die
    Hälfte.
  - Ausschluss: 1X2-LogLoss oder RPS signifikant schlechter, zweiseitig p < 0,05 in die
    falsche Richtung.
- **B1, Klammer ±0,15.** Unverändert aus dem Folgeplan vom 18.11.: Über/Unter-LogLoss,
  einseitig, nur Test. Ausschluss: RPS signifikant schlechter. Die Vorwärtssaison wird
  berichtet, ohne Entscheidungskraft.
- **Holm über K1 und B1, α = 0,05.** Das macht B1 strenger als am 18.11. festgelegt, nie
  lockerer.
- **Entscheidung:**
  - Besteht K1, wird der Kandidat zur Saison 2027/28 produktiv, mit neuem configHash und neuem
    Freeze. Seit Spieltag 11 rechnet er ohnehin live (Nachtrag unten), dann bleibt er.
  - Besteht nur B1, wird die Klammer produktiv.
  - Sonst bleibt die Produktion. Das heißt „kein Nachweis“, nicht „kein Effekt“.
- **Berichtet, ohne Entscheidungskraft:** RPS, 1X2-LogLoss, Über/Unter, Handicap, der Abstand
  zum Markt je Datensatz, die mittlere 1X2-Masse und die uneinigen Spiele.

## Ablauf und Sperren

- `npm run kandidat -- --bestaetigung` läuft genau einmal, nach dem letzten Spieltag 2026/27.
  Vorher verweigert das Skript, ebenso bei einem Abdruck ungleich `f89c6088` oder ohne
  passenden Commit.
- `npm run kandidat -- --trockenlauf` spielt denselben Weg auf Validation-Saisons durch
  (2020 und 2021 als Test, 2022 ab November als Vorwärts) und entscheidet nichts.
- `npm run kandidat` und `--temperatur-scan` zeigen, wie der Kandidat auf Validation
  zustande kam.
- Beim Festschreiben lag der Kandidat nicht im Vorhersageweg. Die Vorhersagen von Spieltag 10
  waren vor und nach der Änderung byte-gleich (`npm run predict`), der configHash blieb
  `3cc0ddad`.

**Nachtrag 19.11.2026, später am Tag:**

- Der Kandidat rechnet ab Spieltag 11 live (SAISONBETRIEB.md, „Umstellung ab Spieltag 11“,
  `src/model/livePipeline.ts`, Hash `59ddd123`).
- An diesem Messplan ändert das nichts: Kandidat und eingefrorene Pipeline 2026 werden beide
  walk-forward nachgerechnet, unabhängig davon, welche live lief. Regel, Kennzahlen, Daten und
  Sperren bleiben, wie oben festgelegt.
- Der Kandidat selbst ist unverändert, der Abdruck bleibt `f89c6088`.

## Was nicht dazugehört

- **Der LLM-Layer:** Er wird im Vorwärts-Log getrennt bewertet.
- **Der Endspurt-Effekt auf die Torsumme** (RECHERCHE.md, Abschnitt 5): eine Hypothese für die
  fünf Ligen 2023 bis 2025, mit eigenem Plan, sobald die Mehrliga-Messbasis steht.
- **Das überschätzte 0:0 in der Bundesliga:** offen, VERBESSERUNGEN.md Punkt 22.
- **Nachjustieren:** Nach dem Festschreiben wird nichts mehr gedreht. Ein geänderter Kandidat
  ist ein neuer Messplan.

---

# Mehrliga-Messbasis

Eingerichtet am **19.11.2026**.

- **Code:** `src/data/leagues.ts` (Daten), `src/eval/leagueBacktest.ts` (Walk-forward und
  Sperre), `npm run ligen` (Auswertung) und der selfCheck-Abschnitt „Mehrliga-Messbasis“.
- **Daten:** football-data.co.uk, Premier League, La Liga, Serie A und Ligue 1, 2014/15 bis
  2025/26. Sie liegen unter `ligen/` und nicht unter `data/`, weil `data/` ins Serverbündel
  geht. Die Bundesliga kommt unverändert aus `data/`.
- **Wozu:** Auf 1.529 Bundesliga-Spielen sind Unterschiede um 0,001 RPS nicht auflösbar. Der
  Messlauf vom 18.11. ging deshalb siebenmal ohne Nachweis aus. Mit den vier anderen Ligen gibt
  es rund sechsmal so viele Spiele.
- **Was sie nicht ersetzt:** die Bundesliga selbst. ρ zum Beispiel ist ligaabhängig
  (RECHERCHE.md, Abschnitt 2).

## Was wofür da ist

| Saisons | Rolle | Bundesliga | vier andere Ligen |
|---|---|---|---|
| 2014/15, 2015/16 | Anlauf, nie bewertet | Training | Training |
| 2016/17 bis 2022/23 | Entwicklung: messen, vergleichen, wählen | 2.142 Spiele, die verbrauchte Validation 2018–2022 eingeschlossen | 10.539 Spiele |
| 2023/24 bis 2025/26 | Holdout | Testsaisons von Messplan 2, nur dort | Bestätigung künftiger Messpläne, 4.338 Spiele |
| 2026/27 | Vorwärtssaison | Messplan 2 und Vorwärts-Log | nicht geladen |

**Regeln:**

- **Holdout nur mit Messplan.** Er öffnet sich nur mit dem Namen eines vorab hier festgelegten
  Messplans (`holdoutPlan` in `leagueWalkForward`). Jede Öffnung wird ausgegeben. Anlauf und
  Vorwärtssaison sind auch mit Plan gesperrt, selfCheck prüft beides.
- **Einmal je Frage.** Wer nach einem Holdout-Lauf an derselben Frage weiterdreht, hat danach
  keinen Holdout mehr.
- **Die Bundesliga-Testsaisons gehören Messplan 2.** Sie laufen über `npm run kandidat` und
  nicht über diese Basis.
- **Messlatte:**
  - in der Entwicklung die Pinnacle-Schlussquote, die alle Spiele abdeckt (das Marktmittel
    steht erst ab 2019/20 in den Dateien);
  - im Holdout das Marktmittel mit 100 % Abdeckung, weil Pinnacle dort nur noch 83 bis 85 %
    abdeckt.
- **Außerhalb der Bundesliga gibt es kein xG.**
  - Das Fit-Ziel „blend“ rechnet dort mit Toren.
  - Die Form kommt aus Torschüssen aufs Tor, umgerechnet mit Toren je Torschuss der Vorsaisons.
    So bedeutet das produktive Gewicht 0,2 dort dasselbe.
  - Die Saison kommt aus dem Spiel. 2019/20 lief in England, Spanien und Italien bis in den
    Sommer 2020.

## Erster Lauf (19.11.2026, Entwicklung)

Nachgerechnet mit der Recherche (Basismodell, LogLoss auf dem exakten Ergebnis): je Liga
höchstens 0,0002 Abweichung. Die Repo-Fassung rechnet also dasselbe wie die Einmal-Skripte. Die
Bundesliga läuft über den Mehrliga-Weg Feld für Feld wie der produktive Walk-forward (selfCheck).

**Ausgangsstand, Produktion gegen Pinnacle** (positiv = Markt besser; außerhalb der Bundesliga
mit Torschuss-Form):

| | Bundesliga | Premier League | La Liga | Serie A | Ligue 1 | alle fünf |
|---|---|---|---|---|---|---|
| RPS | +0,0037 | +0,0060 | +0,0064 | +0,0075 | +0,0066 | +0,0062 |
| 1X2-LogLoss | +0,0139 | +0,0219 | +0,0219 | +0,0258 | +0,0238 | +0,0217 |
| Über/Unter-LogLoss | +0,0187 | +0,0131 | +0,0217 | +0,0235 | +0,0274 | +0,0209 |

Die Bundesliga liegt am nächsten am Markt. Sie ist die einzige Liga mit xG und die, auf der
jeder Parameter gewählt wurde.

**Kandidat 2027/28 gegen Produktion** (explorativ, ohne Entscheidungskraft; Messplan 2
entscheidet nur auf der Bundesliga):

| | Bundesliga | Premier League | La Liga | Serie A | Ligue 1 | alle fünf |
|---|---|---|---|---|---|---|
| exaktes Ergebnis | +0,032\*\* | +0,021\*\* | +0,024\*\* | +0,017\*\* | +0,013\*\* | +0,021\*\* |
| Über/Unter-LogLoss | +0,015\*\* | +0,011\*\* | +0,013\*\* | +0,011\*\* | +0,005 | +0,011\*\* |
| 1X2-LogLoss | +0,0069\*\* | +0,0026 | +0,0032\* | −0,0004 | +0,0015 | +0,0026\*\* |

- **Die Verteilungsmärkte werden überall besser,** obwohl in den vier anderen Ligen keiner der
  Werte des Kandidaten gewählt wurde und es dort kein xG gibt. Das stützt die beiden Mechanismen
  dahinter, nicht bloß die Zahlen: die Form wirkt nur aufs Kräfteverhältnis, und die Temperatur
  zieht zur Grundrate.
- **Im 1X2 kommt der Gewinn fast nur aus der Bundesliga,** vermutlich aus dem xG-Fit, den es
  nur dort gibt.
- **Der Abstand zum Markt bei Über/Unter halbiert sich** über alle fünf Ligen, von 0,0209 auf
  0,0111.

## Nächste Fragen für diese Basis (noch nicht festgelegt)

1. Eine Matrixform, die das 0:0 getrennt behandelt (VERBESSERUNGEN.md, Punkt 22).
2. Der Endspurt-Effekt auf die Torsumme (RECHERCHE.md, Abschnitt 5).
3. Torschuss-Form zusätzlich zur xG-Form in der Bundesliga.
4. xG für die vier anderen Ligen (Understat), damit Fit-Ziel und Form dort dieselben sind wie in
   der Bundesliga. Dafür braucht es einen Download.

Für jede Frage gilt dieselbe Reihenfolge: zuerst hier einen Plan schreiben, dann auf der
Entwicklung messen, dann einmal auf dem Holdout bestätigen.
