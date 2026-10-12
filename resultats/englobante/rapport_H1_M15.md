# Backtest : englobante avec prise de liquidité dans une zone POI

Période : 2019-03-01 au 2026-12-31. Objectif 2R, stop derrière la mèche, entrée au marché à la clôture (spread compris).

## Résumé (en R, tous actifs)

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| H1 | 13511 | 30.8 % | -1076.8 | -0.080 | 0.89 | 1078.8 | 33 |
| M15 | 49894 | 28.8 % | -7096.9 | -0.142 | 0.80 | 7098.5 | 47 |

## H1

**Compte de 10000** (risque dégressif, 2 pertes par jour, 3 actifs au plus) : solde final 0, drawdown max 100.0 %, 6401 trades pris (5217 refusés pour 2 pertes du jour, 1893 pour 3 actifs engagés).

### Par actif

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| AUDUSD | 967 | 29.3 % | -123.9 | -0.128 | 0.82 | 132.8 | 18 |
| BTCUSD | 1285 | 30.4 % | -116.8 | -0.091 | 0.87 | 131.8 | 18 |
| ETHUSD | 1227 | 29.9 % | -124.9 | -0.102 | 0.85 | 133.9 | 17 |
| EURUSD | 948 | 31.3 % | -63.3 | -0.067 | 0.90 | 66.3 | 12 |
| GBPUSD | 973 | 28.8 % | -139.4 | -0.143 | 0.80 | 149.4 | 16 |
| GERMANY 40 | 1062 | 32.9 % | -22.0 | -0.021 | 0.97 | 58.7 | 12 |
| US 30 | 1076 | 31.8 % | -54.0 | -0.050 | 0.93 | 74.0 | 17 |
| US 500 | 1029 | 31.1 % | -76.0 | -0.074 | 0.89 | 96.5 | 17 |
| US TECH 100 | 1035 | 33.6 % | 3.3 | 0.003 | 1.00 | 38.2 | 12 |
| USDJPY | 926 | 32.7 % | -27.4 | -0.030 | 0.96 | 58.8 | 18 |
| XAGUSD | 989 | 26.3 % | -209.3 | -0.212 | 0.71 | 219.4 | 23 |
| XAUUSD | 984 | 32.6 % | -23.7 | -0.024 | 0.96 | 74.7 | 15 |
| XTIUSD | 1010 | 30.5 % | -99.3 | -0.098 | 0.86 | 118.5 | 14 |

### Par année

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| 2019 | 1366 | 30.3 % | -133.0 | -0.097 | 0.86 | 140.4 | 19 |
| 2020 | 1737 | 31.3 % | -120.4 | -0.069 | 0.90 | 172.8 | 30 |
| 2021 | 1826 | 31.7 % | -96.1 | -0.053 | 0.92 | 128.1 | 14 |
| 2022 | 1846 | 30.6 % | -156.0 | -0.084 | 0.88 | 161.4 | 26 |
| 2023 | 1831 | 31.9 % | -90.6 | -0.049 | 0.93 | 147.8 | 16 |
| 2024 | 1804 | 30.1 % | -180.4 | -0.100 | 0.86 | 200.9 | 33 |
| 2025 | 1752 | 29.7 % | -200.7 | -0.115 | 0.84 | 202.7 | 20 |
| 2026 | 1349 | 31.1 % | -99.7 | -0.074 | 0.89 | 117.7 | 22 |

### Par type de zone POI

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| Breaker | 941 | 30.4 % | -87.4 | -0.093 | 0.87 | 104.0 | 17 |
| FVG | 4852 | 30.9 % | -380.5 | -0.078 | 0.89 | 405.9 | 20 |
| IFVG | 622 | 30.5 % | -63.4 | -0.102 | 0.86 | 82.4 | 17 |
| OB | 7096 | 30.9 % | -545.5 | -0.077 | 0.89 | 559.5 | 23 |

### Par sens

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| buy | 7654 | 31.8 % | -412.0 | -0.054 | 0.92 | 423.0 | 30 |
| sell | 5857 | 29.7 % | -664.8 | -0.114 | 0.84 | 675.0 | 32 |

## M15

**Compte de 10000** (risque dégressif, 2 pertes par jour, 3 actifs au plus) : solde final 0, drawdown max 100.0 %, 9122 trades pris (39463 refusés pour 2 pertes du jour, 1309 pour 3 actifs engagés).

### Par actif

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| AUDUSD | 3603 | 26.8 % | -760.0 | -0.211 | 0.72 | 766.0 | 21 |
| BTCUSD | 5331 | 28.9 % | -710.8 | -0.133 | 0.81 | 723.8 | 21 |
| ETHUSD | 5035 | 25.8 % | -1138.0 | -0.226 | 0.70 | 1139.0 | 26 |
| EURUSD | 3681 | 26.0 % | -837.5 | -0.228 | 0.70 | 849.5 | 23 |
| GBPUSD | 3755 | 27.3 % | -692.7 | -0.184 | 0.75 | 694.7 | 30 |
| GERMANY 40 | 3764 | 31.2 % | -293.3 | -0.078 | 0.89 | 355.8 | 19 |
| US 30 | 3599 | 31.6 % | -224.6 | -0.062 | 0.91 | 247.3 | 18 |
| US 500 | 3583 | 31.3 % | -228.4 | -0.064 | 0.91 | 264.9 | 18 |
| US TECH 100 | 3731 | 33.3 % | -33.5 | -0.009 | 0.99 | 124.4 | 19 |
| USDJPY | 3498 | 29.0 % | -478.9 | -0.137 | 0.81 | 484.9 | 34 |
| XAGUSD | 3264 | 24.3 % | -892.7 | -0.273 | 0.64 | 895.7 | 27 |
| XAUUSD | 3720 | 30.9 % | -295.7 | -0.079 | 0.89 | 337.0 | 28 |
| XTIUSD | 3330 | 28.5 % | -510.9 | -0.153 | 0.79 | 523.4 | 25 |

### Par année

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| 2019 | 4949 | 27.1 % | -989.6 | -0.200 | 0.73 | 1013.2 | 29 |
| 2020 | 6505 | 27.2 % | -1245.3 | -0.191 | 0.74 | 1271.2 | 32 |
| 2021 | 6758 | 28.6 % | -973.8 | -0.144 | 0.80 | 1000.7 | 25 |
| 2022 | 6993 | 29.8 % | -770.7 | -0.110 | 0.84 | 778.7 | 47 |
| 2023 | 6340 | 27.7 % | -1110.1 | -0.175 | 0.76 | 1110.1 | 29 |
| 2024 | 6634 | 29.3 % | -832.9 | -0.126 | 0.82 | 845.9 | 33 |
| 2025 | 6656 | 30.4 % | -625.2 | -0.094 | 0.87 | 631.2 | 23 |
| 2026 | 5059 | 30.0 % | -549.3 | -0.109 | 0.85 | 579.3 | 23 |

### Par type de zone POI

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| Breaker | 3513 | 28.9 % | -510.2 | -0.145 | 0.80 | 540.9 | 20 |
| FVG | 17739 | 28.8 % | -2539.1 | -0.143 | 0.80 | 2540.0 | 25 |
| IFVG | 2041 | 28.6 % | -305.1 | -0.149 | 0.79 | 330.1 | 24 |
| OB | 26601 | 28.8 % | -3742.4 | -0.141 | 0.80 | 3772.0 | 30 |

### Par sens

| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |
|---|---|---|---|---|---|---|---|
| buy | 26314 | 29.1 % | -3548.0 | -0.135 | 0.81 | 3575.9 | 34 |
| sell | 23580 | 28.5 % | -3548.9 | -0.151 | 0.79 | 3551.2 | 38 |

## Diagnostics

- **Sans spread** (même règles, coûts à zéro) : H1 13 701 trades, 32,8 %, R moyen -0,022, PF 0,97 ;
  M15 51 327 trades, 32,6 %, R moyen -0,030, PF 0,96. À 2R il faut au moins 33,3 % de réussite pour être à zéro.
- **Variante « corps »** (la bougie précédente est baissière, l'englobante clôture au-dessus de son ouverture) :
  H1 18 133 trades, 30,9 %, R moyen -0,081, PF 0,88 ; M15 69 374 trades, 28,5 %, R moyen -0,150, PF 0,79.

Commande : `node backtest/englobante.js --donnees <dossier CSV> --ut 60,15 --sortie resultats/englobante`

## Filtre « range, pas de direction » (annotation du 12/10/2026 sur la perte XAUUSD H1 du 06/10)

| Réglage | H1 trades | H1 réussite | H1 R moyen | H1 PF | M15 trades | M15 réussite | M15 R moyen | M15 PF |
|---|---|---|---|---|---|---|---|---|
| sans filtre | 13 511 | 30,8 % | -0,080 | 0,89 | 49 894 | 28,8 % | -0,142 | 0,80 |
| structure de l'UT du signal dans le sens du trade (`structureUt`) | 8 232 | 31,3 % | -0,066 | 0,90 | 29 837 | 28,8 % | -0,142 | 0,80 |
| pas de range sur 24 bougies (efficacité < 0,3) | 4 514 | 30,6 % | -0,087 | 0,88 | 13 711 | 28,6 % | -0,150 | 0,79 |
| pas de range sur 24 bougies (efficacité < 0,5) | 1 051 | 30,2 % | -0,100 | 0,86 | 2 491 | 28,2 % | -0,161 | 0,78 |
| structure + pas de range (0,3) | 2 589 | 31,5 % | -0,058 | 0,92 | 7 618 | 28,9 % | -0,142 | 0,80 |
| **structure + pas de range (0,5)** | **595** | **32,8 %** | **-0,020** | **0,97** | 1 472 | 30,0 % | -0,107 | 0,85 |
| achat en décote / vente en prime (48 bougies) | 5 659 | 30,2 % | -0,099 | 0,86 | 20 218 | 27,9 % | -0,166 | 0,77 |
| structure + range (0,5) + décote (48) | 48 | 31,3 % | -0,095 | 0,86 | 84 | 23,8 % | -0,286 | 0,63 |

Réglage : `--reglages '{"structureUt":true,"rangeFenetre":24,"rangeEff":0.5}'`.

## Vraie bougie englobée, sens opposé, pas sur un support / une résistance (règles du 12/10/2026)

Base : `precOpposee` (la bougie englobée va dans l'autre sens) + `corpsPrecMin` 0,5 (pas de doji : corps ≥ 50 % de la bougie).

| Réglage | H1 trades | H1 réussite | H1 R moyen | H1 PF | M15 trades | M15 réussite | M15 R moyen | M15 PF |
|---|---|---|---|---|---|---|---|---|
| A : base | 4 352 | 31,7 % | -0,056 | 0,92 | 17 051 | 29,8 % | -0,113 | 0,84 |
| B : A + structure UT + pas de range (0,3) | 622 | 32,2 % | -0,038 | 0,94 | 1 903 | 30,1 % | -0,107 | 0,85 |
| C : A + structure UT + pas de range (0,5) | 105 | 28,6 % | -0,143 | 0,80 | 284 | 29,2 % | -0,144 | 0,80 |
| D : B + 2R de place jusqu'au sommet / creux non pris (`espaceR` 2) | 253 | 33,2 % | -0,005 | 0,99 | 737 | 27,5 % | -0,190 | 0,74 |
| E : C + `espaceR` 2 | 52 | 23,1 % | -0,308 | 0,60 | 138 | 26,8 % | -0,227 | 0,70 |
| **F : D + englobante avec un vrai corps (`corpsEnglMin` 0,5)** | **202** | **34,2 %** | **+0,023** | **1,03** | 632 | 26,7 % | -0,207 | 0,72 |
| G : A + structure UT + `espaceR` 2 | 743 | 31,4 % | -0,071 | 0,90 | 2 518 | 28,4 % | -0,155 | 0,79 |
| H : A + `espaceR` 2 | 1 275 | 29,9 % | -0,111 | 0,84 | 4 428 | 28,2 % | -0,164 | 0,78 |

F : `--reglages '{"precOpposee":true,"corpsPrecMin":0.5,"structureUt":true,"rangeFenetre":24,"rangeEff":0.3,"espaceR":2,"corpsEnglMin":0.5}'`
(202 trades en 7 ans sur 13 actifs : trop peu pour conclure ; années très irrégulières, de -14 R en 2020 à +13 R en 2022).

## Taille des bougies et direction (« un doji qui prend un doji », 12/10/2026)

Une petite bougie pleine passait le filtre « pas de doji » (corps / mèches) mais reste un doji à l'œil :
on exige maintenant une taille minimale par rapport à l'ATR 14. `structureUt: 'swing'` = structure de swing
externe avec déplacement (comme le moteur) au lieu des pivots 2 bougies.

Base : bougie englobée opposée, corps ≥ 50 % pour les deux bougies, pas de range (24 bougies, 0,3).

| Réglage | H1 trades | H1 réussite | H1 R moyen | H1 PF | M15 trades | M15 réussite | M15 R moyen | M15 PF |
|---|---|---|---|---|---|---|---|---|
| **I : structure pivots + `espaceR` 2 + englobée ≥ 0,8 ATR + englobante ≥ 1,2 ATR** | **87** | **41,4 %** | **+0,241** | **1,41** | 282 | 26,6 % | -0,202 | 0,72 |
| J : structure swing + `espaceR` 2 | 198 | 31,8 % | -0,047 | 0,93 | 713 | 27,2 % | -0,191 | 0,74 |
| K : structure swing + `espaceR` 2 + tailles 0,8 / 1,2 | 90 | 34,4 % | +0,033 | 1,05 | 314 | 28,0 % | -0,159 | 0,78 |
| L : structure swing + tailles 0,8 / 1,2 | 233 | 30,5 % | -0,091 | 0,87 | 851 | 29,5 % | -0,120 | 0,83 |
| M : structure swing + `espaceR` 2 + tailles 0,6 / 1,0 | 122 | 36,9 % | +0,104 | 1,16 | 475 | 27,6 % | -0,181 | 0,75 |
| N : structure swing + `espaceR` 1,5 + tailles 0,8 / 1,2 | 101 | 32,7 % | -0,020 | 0,97 | 354 | 28,8 % | -0,136 | 0,81 |
| O : structure pivots + tailles 0,8 / 1,2 (sans `espaceR`) | 213 | 33,8 % | +0,010 | 1,02 | 657 | 28,6 % | -0,148 | 0,79 |

I en H1 : compte de 10 000 -> 19 338 (drawdown max 42,8 %), 6 années positives sur 8 (2020 : -10 R).
Attention : 87 trades en 7 ans et demi (environ 1 par mois sur 13 actifs) et un réglage choisi parmi une vingtaine :
l'avantage n'est pas encore prouvé (écart type du R moyen ≈ 0,16).

I : `--reglages '{"precOpposee":true,"corpsPrecMin":0.5,"corpsEnglMin":0.5,"rangeFenetre":24,"rangeEff":0.3,"structureUt":true,"espaceR":2,"taillePrecMin":0.8,"tailleEnglMin":1.2}'`

## L'englobante engloutit la bougie d'avant, elle ne l'explose pas (12/10/2026)

« Pas fait son double ou son triple » : `ratioMax` = taille de l'englobante / taille de la bougie englobée au plus.
Base W = bougie englobée opposée, corps ≥ 50 % pour les deux, bougie englobée ≥ 0,8 ATR, englobante ≤ 2 x la bougie englobée
(plus de `tailleEnglMin`). Sans les filtres de direction H1 / range / place : seulement la direction Daily (H4) et la POI.

| Réglage | H1 trades | H1 réussite | H1 R moyen | H1 PF | M15 trades | M15 réussite | M15 R moyen | M15 PF |
|---|---|---|---|---|---|---|---|---|
| **W** | **1 222** | **35,3 %** | **+0,055** | **1,08** | 5 380 | 30,4 % | -0,090 | 0,87 |
| W + structure UT (pivots) | 577 | 34,0 % | +0,015 | 1,02 | 2 645 | 29,3 % | -0,125 | 0,82 |
| W + structure UT (swing) | 663 | 34,7 % | +0,036 | 1,05 | 2 982 | 30,2 % | -0,095 | 0,86 |
| W + pas de range (24 ; 0,3) | 315 | 35,2 % | +0,052 | 1,08 | 1 287 | 28,0 % | -0,165 | 0,77 |
| W + `espaceR` 2 | 204 | 35,8 % | +0,064 | 1,10 | 926 | 27,0 % | -0,192 | 0,74 |
| W + structure + pas de range | 109 | 33,9 % | +0,011 | 1,02 | 459 | 27,9 % | -0,172 | 0,76 |
| W, englobée ≥ 0,6 ATR | 1 688 | 34,7 % | +0,035 | 1,05 | 7 836 | 29,7 % | -0,114 | 0,84 |
| W, englobée ≥ 1 ATR | 847 | 34,5 % | +0,030 | 1,05 | 3 169 | 30,4 % | -0,090 | 0,87 |
| W, englobante ≤ 1,5 x | 517 | 35,6 % | +0,063 | 1,10 | 2 658 | 30,5 % | -0,087 | 0,88 |
| W + structure + range + `espaceR` 2 (Q) | 37 | 37,8 % | +0,135 | 1,22 | 156 | 25,0 % | -0,250 | 0,67 |

W en H1 : toutes les variantes voisines sont légèrement positives (+0,01 à +0,06 R). Compte de 10 000 -> 51 681
(drawdown max 59 %). Mais par année : +28,7 / +34,8 / +19,3 / +26,0 R de 2019 à 2022, puis -10,0 / -14,1 / -26,3 R
en 2023-2025 et +8,6 R en 2026 : l'avantage n'est pas stable dans le temps.

W : `--reglages '{"precOpposee":true,"corpsPrecMin":0.5,"corpsEnglMin":0.5,"taillePrecMin":0.8,"ratioMax":2}'`

## Killzones (question du 12/10/2026)

Jusqu'ici les trades étaient pris 24 h / 24. Filtre `killzones` : l'entrée (clôture de l'englobante) doit tomber dans
une killzone, heures de New York comme le moteur (Londres 2h-5h, New York matin 7h-11h). W = définition de l'englobante ci-dessus.

| Réglage | H1 trades | H1 réussite | H1 R moyen | H1 PF | M15 trades | M15 réussite | M15 R moyen | M15 PF |
|---|---|---|---|---|---|---|---|---|
| sans filtre, killzones Londres + NY | 7 138 | 31,5 % | -0,058 | 0,92 | 19 781 | 30,0 % | -0,102 | 0,85 |
| W, 24 h / 24 (rappel) | 1 222 | 35,3 % | +0,055 | 1,08 | 5 380 | 30,4 % | -0,090 | 0,87 |
| W, killzones Londres + NY | 614 | 35,2 % | +0,051 | 1,08 | 2 552 | 30,6 % | -0,083 | 0,88 |
| W, hors killzones | 624 | 35,3 % | +0,056 | 1,09 | 2 901 | 30,4 % | -0,091 | 0,87 |
| **W, killzone de Londres seule** | **215** | **39,1 %** | **+0,172** | **1,28** | 1 216 | 30,5 % | -0,085 | 0,88 |
| W, killzone New York seule | 402 | 32,8 % | -0,022 | 0,97 | 1 346 | 30,5 % | -0,086 | 0,88 |
| W + pas de range, killzones Londres + NY | 166 | 30,7 % | -0,085 | 0,88 | 586 | 27,1 % | -0,186 | 0,74 |

W Londres en H1 : compte de 10 000 -> 27 250 (drawdown max 46 %) ; par année +20 / +7 / -1 / +7 / -11 / +8 / -4 / +11 R
(5 années positives sur 8).
