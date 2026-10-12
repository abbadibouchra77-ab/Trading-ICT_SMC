// Vérifie le détecteur de la stratégie « englobante avec prise de liquidité dans une zone POI ».
const assert = require('assert');
const e = require('../backtest/englobante.js');

function b(t, o, h, l, c) { return { t: t, o: o, h: h, l: l, c: c, v: 1 }; }
// 20 bougies calmes, une impulsion haussière qui laisse un FVG [101, 103], puis un retour dans le FVG :
// la bougie précédente (q-1) et l'englobante q qui passe sous son plus bas et clôture au-dessus de son plus haut.
function graphique(englobe) {
  const bs = [];
  for (let i = 0; i < 20; i++) bs.push(b(i, 100, 101, 99, 100.2));
  bs.push(b(20, 100.2, 101, 99.8, 100.8));   // i-2 : plus haut 101
  bs.push(b(21, 100.8, 106, 100.7, 105.8));  // déplacement
  bs.push(b(22, 105.8, 107, 103, 106.5));    // i : plus bas 103 -> FVG [101, 103]
  bs.push(b(23, 106.5, 106.6, 104, 104.2));
  bs.push(b(24, 104.2, 104.5, 102.6, 102.8)); // q-1 : plus bas 102.6, plus haut 104.5
  bs.push(englobe);                           // q
  return bs;
}

// 1. Prise du plus bas précédent (102.2 < 102.6), dans le FVG, clôture au-dessus du plus haut (104.8 > 104.5) : signal
let s = e.signauxAchat(graphique(b(25, 102.8, 105, 102.2, 104.8)), function () { return 1; }, e.DEFAUT);
assert.strictEqual(s.length, 1);
assert.strictEqual(s[0].q, 25);
assert.strictEqual(s[0].zone.type, 'FVG');

// 2. Même bougie mais direction de l'unité supérieure baissière : pas de signal
s = e.signauxAchat(graphique(b(25, 102.8, 105, 102.2, 104.8)), function () { return -1; }, e.DEFAUT);
assert.strictEqual(s.length, 0);

// 3. Pas de prise de liquidité (plus bas 102.7 > 102.6) : pas de signal
s = e.signauxAchat(graphique(b(25, 102.8, 105, 102.7, 104.8)), function () { return 1; }, e.DEFAUT);
assert.strictEqual(s.length, 0);

// 4. Pas d'englobante (clôture 104.3 sous le plus haut 104.5) : pas de signal ; mais oui en variante « corps »
s = e.signauxAchat(graphique(b(25, 102.8, 104.4, 102.2, 104.3)), function () { return 1; }, e.DEFAUT);
assert.strictEqual(s.length, 0);
s = e.signauxAchat(graphique(b(25, 102.8, 104.4, 102.2, 104.3)), function () { return 1; }, Object.assign({}, e.DEFAUT, { englobe: 'corps' }));
assert.strictEqual(s.length, 1);

// 5. Suivi : achat à 100, stop 99, objectif 102 ; le stop est compté en premier si les deux sont dans la même bougie
const M15 = [{ time: 0, open: 100, high: 101, low: 99.5, close: 100.5 }, { time: 1, open: 100.5, high: 102.1, low: 100.2, close: 102 }];
assert.strictEqual(e.suivre(M15, 0, 1, 100, 99, 102, 0, 20).R, 2);
const M15b = [{ time: 0, open: 100, high: 102.5, low: 98.5, close: 100 }];
assert.strictEqual(e.suivre(M15b, 0, 1, 100, 99, 102, 0, 20).R, -1);

console.log('test_englobante : OK');
