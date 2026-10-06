# SMC Vision : bot de trading ICT / SMC autonome (compte démo)

Le bot lit le graphique comme une trader. Il ne s'appuie jamais sur un seul élément : il
construit une lecture complète du marché, du Monthly au M15, et ne trade que lorsque toute
l'histoire va dans le même sens.

## Comment il lit le graphique (v2)

Le bot ne suit pas une checklist rigide : il raconte l'histoire du graphique et donne une **note**.
Il ne trade que les setups **A++** (note ≥ 20), avec quelques interdits absolus.

1. **Vision HTF (Monthly, Weekly, Daily)** : biais (structure BOS / CHoCH), dealing range Daily (prime / décote),
   point B visé (DOL : plus haut / bas de la veille, de la semaine, du mois, sommets / creux égaux), zones HTF.
2. **Setup H4** : jambe A → B qui casse la structure ; le point A balaie de la liquidité (AMD : accumulation,
   manipulation, distribution) ; retour en zone de décote, idéalement l'OTE (0,62-0,79) dans un OB, breaker, FVG,
   IFVG ou BPR. Range H4 non balayé ou mouvement qui a déjà atteint son point B : pas de trade.
3. **Confirmation H1** : rejet par grande mèche, CHoCH H1 ou FVG H1 au moment du balayage.
4. **Entrée M15** en killzone (Londres 02h-05h, New York 07h-11h, heure de New York ; cryptos 24h/24) :
   - balayage d'une liquidité (session Asie / Londres, plus bas de la veille, creux égaux, bord de range, ligne de tendance…),
     à l'extrême de la structure, avec une mèche qui revient ;
   - MSS en clôture avec un vrai déplacement (grande bougie) ;
   - **ordre limite au 50 % du FVG** laissé par le déplacement (sinon BPR, sinon OB), annulé à la fin de la killzone.
5. **Bonus** : Power of 3 (manipulation sous l'ouverture de minuit NY), Judas swing sur l'Asie, liquidité cumulée,
   volume, **SMT** avec l'actif corrélé, divergence RSI, RSI qui sort de sa zone neutre.
6. **Interdits absolus** : jamais sans balayage de liquidité, jamais contre le biais HTF sans balayage d'une liquidité
   HTF dans une zone HTF, jamais dans un range non balayé, jamais sous 2R, jamais dans un mouvement déjà tradé ou terminé.
7. **Gestion** (workflow « SMC Vision - Gestion des trades », toutes les 5 min) : stop derrière la mèche du balayage ;
   deux demi-ordres TP1 (première liquidité à ≥ 2R) et TP2 (point B HTF) ; quand TP1 est atteint, stop à l'entrée,
   puis stop suiveur sous chaque nouveau creux M15 (au-dessus de chaque sommet pour une vente).

Pour la vente, le moteur retourne le graphique (miroir) et applique exactement les mêmes règles.

## Règles de risque (compte démo uniquement)

- Risque par trade dégressif selon le solde (accord écrit du 06/10/2026), réglable dans `paliersRisque` du nœud *Configuration* :

  | Solde | Risque par trade |
  |---|---|
  | moins de 7 500 | 5 % |
  | 7 500 à 10 000 | 4 % |
  | 10 000 à 15 000 | 3,5 % |
  | 15 000 à 20 000 | 3 % |
  | 20 000 à 30 000 | 2,5 % |
  | 30 000 à 50 000 | 2 % |
  | 50 000 à 100 000 | 1,5 % |
  | 100 000 et plus | 1 % |

  Sécurité : jamais plus de 5 %, même si un palier est mal saisi.
- Au plus 2 pertes par jour (jour de Paris). Au plus 3 trades SMC Vision ouverts en même temps.
- Un seul trade par actif à la fois.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/moteur.js` | Le moteur de lecture ICT/SMC (toute la stratégie) |
| `n8n/*.js` | Le code des nœuds n8n (configuration, cycle, taille de position, journal, gestion des stops) |
| `build/construire.js` | Assemble le tout en `n8n/workflow.sdk.js` (bot) et `n8n/gestion.sdk.js` (gestion) |
| `tests/` | Histoires de graphiques et vérification des décisions du bot |

```
node tests/test_moteur.js      # le moteur
node build/construire.js       # génère le workflow
node tests/test_n8n.js         # les nœuds n8n, avec un faux bridge
```

## Dans n8n

- Workflow : **SMC Vision - Bot ICT/SMC autonome (DEMO Fusion cTrader)** (id `LYNpvTXkKDTe4bnU`). Il est créé **inactif** : c'est toi qui l'actives.
- Journal : la table **SMC_Vision_Journal** (id `T1SH2vr9hn0f1Ahm`) reçoit une ligne par trade. Elle contient la lecture top-down, la zone, la liquidité, les confirmations, l'entrée, le stop, les objectifs, les numéros d'ordre et le résultat. Le résultat est mis à jour au cycle suivant la clôture.
- Pourquoi il n'a pas tradé : regarde la sortie du nœud *Lecture ICT/SMC* dans l'exécution.

## Points à vérifier avant d'activer

- Les noms broker de **US30** (`US 30`) et **USOIL** (`XTIUSD`) sont supposés. S'ils sont faux, le bot écrit « Données insuffisantes » pour ces actifs.
- Le bot demande au bridge les unités de temps `1d`, `1w` et `1M`. S'il ne les connaît pas, il reconstruit le Daily à partir du H4 (1 000 bougies, environ 6 mois), puis le Weekly et le Monthly à partir du Daily.
- Les sessions (Asie, Londres, New York) sont calculées en heures UTC fixes.
- GER40 (en euros) : le risque est converti avec un facteur prudent de 1,25.
