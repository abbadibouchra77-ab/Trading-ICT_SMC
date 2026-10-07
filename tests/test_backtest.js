// Tests du moteur de backtest : `node tests/test_backtest.js`
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');
const M = require('../src/moteur.js');
const { lireCSV, unitesDeTemps } = require('../backtest/donnees.js');
const { backtesterActif, suivreTrade } = require('../backtest/simulation.js');
const { simulerCompte, stats } = require('../backtest/portefeuille.js');

const T = fs.readFileSync(path.join(__dirname, 'test_moteur.js'), 'utf8');
eval(T.slice(T.indexOf('function histoireAchat'), T.indexOf('function analyser(')));

const resultats = [];
function test(nom, fn) {
  try { fn(); resultats.push('OK    ' + nom); }
  catch (e) { resultats.push('ECHEC ' + nom + '\n      ' + e.message); process.exitCode = 1; }
}
// bougies du scénario au format des données de backtest (temps en ms)
function versMs(b) { return b.map(function (x) { return { time: Date.parse(x.time), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }; }); }
// suite de l'histoire après le signal : chemin de prix (cibles) en bougies M15
function suite(g, cibles) { for (const c of cibles) g.vers(g.P0 + c[0], c[1], 0.2); return g; }
// (entrée de l'histoire vers P0 - 24, stop vers P0 - 72, TP1 vers P0 + 75)
// le trade du setup de l'histoire (le bot tourne 24h/24 : il peut aussi prendre d'autres trades avant)
const FIN_HISTOIRE = (function () { const b = histoireAchat().b; return Date.parse(b[b.length - 1].time); })();
// (un ordre « sur rejet » non rempli peut expirer avant : on prend le premier trade rempli, sinon le dernier)
function tradeHistoire(r) {
  const ts = r.trades.filter(function (t) { return t.tPlace >= FIN_HISTOIRE - 2 * 3600000; });
  return ts.filter(function (t) { return t.statut !== 'expiré'; })[0] || ts[ts.length - 1];
}

test('Lecture CSV (séparateurs, formats d\'heure) et regroupement M1 -> M15', function () {
  const dir = fs.mkdtempSync('/tmp/claude-0/csv-');
  fs.writeFileSync(path.join(dir, 'a.csv'), 'Date;Open;High;Low;Close;Volume\n2024.01.02 07:00;1;2;0.5;1.5;10\n2024.01.02 07:01;1.5;3;1;2;5\n');
  const a = lireCSV(path.join(dir, 'a.csv'));
  assert.strictEqual(a.length, 2);
  assert.strictEqual(a[0].time, Date.parse('2024-01-02T07:00:00Z'));
  fs.writeFileSync(path.join(dir, 'b.csv'), 'timestamp,open,high,low,close,tick_volume\n1704178800,1,2,0.5,1.5,10\n');
  assert.strictEqual(lireCSV(path.join(dir, 'b.csv'))[0].time, Date.parse('2024-01-02T07:00:00Z'));
  const m1 = []; for (let i = 0; i < 60; i++) m1.push({ time: Date.parse('2024-01-02T07:00:00Z') + i * 60000, open: i, high: i + 1, low: i - 1, close: i + 0.5, volume: 1 });
  const ut = unitesDeTemps(m1);
  assert.strictEqual(ut.pasOrigine, 1);
  assert.strictEqual(ut.M15.length, 4);
  assert.deepStrictEqual([ut.M15[1].open, ut.M15[1].high, ut.M15[1].low, ut.M15[1].close, ut.M15[1].volume], [15, 30, 14, 29.5, 15]);
});

test('Trade gagnant : remplissage au FVG, TP1, break-even, TP2', function () {
  const g = suite(histoireAchat(), [[-20, 8], [-26, 4], [0, 8], [40, 16], [80, 40], [110, 60]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  const t = tradeHistoire(r);
  assert.ok(t, JSON.stringify(r.trades.map(function (x) { return x.statut; })));
  assert.strictEqual(t.statut, 'clôturé');
  assert.ok(t.evenements[0].quoi === 'TP1' && t.R > 1, JSON.stringify(t.evenements) + ' R=' + t.R);
});

test('Trade perdant : stop sous le point A (-1R)', function () {
  const g = suite(histoireAchat(), [[-20, 8], [-26, 4], [-50, 8], [-85, 16]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  const t = tradeHistoire(r);
  assert.strictEqual(t.statut, 'clôturé');
  assert.ok(Math.abs(t.R + 1) < 0.05, 'R = ' + t.R);
});

test('Ordre jamais touché : expiré, 0R', function () {
  const g = suite(histoireAchat(), [[5, 8], [10, 30]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  // l'ordre est replacé tant que le setup tient, mais jamais rempli : aucun trade clôturé, 0R
  assert.ok(r.trades.length > 0 && r.trades.every(function (t) { return t.statut !== 'clôturé' && t.R === 0; }), JSON.stringify(r.trades.map(function (t) { return t.statut; })));
});

test('Spread : un achat n\'est rempli que si l\'ask (bid + spread) touche l\'entrée', function () {
  const bs = [{ time: 0, open: 10, high: 10.5, low: 9.95, close: 10.2 }, { time: 900000, open: 10.2, high: 13, low: 10.1, close: 12.9 }];
  const sig = { sens: 'buy', entree: 10, stop: 9, tp1: 12, tp2: null, expireA: new Date(3600000).toISOString() };
  assert.strictEqual(suivreTrade(bs, 0, sig, 0, { dureeMaxJours: 20 }).R, 2);
  assert.notStrictEqual(suivreTrade(bs, 0, sig, 0.1, { dureeMaxJours: 20 }).statut, 'clôturé', 'avec 0,1 de spread, l\'ask (10,05) n\'a jamais touché 10');
});

test('Compte : risque dégressif, 2 pertes par jour, 3 actifs au plus', function () {
  const h = function (j, hh) { return Date.parse('2026-03-0' + j + 'T' + hh + ':00:00Z'); };
  const tr = function (s, j, h1, h2, R) { return { symbole: s, statut: 'clôturé', tPlace: h(j, h1), tFin: h(j, h2), R: R }; };
  const trades = [tr('A', 2, '07', '08', -1), tr('B', 2, '08', '09', -1), tr('C', 2, '10', '11', 3), // 3e refusé : 2 pertes ce jour
    tr('A', 3, '07', '12', 2), tr('B', 3, '07', '12', 2), tr('C', 3, '07', '12', 2), tr('D', 3, '08', '12', 2)]; // D refusé : 3 actifs engagés
  const c = simulerCompte(trades, 10000);
  assert.strictEqual(c.refuses.pertesDuJour, 1);
  assert.strictEqual(c.refuses.tropDActifs, 1);
  assert.strictEqual(c.trades[0].risquePct, 3.5, 'solde 10 000 : 3,5 %');
  assert.strictEqual(c.trades[1].risquePct, 4, 'après une perte, solde < 10 000 : 4 %');
  const s = stats(c.trades);
  assert.strictEqual(s.remplis, 5);
});

console.log(resultats.join('\n'));
