// Tests du moteur de backtest : `node tests/test_backtest.js`
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');
const M = require('../src/moteur.js');
const { lireCSV, unitesDeTemps } = require('../backtest/donnees.js');
const { backtesterActif, suivreTrade, preFiltre } = require('../backtest/simulation.js');
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
  const g = suite(histoireAchat(), [[-15, 1], [-17.4, 1], [-5, 6], [14, 12], [30, 16], [80, 60]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  assert.strictEqual(r.trades.length, 1, JSON.stringify(r.trades.map(function (t) { return t.statut; })));
  const t = r.trades[0];
  assert.strictEqual(t.statut, 'clôturé');
  assert.ok(t.evenements[0].quoi === 'TP1' && t.R > 1, JSON.stringify(t.evenements) + ' R=' + t.R);
});

test('Trade perdant : stop derrière la mèche du balayage (-1R)', function () {
  const g = suite(histoireAchat(), [[-15, 1], [-17.4, 1], [-25, 4], [-40, 8]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  const t = r.trades[0];
  assert.strictEqual(t.statut, 'clôturé');
  assert.ok(Math.abs(t.R + 1) < 0.05, 'R = ' + t.R);
});

test('Ordre jamais touché : expiré à la fin de la killzone, 0R', function () {
  const g = suite(histoireAchat(), [[0, 8], [10, 30]]);
  const r = backtesterActif({ symbol: 'TEST' }, versMs(g.b), null, { spread: 0, depuis: '2026-09-01' });
  assert.strictEqual(r.trades[0].statut, 'expiré');
  assert.strictEqual(r.trades[0].R, 0);
});

test('Spread : un achat n\'est rempli que si l\'ask (bid + spread) touche l\'entrée', function () {
  const bs = [{ time: 0, open: 10, high: 10.5, low: 9.95, close: 10.2 }, { time: 900000, open: 10.2, high: 13, low: 10.1, close: 12.9 }];
  const sig = { sens: 'buy', entree: 10, stop: 9, tp1: 12, tp2: null, expireA: new Date(3600000).toISOString() };
  assert.strictEqual(suivreTrade(bs, 0, sig, 0, { dureeMaxJours: 20 }).R, 2);
  assert.notStrictEqual(suivreTrade(bs, 0, sig, 0.1, { dureeMaxJours: 20 }).statut, 'clôturé', 'avec 0,1 de spread, l\'ask (10,05) n\'a jamais touché 10');
});

test('Pré-filtre : il ne retire jamais une bougie où le moteur aurait tradé', function () {
  // sur l'histoire d'achat (et sa version vente), toutes les bougies écartées donnent « attendre »
  [histoireAchat().b, S.inverser(histoireAchat().b, 5000)].forEach(function (b) {
    const bs = versMs(b), ut = unitesDeTemps(bs);
    let verifiees = 0;
    for (let n = bs.length - 160; n <= bs.length; n++) {
      const maintenant = bs[n - 1].time + 16 * 60000;
      let atr = 0, k = 0; for (let i = n - 14; i < n; i++) { atr += Math.max(bs[i].high - bs[i].low, Math.abs(bs[i].high - bs[i - 1].close), Math.abs(bs[i].low - bs[i - 1].close)); k++; }
      if (preFiltre(bs, n, atr / k, false, maintenant)) continue;
      const f = {}; ['M15', 'H1', 'H4', 'D1', 'W1', 'MN'].forEach(function (u) { f[u] = ut[u].filter(function (x) { return x.time < maintenant; }).slice(-500); });
      assert.notStrictEqual(M.analyserActif('T', f, null, maintenant, {}, {}).action, 'trader', 'bougie ' + n + ' écartée à tort');
      verifiees++;
    }
    assert.ok(verifiees > 50, 'assez de bougies vérifiées (' + verifiees + ')');
  });
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
