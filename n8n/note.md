## SMC Vision — bot ICT/SMC (COMPTE DÉMO)

A chaque clôture M15 :
1. **Règles du compte** : au plus 2 pertes par jour, risque dégressif selon le solde (5 % sous 7 500, jusqu'à 1 % au-delà de 100 000), objectif ≥ 2R.
2. **Lecture top-down** pour chaque actif : Monthly, Weekly, Daily (direction, liquidité, zones), puis **H4** (jambe A→B, OTE, zones), puis **M15** (vrai balayage, MSS, retour à 0,5 dans une confluence, rebond).
3. On ne trade que si **toute l'histoire** va dans le même sens, avec des confirmations (RSI, divergences, volume).
4. Chaque trade est écrit dans la table **SMC_Vision_Journal**.

La raison de chaque « pas de trade » est visible dans la sortie du nœud *Lecture ICT/SMC*.
Code source et tests : dépôt GitHub Trading-ICT_SMC.
