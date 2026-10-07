// Analyse d'une recherche du banc d'essai : on retient les configs positives en apprentissage ET en validation (PF >= pfMin, n >= nMin), puis on regarde le test.
// Usage : node backtest/analyse_labo.js <resultats.json> <grille.json> [pfMin] [nMin]
const fs = require('fs');
const [, , fichier, grilleF, pfMin = '1.03', nMin = '300'] = process.argv;
const res = JSON.parse(fs.readFileSync(fichier, 'utf8'));
const grille = Object.fromEntries(JSON.parse(fs.readFileSync(grilleF, 'utf8')).map(function (g) { return [g.nom, g.reglages]; }));
const pf = +pfMin, n0 = +nMin;
const ok = res.filter(function (r) {
  const a = r.res.periodes.apprentissage, v = r.res.periodes.validation;
  return a.n >= n0 && v.n >= n0 * 0.6 && a.pf >= pf && v.pf >= pf;
});
console.log('configs :', res.length, '| retenues (PF app >=', pf, 'et val >=', pf, ', n >=', n0, ') :', ok.length);
const t = res.map(function (r) { return r.res.periodes.test; }).filter(function (x) { return x.n > 100; });
const moy = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0) / a.length; };
console.log('test, toutes configs (n>100) : PF moyen', moy(t, function (x) { return x.pf || 0; }).toFixed(3), '| R moyen par config', moy(t, function (x) { return x.R; }).toFixed(1));
ok.sort(function (a, b) { return Math.min(b.res.periodes.apprentissage.pf, b.res.periodes.validation.pf) - Math.min(a.res.periodes.apprentissage.pf, a.res.periodes.validation.pf); });
const f = function (s) { return (s.n + ' ' + (100 * s.wr).toFixed(0) + '% ' + s.R + 'R PF' + s.pf).padEnd(26); };
for (const r of ok.slice(0, 25)) {
  const p = r.res.periodes;
  console.log(r.nom, '|', f(p.apprentissage), '|', f(p.validation), '| TEST', f(p.test), '| refs', r.res.refs.join(''));
}
if (ok.length) {
  const tt = ok.map(function (r) { return r.res.periodes.test; });
  console.log('\nretenues → test : PF moyen', moy(tt, function (x) { return x.pf || 0; }).toFixed(3), '| positives en test :', tt.filter(function (x) { return x.pf > 1; }).length + '/' + tt.length);
  console.log('\nparamètres de la meilleure :', JSON.stringify(grille[ok[0].nom]));
}
