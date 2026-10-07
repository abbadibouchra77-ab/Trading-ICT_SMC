# SMC Vision : bot de trading ICT / SMC autonome (compte démo)

Le bot lit le graphique comme une trader. Il ne s'appuie jamais sur un seul élément : il
construit une lecture complète du marché, du Monthly au M15, et ne trade que lorsque toute
l'histoire va dans le même sens.

## Comment il lit le graphique (v3, lecture par scénarios)

Le bot ne suit pas une checklist et n'a pas de note minimale : il cherche une **histoire de marché cohérente**,
qui peut prendre plusieurs formes. Les autres éléments sont des confirmations notées dans le journal.

1. **Vision du marché (Monthly, Weekly, Daily)** : direction globale, dealing range Daily, point B visé (DOL).
   Elle ne bloque rien.
2. **Direction** : la dernière cassure de structure (BOS / CHoCH) **faite avec déplacement** (grande bougie), en H4 et en H1.
   Le creux de swing est le plus bas entre deux sommets. Un retracement lent vers l'OTE ne change pas la direction ;
   un CHoCH vendeur avec déplacement, si. On ne trade que si H4 et H1 vont dans le même sens.
3. **Contexte (H4, ou H1)**, plusieurs lectures possibles :
   - **tendance** : la jambe qui a fait la cassure, puis retour en décote / OTE ;
   - **AMD** : range, mèche qui liquide le range dans une zone d'intérêt formée avant, puis déplacement opposé ;
   - **cassure** : bougie de déplacement qui casse un range horizontal ou diagonal et clôture dehors.
4. **Réaction M15** dans le contexte : extrême du retracement depuis le point B, MSS qui casse un vrai sommet / creux
   (pivot de 3 bougies) avec déplacement. Si le H1 était en range, le MSS doit en faire sortir le prix.
5. **Entrée** : ordre limite au 50 % du FVG du déplacement (sinon BPR, sinon OB), stop derrière la réaction M15 et au
   moins à 1 ATR H1 de l'entrée, TP1 à 2R au moins sur de la liquidité. **24h/24 sur tous les actifs** : l'ordre expire
   à la fin de la killzone s'il est placé en killzone, sinon au bout de 3 h.
6. **Confirmations (jamais bloquantes)** : OTE, zone d'intérêt (OB, breaker, FVG, IFVG, BPR), liquidité prise sur le
   contexte, mèche de liquidation, killzone, confirmation H1, Power of 3, Judas swing, inducement, volume, SMT, RSI.
   Qualité **A+++** : tendance + retour dans l'OTE dans une zone d'intérêt + balayage, et la même chose au M15.
7. **Interdits absolus** : jamais sans prise de liquidité (au M15 ou sur le contexte), jamais sous 2R, jamais contre
   la dernière cassure H4 / H1, on ne court pas après le prix, jamais un mouvement déjà tradé ou terminé.
8. **Gestion** (workflow « SMC Vision - Gestion des trades », toutes les 5 min) : deux demi-ordres TP1 / TP2 ; quand TP1
   est atteint, stop à l'entrée, puis stop suiveur sous chaque nouveau creux M15 (au-dessus de chaque sommet pour une vente).

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
| `docs/patterns.md` | Référentiel visuel des patterns ICT / SMC et où chacun est codé |

```
node tests/test_moteur.js      # le moteur
node build/construire.js       # génère le workflow
node tests/test_n8n.js         # les nœuds n8n, avec un faux bridge
```

## Dans n8n

- Workflow : **SMC Vision - Bot ICT/SMC autonome (DEMO Fusion cTrader)** (id `LYNpvTXkKDTe4bnU`)
- Workflow : **SMC Vision - Gestion des trades (DEMO Fusion cTrader)** (id `dKm4Qjv714hOjJQs`), toutes les 5 min. Les deux workflows sont créés **inactifs** : c'est toi qui les actives.
- Journal : la table **SMC_Vision_Journal** (id `T1SH2vr9hn0f1Ahm`) reçoit une ligne par trade. Elle contient la lecture top-down, la zone, la liquidité, les confirmations, l'entrée, le stop, les objectifs, les numéros d'ordre et le résultat. Le résultat est mis à jour au cycle suivant la clôture.
- Pourquoi il n'a pas tradé : regarde la sortie du nœud *Lecture ICT/SMC* dans l'exécution.

## Points à vérifier avant d'activer

- Les noms broker de **US30** (`US 30`) et **USOIL** (`XTIUSD`) sont supposés. S'ils sont faux, le bot écrit « Données insuffisantes » pour ces actifs.
- Le bot demande au bridge les unités de temps `1d`, `1w` et `1M`. S'il ne les connaît pas, il reconstruit le Daily à partir du H4 (1 000 bougies, environ 6 mois), puis le Weekly et le Monthly à partir du Daily.
- Les sessions (Asie, Londres, New York) sont calculées en heures UTC fixes.
- GER40 (en euros) : le risque est converti avec un facteur prudent de 1,25.

## Backtest

Le dossier `backtest/` rejoue le bot sur l'historique, bougie M15 par bougie M15, sans regarder le futur :
ordres limites qui expirent, spread, stop compté en premier si stop et objectif sont dans la même bougie,
deux demi-positions avec break-even après TP1 puis stop suiveur M15, risque dégressif selon le solde,
2 pertes par jour et 3 actifs engagés au plus.

```
node backtest/lancer.js --donnees <dossier des CSV> --depuis 2021-01-01 --jusqua 2025-12-31 --capital 10000 --sortie resultats
node tests/test_backtest.js
```

Un CSV par actif (M15 ou M1), colonnes `time, open, high, low, close, volume`, heure en UTC.
Le rapport (`resultats/rapport.md`) donne le compte complet, les résultats par actif et par année, et `trades.csv` liste chaque trade.
