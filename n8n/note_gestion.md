## SMC Vision — gestion des trades (COMPTE DÉMO)

Toutes les 5 minutes, pour chaque position ouverte du bot SMC Vision :
1. **TP1 pas encore atteint** : on ne touche à rien.
2. **TP1 atteint** : le stop passe à l'entrée (break-even + 0,05R).
3. **Ensuite** : le stop suit la structure M15 (sous chaque nouveau creux pour un achat, au-dessus de chaque nouveau sommet pour une vente). Il ne recule jamais.

Chaque déplacement est noté dans la colonne *gestion* du journal **SMC_Vision_Journal**.
Ne gère jamais les positions des autres bots ni les trades manuels.
