// Réglages du bot SMC Vision. COMPTE DÉMO UNIQUEMENT (bridge Fusion Markets cTrader démo).
// Tu peux modifier ces valeurs ici.
return [{ json: {
  bridgeUrl: 'http://ctrader-bridge:8080',
  // Risque par trade dégressif selon le solde (accord écrit de Bouchra du 06/10/2026, compte DÉMO) :
  // solde en dessous de 'jusqu_a' -> risque en % du solde. Au-delà du dernier palier : 1 %.
  paliersRisque: [
    { jusqu_a: 7500, risque: 5 },
    { jusqu_a: 10000, risque: 4 },
    { jusqu_a: 15000, risque: 3.5 },
    { jusqu_a: 20000, risque: 3 },
    { jusqu_a: 30000, risque: 2.5 },
    { jusqu_a: 50000, risque: 2 },
    { jusqu_a: 100000, risque: 1.5 }
  ],
  risqueAuDela: 1,       // 100 000 et plus : 1 %
  rrMin: 2,              // objectif minimum : 2R
  maxPertesJour: 2,      // au plus 2 pertes par jour (jour de Paris)
  maxPositionsBot: 3,    // sécurité : au plus 3 trades SMC Vision ouverts en même temps
  commentaire: 'SMC-Vision',
  // devise = monnaie de cotation du prix (pour convertir le risque en dollars)
  actifs: [
    { symbol: 'XAUUSD', nom: 'Or', devise: 'USD' },
    { symbol: 'XAGUSD', nom: 'Argent', devise: 'USD' },
    { symbol: 'US TECH 100', nom: 'NAS100', devise: 'USD' },
    { symbol: 'US 500', nom: 'US500', devise: 'USD' },
    { symbol: 'US 30', nom: 'US30', devise: 'USD' },          // nom broker à vérifier
    { symbol: 'GERMANY 40', nom: 'GER40', devise: 'EUR' },
    { symbol: 'XTIUSD', nom: 'USOIL', devise: 'USD' },        // nom broker à vérifier
    { symbol: 'EURUSD', nom: 'EURUSD', devise: 'USD' },
    { symbol: 'GBPUSD', nom: 'GBPUSD', devise: 'USD' },
    { symbol: 'USDJPY', nom: 'USDJPY', devise: 'JPY' },
    { symbol: 'AUDUSD', nom: 'AUDUSD', devise: 'USD' },
    { symbol: 'BTCUSD', nom: 'BTCUSD', devise: 'USD' },
    { symbol: 'ETHUSD', nom: 'ETHUSD', devise: 'USD' }
  ]
} }];
