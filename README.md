# SMC Vision : bot de trading ICT / SMC autonome (compte démo)

Le bot lit le graphique comme une trader. Il ne s'appuie jamais sur un seul élément : il
construit une lecture complète du marché, du Monthly au M15, et ne trade que lorsque toute
l'histoire va dans le même sens.

## Comment il lit le graphique

À chaque clôture de bougie M15, et seulement sur des bougies clôturées, pour chaque actif :

1. **Lecture du haut (Monthly, Weekly, Daily)**
   - structure (plus hauts et plus bas, BOS, CHoCH) ;
   - liquidité visée (plus hauts et plus bas du jour, de la semaine, du mois, sommets et creux égaux) ;
   - zones (OB, FVG, IFVG, breaker, supports et résistances) ;
   - position du prix dans le grand mouvement : prime ou décote.
2. **H4, le setup**
   - Jambe A → B : A est la mèche extrême d'où part le mouvement, B est l'extrême atteint. La jambe doit avoir cassé une structure.
   - Le prix doit revenir dans l'OTE (0,5 et au-delà).
   - Le range est interdit tant qu'un de ses bords n'a pas été balayé.
   - Le RSI qui tourne autour de 50 est interdit.
   - Le mouvement qui a déjà atteint son point B est interdit.
   - Acheter juste sous une résistance qui vient de rejeter le prix est interdit.
3. **M15, l'entrée**
   - Le vrai balayage, à l'extrême de toute la structure.
   - Le MSS, en clôture.
   - Le retour à 0,5 du Fibonacci M15 dans une confluence (OB, FVG, IFVG, breaker M15 ou zone H4).
   - Le rebond.
   - Variante : balayage, MSS, retest de l'OB, BOS de confirmation, puis entrée au retest du FVG ou de l'IFVG.
4. **Contre la lecture du haut** : le trade n'est permis que si la liquidité prise est une
   liquidité Daily, Weekly ou Monthly, ou si elle est prise dans une zone Daily ou Weekly. Il
   faut alors une confirmation de plus.
5. **Confirmations** (jamais suffisantes seules, il faut au moins 2 points) :
   - rebond du RSI sur 50 en même temps que le prix ;
   - cassure de 50 par le RSI avec deux clôtures ;
   - divergences ;
   - surachat ou survente ;
   - volume.
6. **Gestion du trade**
   - Stop derrière la mèche du balayage, avec une petite marge.
   - TP1 et TP2 sur la liquidité visible en face, à au moins 2R. Deux ordres si le volume le permet.
   - Un mouvement déjà tradé (même point A H4) n'est jamais repris.

Pour la vente, le moteur retourne le graphique (miroir) et applique exactement les mêmes
règles. Les deux sens sont donc toujours traités pareil.

## Règles de risque (compte démo uniquement)

- Risque par trade : `riskPercent` dans le nœud *Configuration* (1 % par défaut). Le code le plafonne à 2 %.
- Au plus 2 pertes par jour (jour de Paris). Au plus 3 trades SMC Vision ouverts en même temps.
- Un seul trade par actif à la fois.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/moteur.js` | Le moteur de lecture ICT/SMC (toute la stratégie) |
| `n8n/*.js` | Le code des nœuds n8n (configuration, cycle, taille de position, journal) |
| `build/construire.js` | Assemble le tout en `n8n/workflow.sdk.js` (workflow n8n) |
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
