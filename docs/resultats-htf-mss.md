# Stratégie « POI H4 + MSS/BOS M15 + FVG/OB dans l'OTE » : état des résultats

Données : M15, 13 actifs, 2019-2026. Périodes : apprentissage 2019-2021, validation 2022-2023, test 2024-2026 (regardé en dernier).
Coûts : spread moyen par actif (voir `backtest/lancer.js`). PF = total des gains / total des pertes, en R.

## Ce qui a été corrigé (blocages qui faussaient les résultats)
1. Ordres limites remplis des heures après la fin du mouvement : annulés si le stop est touché avant le remplissage.
2. Cible fixée à la pose de l'ordre : elle est maintenant la première liquidité non prise **au moment du remplissage**.
3. Expiration en heures d'horloge (le week-end tuait les ordres) : maintenant en bougies.
4. POI H4 attendue jusqu'à la clôture de sa dernière bougie : suivie en direct.
5. Structure M15 mal amorcée sur une POI en direct : le mode `swing` calcule les jambes (creux → sommet pivot) indépendamment de la POI ; la POI sert de contexte.
6. Range AMD trop étroit (plafond 5 ATR) : réglable (`hauteurMax`).

## Ce que le bot reproduit désormais (trades de référence donnés par l'utilisateur)
- US 500 vente du 25/03/2019 (FVG F4 à 2803,6) : reproduit.
- XAUUSD achat du 08/03/2022 (cassure de range, FVG 50 %) : reproduit par le moteur AMD.
- US 500 vente du 14/12/2021 (OB) : non reproduit (le rebond précède la confirmation du pivot).
- XAUUSD vente du 09/03/2022 : non reproduit.
- BTCUSD achat du 15/02/2023 : écarté des références (trade jugé trop complexe pour un bot).

## Résultats (net de spread)
- POI H4 seule, H4+D1, avec ou sans OB en direct : PF 0,88 à 0,93 sur les trois périodes, donc aucune amélioration en élargissant les POI.
- Mode `swing`, réglage de base : PF 0,90 / 0,92 / 0,92 (apprentissage / validation / test).
- Sans spread : PF 1,08 / 1,05 / 1,01 → l'avantage brut est mince et disparaît en test.
- Recherche aléatoire de 400 configurations : 2 passent PF ≥ 1,03 en apprentissage ET validation ; les deux perdent en test (PF 0,96 et 0,93). PF moyen en test de toutes les configurations : 0,94.

## Conclusion
Aucun réglage testé n'a d'avantage net robuste. Le bot applique les règles décrites, mais ces règles se déclenchent sur beaucoup de situations que le trader écarte à l'œil.
Piste non testée : un jeu de trades gagnants/perdants étiquetés par le trader, pour apprendre ce qui les distingue.
