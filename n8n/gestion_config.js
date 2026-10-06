// Réglages de la gestion des trades SMC Vision. COMPTE DÉMO UNIQUEMENT.
// Règle (validée par Bouchra le 06/10/2026) : quand TP1 est atteint, le stop des positions restantes
// passe à l'entrée (break-even), puis il suit la structure M15 (sous chaque nouveau creux pour un achat,
// au-dessus de chaque nouveau sommet pour une vente). Le stop ne recule jamais.
return [{ json: {
  bridgeUrl: 'http://ctrader-bridge:8080',
  commentaire: 'SMC-Vision',
  label: 'SMCV',
  margeBeR: 0.05,      // break-even : entrée + 0,05R (couvre le spread)
  margeStopAtr: 0.1,   // stop suiveur : 0,1 ATR M15 derrière le creux / sommet
  pasMinR: 0.1         // on ne déplace le stop que s'il avance d'au moins 0,1R
} }];
