# Recherche: Ergebnisse, Tabelle und Form in den Top-5-Ligen

Stand 19.11.2026. Eigene Auswertung auf 16.333 Spielen aus fünf Ligen, dazu eine
Literaturrecherche. Alles hier ist **explorativ**: Es zeigt Muster und Größenordnungen, es
belegt keine Modelländerung. Bestätigt wird einmal, im Sommer 2027, auf den unberührten
Saisons 2023/24 bis 2025/26.

---

## Das Wichtigste in zwölf Regeln

1. **Jedes vierte Spiel endet remis, das häufigste Ergebnis ist 1:1.** Remis gibt es in
   25,0 % der Spiele (Premier League 23,5 %, La Liga und Ligue 1 je 25,8 %). 1:1 kommt in
   10,6 bis 12,7 % vor, 1:0 in 7,3 bis 10,9 %, 2:1 in 8,0 bis 9,5 %. Die Bundesliga ist die
   einzige Liga, in der 2:1 häufiger ist als 1:0.
2. **Heimteams gewinnen 44,5 %, Gäste 30,5 %.** Das ist rund ein Drittel Tor pro Spiel. In der
   Geistersaison 2020/21 schrumpfte der Abstand von etwa 15 auf 5 Prozentpunkte. Der Markt
   zog etwa zur Hälfte nach, das Modell gar nicht.
3. **Die Bundesliga ist die torreichste Liga, La Liga die torärmste.** 3,00 gegen 2,63 Tore je
   Spiel, über 2,5 Tore in 57,7 gegen 48,4 % der Spiele.
4. **Torlose Remis sind seltener, als Dixon-Coles mit ρ = −0,15 sagt.** Es sind 6,7 % statt
   8,6 %. 1:0, 0:1 und 2:1 sind dafür je rund 12 % häufiger als vorhergesagt. Das Modell gibt
   dem Remis dadurch 2,2 Prozentpunkte zu viel. Über alle fünf Ligen passt ρ ≈ −0,05 am besten,
   oder Dixon-Coles ohne Eingriff ins 0:0. **Ausnahme Bundesliga:** Dort sind 1:0 und 0:1 so
   selten (12 % statt 16 bis 19 %), dass −0,15 besser passt. Das 0:0 bleibt aber auch dort
   überschätzt.
5. **Remis hängen an der Ausgeglichenheit, kaum an der Torerwartung.** Ausgeglichene Spiele
   enden in 28 bis 30 % unentschieden, ob 2,2 oder 3,1 Tore erwartet werden. Mit klarem
   Favoriten sind es 15 bis 20 %, nur in sehr torarmen Spielen mehr.
6. **Die Tabelle braucht eine halbe Saison und holt ein gutes Modell nie ein.** Wie gut sagen
   die Punkte pro Spiel nach k Spielen den Rest der Saison voraus? Nach 3 Spielen r = 0,49,
   nach 10 Spielen 0,64, zur Saisonmitte 0,69. Ein Modell, das die Vorsaisons kennt, liegt
   durchgehend bei 0,75 bis 0,79. Tordifferenz ist besser als Punkte, Torschüsse aufs Tor
   ab etwa Spieltag 15 noch besser.
7. **Form ist echt, aber sie steckt in den Torschüssen.** Über ein langfristiges
   Stärkemodell hinaus trägt die Torschussbilanz der letzten fünf Spiele in allen fünf Ligen
   Information, im Mittel +0,06 je Standardabweichung (z ≈ 8). Wer sie kennt, gewinnt mit
   Punkten und Tordifferenz der letzten Spiele nichts mehr dazu. xG-Form wirkt in der
   Bundesliga genauso stark wie die Torschuss-Form.
8. **Der Markt preist Form vollständig ein.** Über die Schlussquote hinaus trägt keine
   Formgröße messbar Information. Auf gute Punkteserien reagiert er eher leicht über; das
   passt zur Literatur, ist hier aber nicht gesichert.
9. **Form sagt nichts über die Toranzahl.** Torreiche letzte Spiele beider Teams sagen keine
   torreichen nächsten Spiele voraus (−0,01 Tore je Standardabweichung).
10. **Wer mehr Punkte holt, als das Modell erwartet, tut das weiter.** Das Modell ist
    innerhalb der Saison zu träge (z ≈ 5,6), der Markt nicht.
11. **Im Endspurt fallen mehr Tore, wenn ein Team nichts mehr zu holen hat.** Gemeint sind
    die letzten acht Spieltage, mit einem Team ohne Chance auf Europa und ohne
    Abstiegsgefahr. Dann fallen rund 0,45 Tore mehr, als die Stärke erwarten lässt, und beide
    Seiten treffen öfter. Am Sieger ändert das wenig. Der Markt preist es zum Teil ein.
12. **Aufsteiger zeigen kein verlässliches Muster**, weder gegen das Modell noch gegen den
    Markt.

---

## Datenbasis und Vorgehen

- **Ligen und Zeitraum:** Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Saisons
  2014/15 bis 2022/23, 16.333 Spiele von football-data.co.uk. Ligue 1 2019/20 wurde nach
  279 Spielen abgebrochen.
- **Unberührt:** 2023/24 bis 2025/26 in allen fünf Ligen, damit es für die Bestätigung im
  Sommer frische Daten gibt. 2026/27 ohnehin.
- **Modell:** der Stärke-Fit des Projekts (Poisson, Halbwertszeit 500 Tage, Ridge 8,
  Dixon-Coles ρ = −0,15), je Liga, vor jedem Spieltag neu gefittet, **ohne Form und ohne
  Temperatur**. Bewertet ab 2016/17 (12.681 Spiele), die zwei Saisons davor sind Anlauf.
- **Markt:** Pinnacle-Schlussquote, wo vorhanden, sonst das Marktmittel zum Anpfiff,
  proportional entvigt. 1X2 für 12.679 Spiele, Über/Unter 2,5 erst ab 2019/20 (7.203 Spiele).
- **Residuum:** tatsächlicher Ausgang (Heimsieg +1, Remis 0, Auswärtssieg −1) minus
  vorhergesagtes P(Heimsieg) − P(Auswärtssieg). Positiv heißt: Das Heimteam war besser als
  vorhergesagt. Ein Residuum von +0,05 entspricht 5 Prozentpunkten in dieser Differenz.
- **Statistik:** robuste Standardfehler, 95-%-Intervalle, * p < 0,05, ** p < 0,01. Es sind
  rund 80 Tests. Einzelne Treffer um p = 0,05 sind deshalb schwach, belastbar sind die mit
  großem Abstand.

---

## 1. Wie Ergebnisse verteilt sind

| Liga | Spiele | Tore/Spiel | Heim | Gast | Heimsieg | Remis | Auswärtssieg | Über 2,5 | Beide treffen |
|---|---|---|---|---|---|---|---|---|---|
| Premier League | 3.420 | 2,74 | 1,52 | 1,22 | 44,8 % | 23,5 % | 31,7 % | 52,1 % | 50,4 % |
| La Liga | 3.420 | 2,63 | 1,50 | 1,13 | 45,6 % | 25,8 % | 28,6 % | 48,4 % | 50,2 % |
| Serie A | 3.420 | 2,79 | 1,53 | 1,26 | 42,8 % | 25,3 % | 31,9 % | 53,4 % | 55,2 % |
| Bundesliga | 2.754 | 3,00 | 1,68 | 1,31 | 45,3 % | 24,7 % | 30,0 % | 57,7 % | 56,8 % |
| Ligue 1 | 3.319 | 2,65 | 1,48 | 1,17 | 44,1 % | 25,8 % | 30,1 % | 49,6 % | 51,0 % |
| **alle fünf** | **16.333** | **2,75** | **1,54** | **1,21** | **44,5 %** | **25,0 %** | **30,5 %** | **52,0 %** | **52,6 %** |

Häufigste Ergebnisse, in Prozent der Spiele:

| Liga | 1:1 | 1:0 | 2:1 | 2:0 | 0:1 | 0:0 | 1:2 | 2:2 | 0:2 |
|---|---|---|---|---|---|---|---|---|---|
| Premier League | 10,6 | 9,8 | 8,0 | 8,2 | 7,5 | 7,0 | 7,0 | 4,9 | 4,9 |
| La Liga | 12,0 | 10,9 | 9,5 | 7,8 | 8,0 | 7,9 | 6,4 | 5,1 | 5,1 |
| Serie A | 12,0 | 8,5 | 9,1 | 7,2 | 7,7 | 6,6 | 7,7 | 5,4 | 4,5 |
| Bundesliga | 11,8 | 7,3 | 9,2 | 7,0 | 5,4 | 6,2 | 6,0 | 5,3 | 4,5 |
| Ligue 1 | 12,7 | 10,2 | 8,9 | 7,0 | 8,2 | 7,4 | 6,5 | 4,6 | 4,8 |
| alle fünf | 11,8 | 9,4 | 8,9 | 7,5 | 7,4 | 7,1 | 6,7 | 5,1 | 4,8 |

**Heimvorteil je Saison**, alle fünf Ligen. Markt und Modell erst ab 2016/17:

| Saison | Tore/Spiel | Heimsieg | Auswärtssieg | Abstand | Markt H / A | Modell H / A |
|---|---|---|---|---|---|---|
| 2014/15 | 2,63 | 45,0 | 29,1 | +15,9 | – | – |
| 2015/16 | 2,67 | 44,4 | 29,7 | +14,6 | – | – |
| 2016/17 | 2,83 | 48,6 | 28,3 | +20,3 | 45,3 / 29,9 | 43,8 / 28,5 |
| 2017/18 | 2,71 | 45,3 | 30,2 | +15,2 | 45,3 / 30,1 | 44,2 / 28,9 |
| 2018/19 | 2,75 | 44,7 | 29,4 | +15,3 | 44,6 / 30,3 | 44,0 / 29,0 |
| 2019/20 | 2,79 | 44,1 | 31,5 | +12,6 | 44,1 / 31,0 | 44,1 / 29,0 |
| 2020/21 | 2,80 | 39,9 | 34,7 | **+5,2** | 41,7 / 33,3 | 43,7 / 29,4 |
| 2021/22 | 2,81 | 42,8 | 31,4 | +11,4 | 44,1 / 30,9 | 43,4 / 29,9 |
| 2022/23 | 2,77 | 45,7 | 30,0 | +15,7 | 43,7 / 31,0 | 43,3 / 30,0 |

Ohne Zuschauer schrumpfte der Heimvorteil um zwei Drittel und kam danach vollständig zurück.
Das Modell rechnet mit dem Mittel aller Trainingsjahre und sah davon nichts, der Markt ging
etwa den halben Weg mit. Für normale Saisons ist das ohne Belang.

Auffällig ist auch die Spalte „Modell A“: Das Modell gibt dem Auswärtssieg durchweg etwa
1,5 Punkte zu wenig. Das ist dieselbe Remis-Überschätzung wie in Abschnitt 2.

---

## 2. Die Form der Ergebnismatrix

Beobachtet gegen die Summe der Modellvorhersagen (12.681 Spiele):

| Ergebnis | beobachtet | unabhängige Poisson-Tore | Dixon-Coles ρ = −0,15 |
|---|---|---|---|
| 0:0 | 6,7 % | 7,0 % | **8,6 %** |
| 1:0 | 9,3 % | 10,0 % | 8,3 % |
| 0:1 | 7,2 % | 8,0 % | 6,4 % |
| 1:1 | 11,9 % | 11,0 % | 12,6 % |
| 2:0 | 7,2 % | 7,8 % | 7,8 % |
| 2:1 | 9,1 % | 8,1 % | 8,1 % |
| 1:2 | 6,8 % | 6,6 % | 6,6 % |
| 2:2 | 5,1 % | 4,7 % | 4,7 % |

- Das Muster gegenüber unabhängigen Poisson-Toren: Enge Ergebnisse, in denen beide treffen
  (1:1, 2:1, 2:2), sind häufiger. Ergebnisse, in denen ein Team nicht trifft (1:0, 0:1,
  2:0), sind seltener. Das 0:0 passt fast.
- Dixon-Coles kann das nur zum Teil abbilden. Es hebt 0:0 und 1:1 mit demselben Parameter an
  und senkt 1:0 und 0:1. Beim 0:0 schießt es damit deutlich über.
- Die Streuung ist poissonnah, der Streuungsindex liegt bei 0,96 bis 1,02. Die Residuen von
  Heim- und Auswärtstoren sind unkorreliert (−0,002). Die Abhängigkeit sitzt also nur in den
  kleinen Ergebnissen.

**Welches ρ die Daten wollen** (Basismodell ohne Form und Temperatur; tatsächlich: Remis
24,8 %, 0:0 6,7 %, beide treffen 53,2 %):

| Variante | Remis | 0:0 | 1:1 | Beide treffen | LogLoss exaktes Ergebnis | Δ zu ρ = −0,15 | 1X2-LogLoss |
|---|---|---|---|---|---|---|---|
| ρ = −0,20 | 28,1 % | 9,2 % | 13,2 % | 53,2 % | 2,9194 | −0,0038** | 0,9846 |
| **ρ = −0,15 (Produktion)** | 27,0 % | 8,6 % | 12,6 % | 52,7 % | 2,9156 | – | 0,9831 |
| ρ = −0,10 | 25,9 % | 8,1 % | 12,1 % | 52,1 % | 2,9135 | +0,0021** | 0,9823 |
| ρ = −0,05 | 24,8 % | 7,5 % | 11,5 % | 51,6 % | 2,9128 | +0,0027** | 0,9821 |
| ρ = 0 | 23,7 % | 7,0 % | 11,0 % | 51,0 % | 2,9137 | +0,0019 | 0,9826 |
| ρ = +0,05 | 22,6 % | 6,4 % | 10,4 % | 50,5 % | 2,9160 | −0,0004 | 0,9838 |
| Dixon-Coles ohne 0:0, ρ = −0,10 | 25,0 % | 7,0 % | 12,2 % | 52,7 % | **2,9127** | **+0,0029**\*\* | **0,9820** |

Innerhalb der Remis liegt Dixon-Coles mit 31,9 % auf 0:0 (beobachtet 27,2 %) und mit 17,3 %
auf 2:2 (beobachtet 20,4 %). Das deckt sich mit dem Befund aus der Bundesliga-Validation
(VERBESSERUNGEN.md, Punkt 6).

**Je Liga gerechnet sieht es anders aus** (nachgerechnet beim Festschreiben des Kandidaten,
dieselben Spiele):

| Liga | Spiele | ρ = −0,05 gegenüber −0,15 | 0:0 beob. / DC −0,15 | 1:0 und 0:1 beob. / DC −0,15 | Remis beob. / DC −0,15 / DC −0,05 |
|---|---|---|---|---|---|
| Premier League | 2.660 | +0,0041\*\* | 6,7 / 8,6 | 16,6 / 14,8 | 22,7 / 26,9 / 24,7 |
| La Liga | 2.660 | +0,0040\*\* | 8,1 / 9,7 | 19,2 / 16,1 | 26,3 / 27,7 / 25,5 |
| Serie A | 2.660 | +0,0029 | 6,2 / 8,0 | 16,0 / 14,0 | 24,5 / 26,4 / 24,2 |
| **Bundesliga** | 2.142 | **−0,0021** | 5,5 / 7,1 | **12,0 / 12,4** | 24,6 / 25,6 / 23,5 |
| Ligue 1 | 2.559 | +0,0039\* | 7,0 / 9,4 | 17,9 / 15,8 | 25,8 / 27,9 / 25,7 |

- Das Fünf-Ligen-Optimum ρ ≈ −0,05 tragen die anderen vier Ligen.
- In der Bundesliga sind Siege mit einem Tor und ohne Gegentor selten (12,0 % gegen 16 bis
  19 %). Genau die senkt ρ = −0,15, deshalb passt es dort am besten.
- Das 0:0 überschätzt es aber auch in der Bundesliga.
- Wer das trennen will, braucht eine Matrixform, die das 0:0 getrennt behandelt. Ein einzelnes
  ρ reicht dafür nicht.

**Wann es Remis gibt** (tatsächlich / Markt / Modell; Ausgeglichenheit und Torerwartung aus
dem Modell):

| | unter 2,4 Tore | 2,4–2,8 | 2,8–3,2 | über 3,2 |
|---|---|---|---|---|
| ausgeglichen, \|P(H) − P(A)\| < 0,15 | 28,8 / 30,2 / 33,2 | 28,0 / 28,6 / 30,0 | 29,8 / 27,1 / 27,8 | 21,7 / 25,6 / 25,6 (n = 143) |
| mittel, 0,15–0,35 | 29,7 / 28,5 / 31,8 | 26,7 / 27,0 / 28,8 | 26,7 / 25,5 / 26,6 | 26,3 / 23,9 / 24,5 |
| klarer Favorit, > 0,35 | 25,8 / 24,7 / 28,6 (n = 279) | 19,9 / 22,3 / 25,3 | 19,2 / 20,0 / 22,3 | 15,5 / 16,1 / 17,4 |

- Ein Poisson-Modell erwartet, dass torarme Spiele viel öfter remis enden. In der Realität
  ist die Kurve flacher: Ausgeglichene Spiele enden bei 2,2 und bei 3,0 erwarteten Toren
  gleich oft unentschieden.
- Der Markt ist gut kalibriert. Nur bei klaren Favoriten bepreist er das Remis um 1 bis 2
  Punkte zu hoch.

---

## 3. Die Tabelle

**Wie schnell wird die Tabelle aussagekräftig?** Korrelation mit den Punkten pro Spiel im
*Rest* der Saison, 686 Team-Saisons:

| nach k Spielen | Punkte/Spiel | Tordifferenz/Spiel | Torschussdifferenz/Spiel | Modellstärke (mit Vorsaisons) |
|---|---|---|---|---|
| 3 | 0,49 | 0,54 | 0,56 | **0,78** |
| 5 | 0,57 | 0,62 | 0,62 | **0,78** |
| 8 | 0,64 | 0,68 | 0,67 | **0,79** |
| 10 | 0,64 | 0,68 | 0,68 | **0,78** |
| 15 | 0,69 | 0,71 | 0,72 | **0,77** |
| 19 | 0,69 | 0,72 | 0,74 | **0,75** |
| 25 | 0,67 | 0,68 | 0,68 | **0,70** |

- Deine Vorsicht bei der Tabelle am Saisonanfang ist berechtigt, und zwar deutlich. Nach drei
  Spielen erklärt die Tabelle etwa ein Viertel dessen, was danach passiert (r² ≈ 0,24), das
  Modell rund 60 %.
- Ab k = 25 sinken alle Werte, weil der Rest der Saison zu kurz für ein stabiles Ziel wird.
- Die Torschussdifferenz holt das Modell zur Saisonmitte fast ein. Die laufende Saison
  enthält also Information, die das torbasierte Modell zu langsam aufnimmt.

**Ausgang nach Tabellenplatz** (beide Teams mindestens neun Spiele, Tabellenfünftel, 1 = oben;
Residuum in Heimsicht):

| Fünftel Gast − Heim | Spiele | Heimsieg tats. / Markt / Modell | Remis tats. / Markt / Modell | Residuum gegen Markt | gegen Modell |
|---|---|---|---|---|---|
| −4 (Gast oben, Heim unten) | 359 | 17,5 / 16,1 / 18,0 | 20,1 / 21,5 / 24,7 | +0,014 | −0,055 |
| −3 | 837 | 23,7 / 22,9 / 24,8 | 24,3 / 24,7 / 27,6 | +0,010 | −0,056\* |
| −2 | 1.172 | 28,5 / 29,2 / 30,4 | 26,1 / 26,7 / 28,9 | −0,021 | −0,066\*\* |
| −1 | 1.718 | 36,4 / 35,5 / 36,2 | 27,7 / 27,7 / 29,4 | +0,018 | −0,013 |
| 0 | 1.568 | 45,1 / 43,4 / 43,2 | 25,9 / 27,2 / 28,6 | +0,020 | +0,011 |
| +1 | 1.583 | 54,0 / 52,3 / 51,3 | 26,7 / 25,5 / 27,1 | +0,046\* | +0,051\*\* |
| +2 | 1.200 | 60,4 / 60,2 / 57,5 | 21,0 / 22,7 / 25,0 | −0,012 | +0,018 |
| +3 | 770 | 65,6 / 66,9 / 64,1 | 19,7 / 20,0 / 22,5 | −0,029 | +0,001 |
| +4 (Heim oben, Gast unten) | 366 | 77,9 / 75,7 / 73,4 | 14,5 / 15,7 / 17,9 | +0,032 | +0,055 |

- **Gegen den Markt gibt es keine Regel.** Ein Treffer bei neun Gruppen ist, was der Zufall
  erwarten lässt. Wer aus Tabellenplätzen Wettregeln ableiten will, findet hier nichts, was
  die Schlussquote nicht schon weiß.
- **Gegen das Modell schon:** Es unterschätzt das Team, das in der Tabelle höher steht, und
  überschätzt das Remis in jeder Gruppe.

**Glück oder echte Stärke?** Überleistung heißt hier: Punkte minus die vom Modell erwarteten
Punkte je Spiel in dieser Saison. Sie sagt das nächste Spiel voraus:

- gegen das Modell: +0,043 je Standardabweichung [+0,028; +0,058]\*\*. Wer das Modell
  übertrifft, tut es weiter. Ein Teil davon ist echte Stärke, die das Modell zu langsam sieht.
- gegen den Markt: +0,005 [−0,010; +0,020]. Der Markt hat das schon eingerechnet.

---

## 4. Form

Wie viel sagt die Form über das nächste Spiel, *zusätzlich* zu Modell beziehungsweise Markt?
Gemessen als Steigung des Residuums je Standardabweichung Formunterschied (Heim − Gast).

| Formsignal | Spiele | Korrelation mit dem Ausgang | über das Modell hinaus | über den Markt hinaus |
|---|---|---|---|---|
| Punkte, letzte 3 | 11.637 | 0,22 | +0,028\*\* | −0,003 |
| Tordifferenz, letzte 3 | 11.637 | 0,25 | +0,039\*\* | +0,006 |
| **Torschussdifferenz, letzte 3** | 11.631 | 0,27 | **+0,057\*\*** | +0,010 |
| Punkte minus Modellerwartung, letzte 3 | 11.637 | 0,06 | +0,020\*\* | −0,007 |
| Punkte, letzte 5 | 10.950 | 0,26 | +0,032\*\* | −0,002 |
| Tordifferenz, letzte 5 | 10.950 | 0,29 | +0,041\*\* | +0,006 |
| **Torschussdifferenz, letzte 5** | 10.940 | 0,30 | **+0,057\*\*** | +0,006 |
| Punkte minus Modellerwartung, letzte 5 | 10.950 | 0,09 | +0,026\*\* | −0,006 |
| **xG-Differenz, letzte 3 (nur Bundesliga)** | 1.953 | 0,28 | **+0,054\*\*** | +0,013 |

- **Gemeinsam gerechnet** (letzte 5, alle Ligen) trägt nur die Torschussdifferenz:
  - gegen das Modell: Torschüsse +0,060\*\*, Tordifferenz +0,017, Punkte −0,022;
  - gegen den Markt: Torschüsse +0,004, Tordifferenz +0,033, Punkte **−0,034\***. Bei
    gleicher Leistung bepreist der Markt Teams mit vielen Punkten aus den letzten Spielen
    leicht zu hoch. Das ist schwach gesichert.
- **Je Liga, Torschussdifferenz der letzten 5 über das Modell hinaus:** Premier League
  +0,070\*\*, La Liga +0,036\*, Serie A +0,076\*\*, Bundesliga +0,038\*, Ligue 1 +0,064\*\*.
  Die Punkte-Form trägt dagegen in der Bundesliga (+0,011) und in La Liga (+0,007) nichts.
- **Überreagiert der Markt?** Wheatcroft (2020) zeigt, dass Quoten auf Serien überreagieren.
  Nachgerechnet mit „Punkte minus Markterwartung der letzten Spiele“: −0,012 (letzte 3) und
  −0,010 (letzte 5), vier von fünf Ligen negativ, nirgends gesichert. Die Richtung stimmt, die
  Größe reicht nicht für eine Regel.
- **Torsumme:** Das Tempo der letzten Spiele (Tore für plus gegen) sagt keine zusätzlichen Tore
  voraus, weder gegenüber dem Modell (−0,014 Tore je Standardabweichung) noch auf Über/Unter
  gegenüber dem Markt (±0,000).

**Was das für die Bundesliga-Befunde von heute Morgen heißt:**

- Die Form ist nicht egal. Sie ist eine der stärksten Informationen, die das torbasierte
  Modell nicht hat.
- Sie schadet nur dort, wo sie produktiv wirkt: als Faktor auf die *eigene* Torerwartung. So
  verändert sie die Torsumme, und über die Torsumme sagt sie nachweislich nichts.
- Dass kürzere Halbwertszeiten schlechter sind, widerspricht dem nicht. Tore der letzten
  Wochen rauschen zu stark, die brauchbare Information steckt in Torschüssen und xG.

---

## 5. Saisonendspurt

In den letzten acht Spieltagen bekommt jedes Team ein Etikett:

- **„ohne Ziel“**, wenn es außerhalb der Europapokalplätze (Platz 6, in der Ligue 1 Platz 5)
  und oberhalb der Abstiegszone (Abstiegs- oder Relegationsplatz) steht und rechnerisch
  weder Europa erreichen noch eingeholt werden kann;
- **„mit Ziel“** sonst.

Die Regel ist vereinfacht: ohne Tiebreaker, Pokalsieger oder Sonderregeln.

| Konstellation | Spiele | Tore gegenüber Modell | Tore des Teams mit Ziel | Tore des Teams ohne Ziel | Über 2,5 gegenüber Markt (Spiele) |
|---|---|---|---|---|---|
| beide mit Ziel | 2.078 | +0,08\* | – | – | +1,8 Punkte (1.165) |
| ohne Ziel zu Hause | 242 | **+0,43\*\*** | +0,30\*\* | +0,14 | +4,7 Punkte (136) |
| ohne Ziel auswärts | 218 | **+0,45\*\*** | +0,24\* | +0,21\*\* | +4,9 Punkte (117) |
| beide ohne Ziel | 96 | **+0,48\*\*** | – | – | +0,4 Punkte (51) |
| Vergleich: Spieltag 10 bis 8 vor Schluss | 6.925 | −0,03 | – | – | −0,1 Punkte (3.947) |

- **Die Spiele werden offener:** Beide Seiten treffen öfter. Wer gewinnt, ändert sich dagegen
  kaum. Gegenüber dem Modell ist das Team mit Ziel +0,056 besser [−0,019; +0,131], gegenüber
  dem Markt −0,042 [−0,114; +0,029]. Remis gibt es in 20,4 % gegenüber 22,6 % bepreist.
- **Der Markt sieht einen Teil davon.** Bepreist waren in diesen Spielen 58 % für über
  2,5 Tore, deutlich mehr als sonst. Eingetreten sind 63 %. Der Abstand ist bei 253 Spielen
  mit Über/Unter-Quote nicht gesichert.
- **Die Literatur passt dazu:** Vereine passen ihren Einsatz den Anreizen an, und wichtige
  Spiele zeigen mehr intensive Aktionen (Quellen unten).

---

## 6. Aufsteiger

Aus Sicht des Aufsteigers, ohne Duelle zweier Aufsteiger:

| Spiele | Anzahl | gegen Modell | gegen Markt |
|---|---|---|---|
| 1–5 | 443 | −0,031 [−0,104; +0,043] | +0,009 [−0,062; +0,080] |
| 6–10 | 423 | −0,062 [−0,136; +0,012] | −0,036 [−0,108; +0,037] |
| 11–19 | 767 | −0,028 [−0,082; +0,026] | −0,014 [−0,067; +0,039] |

Das Modell überschätzt Aufsteiger tendenziell, passend zu VERBESSERUNGEN.md, Punkt 15. Die
Literatur berichtet Gewinne mit Wetten auf Aufsteiger zum Saisonstart. Gegen den Markt
bestätigt sich das hier nicht.

---

## 7. Wo das Basismodell gegen den Markt verliert

RPS-Rückstand des Basismodells (ohne Form, ohne Temperatur) nach Saisonfortschritt, positiv
heißt: Der Markt ist besser.

| Ligen | 0–15 % | 15–50 % | 50–70 % | 70–85 % | 85–100 % |
|---|---|---|---|---|---|
| alle fünf | +0,0076\*\* | +0,0055\*\* | +0,0046\*\* | +0,0076\*\* | +0,0087\*\* |
| Premier League (keine Winterpause) | +0,0111\*\* | +0,0082\*\* | +0,0015 | +0,0066\* | +0,0080\* |
| Bundesliga | +0,0026 | +0,0018 | +0,0079\*\* | +0,0089\*\* | +0,0018 |
| La Liga, Serie A, Ligue 1 | +0,0079\*\* | +0,0056\*\* | +0,0047\*\* | +0,0076\*\* | +0,0111\*\* |

- **Über alle Ligen ist das Muster U-förmig.** Am Saisonanfang weiß der Markt von Transfers
  und Vorbereitung, im Endspurt von Motivation, Rotation und Ausfällen.
- **Die Bundesliga fällt aus dem Muster.** Sie verliert vor allem in 50 bis 85 % der Saison,
  also nach der Winterpause. Die Premier League ohne Winterpause hat dort ihren kleinsten
  Rückstand. Das stützt die Winterpausen-Hypothese aus der Hebelmessung, mehr aber nicht:
  Die Bundesliga-Zellen haben nur 400 bis 700 Spiele.

---

## 8. Was daraus für das Modell folgt

1. **Temperatur zur Grundrate, ρ für die Bundesliga nicht anfassen.**
   - Mit ρ = −0,15 überschätzt das Basismodell über fünf Ligen das Remis um 2,2 Punkte und das
     0:0 um 1,9 Punkte.
   - In der Produktion legt die Temperatur T = 1,2 noch 1,7 Punkte Remis drauf
     (Bundesliga-Validation, Hebelmessung vom selben Tag).
   - Je Liga gerechnet will die Bundesliga aber ρ = −0,15 (Abschnitt 2). Der Kandidat 2027/28
     behält deshalb das produktive ρ und ändert nur die Temperatur (MESSLAUF.md, Messplan 2).
   - Offen bleibt das 0:0. Dafür braucht es eine Matrixform, die es getrennt behandelt, gewählt
     auf der Mehrliga-Messbasis (VERBESSERUNGEN.md, Punkt 22).
2. **Die Form bleibt, als Differenz und aus Prozessdaten.**
   - Die Daten bestätigen beide Teile des Kandidaten von heute: Form sagt etwas über das
     Kräfteverhältnis, nichts über die Toranzahl.
   - Die Produktion benutzt mit xG schon das richtige Signal. Eine Punkte-Form wäre
     schlechter.
3. **Die laufende Saison besser nutzen, aber nicht über kürzere Halbwertszeiten auf Toren.**
   - Überleistung hält an, und zur Saisonmitte erreicht die Torschussbilanz fast das ganze
     Modell.
   - Der Weg führt über bessere Daten der laufenden Saison: den xG-Blend-Fit, eventuell
     zusätzlich Torschüsse (in den CSVs für alle Ligen vorhanden).
4. **Der Endspurt-Effekt auf die Torsumme ist ein Kandidat für den Sommer, nicht für jetzt.**
   - Gegenüber dem Modell ist er groß und sicher, gegenüber dem Markt unsicher.
   - Er gehört mit fester Definition in den Messplan. Zielgröße wäre der Über/Unter-LogLoss in
     den letzten acht Spieltagen.
5. **Kein Handlungsbedarf** bei Heimvorteil (stabil außer Geisterspielen), Aufsteigern (kein
   Muster) und Tempo-Form (wirkungslos).
6. **Regeln gegen den Markt gibt es kaum.**
   - Tabellenplatz, Form und Serien stecken vollständig in der Schlussquote.
   - Zwei Spuren bleiben übrig, beide schwach: eine leichte Überreaktion auf Punkteserien und
     mehr Tore im Endspurt bei Teams ohne Ziel.
   - Der Weg zur Konkurrenzfähigkeit führt über ein Modell, das die Information so gut nutzt
     wie der Markt, und über Information, die er erst später hat. Einfache Faustregeln führen
     dort nicht hin.

---

## Literatur

Gesichtet über Zusammenfassungen und Abstracts, nicht im Volltext.

| Thema | Was die Literatur sagt | Was unsere Daten sagen |
|---|---|---|
| Form, Momentum | Einfache Regressionen finden kaum Vorhersagekraft der Form; Hot-Hand-Effekte sind meist zu klein, um etwas vorherzusagen ([Eighty Five Points](https://eightyfivepoints.blogspot.com/2019/03/do-we-overestimate-importance-of-form.html), [Significance](https://significancemagazine.com/has-the-hot-hand-effect-finally-been-proven/), [Data 2024](https://ideas.repec.org/a/gam/jdataj/v9y2024i2p29-d1331323.html)) | Für Ergebnis-Form richtig. Prozess-Form (Torschüsse, xG) trägt dagegen klar Information über ein langfristiges Modell hinaus |
| Markt überreagiert auf Serien | Quoten überreagieren auf gute und schlechte Serien ([Wheatcroft 2020](https://ideas.repec.org/a/bpj/jqsprt/v16y2020i3p193-209n1.html)) | Richtung bestätigt, Größe klein, nicht gesichert |
| xG und Schüsse gegen Tore | xG sagt künftigen Erfolg besser voraus als klassische Statistiken ([PLOS ONE 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10075453/), [R-bloggers 2024](https://r-bloggers.com/2024/06/expected-goals-gamestate-and-predictiveness-2)) | bestätigt: Torschüsse > Tordifferenz > Punkte |
| Tordifferenz gegen Punkte | Bei Punktgleichheit liegt meist das Team mit besserer Tordifferenz am Ende vorn ([Racing Post](https://racingpost.com/sport/terriers-out-to-prove-that-points-make-the-difference/287328)); Gegenposition bei [FiveThirtyEight](https://fivethirtyeight.com/features/why-scoring-goals-doesnt-guarantee-a-championship-in-european-soccer) | bestätigt |
| Ergebnismatrix | Dixon-Coles korrigiert nur 0:0, 1:0, 0:1, 1:1; Karlis und Ntzoufras blähen die ganze Diagonale auf ([JSS](https://www.jstatsoft.org/index.php/jss/article/view/v014i10/v14i10.pdf), [arXiv 2508.05891](https://arxiv.org/pdf/2508.05891)); ein Weibull-Zählprozess mit Copula passt besser als Poisson ([Boshnakov, Kharrat, McHale 2017](https://econpapers.repec.org/RePEc:eee:intfor:v:33:y:2017:i:2:p:458-466)) | 0:0 mit ρ = −0,15 deutlich überschätzt; Ergebnisse, in denen beide treffen, sind häufiger als unabhängige Tore sagen |
| Endspurt, Anreize | Vereine passen den Einsatz den Anreizen an, über zehn europäische Ligen ([Alberta 2012](https://sites.ualberta.ca/~econwps/2012/wp2012-13.pdf)); wichtige Spiele zeigen mehr intensive Aktionen ([Link und de Lorenzo 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC4900650)) | mehr Tore, nicht mehr Siege |
| Geisterspiele | Der Heimvorteil schrumpfte, Schiedsrichter verwarnten Heimteams öfter ([Leitner und Richlan 2021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8416626/), [ETH](https://www.research-collection.ethz.ch/handle/20.500.11850/445575)); einzelne Studien sehen sogar einen Heimnachteil in der Bundesliga | bestätigt, der Markt ging den halben Weg mit |
| Remis- und Außenseiter-Verzerrung | In englischen Daten 2010–2018 keine systematische Verzerrung gegenüber den Ergebnissen ([Manchester](https://research.manchester.ac.uk/en/publications/biases-in-the-football-betting-market/)); Erklärungen über Marktstruktur bei [Whelan](https://www.karlwhelan.com/?p=2381) | Markt gut kalibriert, Remis bei klaren Favoriten leicht zu hoch bepreist |
| Aufsteiger | Wetten auf Aufsteiger zum Saisonstart brachten Gewinne (Deutscher u. a. 2018, zitiert bei [Winkelmann, Ötting, Deutscher](https://epflicht.ulb.uni-muenster.de/download/pdf/715972)) | nicht bestätigt |

Daten: [football-data.co.uk](https://football-data.co.uk), Ergebnisse, Torschüsse und Quoten.

---

## Reproduzieren

Gerechnet mit Einmal-Skripten außerhalb des Repos. Sie liegen im temporären Scratchpad und
gehen bei einem Neustart verloren:

- `C:\Users\noahm\AppData\Local\Temp\claude\4b130fea4dc04c43\3f5eb561-0179-4d6c-b56b-644ff0988744\scratchpad\top5core.mts`
- `C:\Users\noahm\AppData\Local\Temp\claude\4b130fea4dc04c43\3f5eb561-0179-4d6c-b56b-644ff0988744\scratchpad\top5.mts`
- `C:\Users\noahm\AppData\Local\Temp\claude\4b130fea4dc04c43\3f5eb561-0179-4d6c-b56b-644ff0988744\scratchpad\top5b.mts`

Sie benutzen aus dem Repo nur `buildLeagueModel`, die Dixon-Coles-Matrix, das Entvigen und
`computeXgForm`. Die vier fremden Ligen kommen von
`https://football-data.co.uk/mmz4281/<Saison>/<Liga>.csv` (E0, SP1, I1, F1), die Bundesliga
aus `data/`. Soll das dauerhaft bleiben, gehört es in die Mehrliga-Messbasis aus dem Plan.
