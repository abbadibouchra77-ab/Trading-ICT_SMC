// Tests du moteur : `node tests/test_moteur.js`
// Chaque test raconte une histoire de graphique et vérifie la décision du bot.
const assert = require('assert');
const M = require('../src/moteur.js');
const S = require('./scenarios.js');

// ---------- Histoire 1 : le setup d'achat complet ----------
// Tendance de fond haussière, retour sous des creux égaux H4, balayage (point A),
// impulsion qui casse la structure (point B), retour dans l'OTE H4, puis en M15 :
// balayage de creux égaux, MSS, retour à 0,5 dans un FVG, rebond -> achat.
function histoireAchat(options) {
  options = options || {};
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 1500);
  // 1) fond haussier sur ~110 jours : montées de 50, baisses de 25
  for (let k = 0; k < 24; k++) g.vers(g.p + 50, 288, 0.8).vers(g.p - 25, 144, 0.8);
  const P0 = g.p + 50; g.vers(P0, 288, 0.8);
  // 2) retour H4 : creux égaux vers P0-60, puis balayage (point A)
  g.vers(P0 - 60, 192, 0.8).vers(P0 - 38, 96, 0.8).vers(P0 - 59, 96, 0.8).vers(P0 - 35, 96, 0.8).vers(P0 - 64, 40, 0.8);
  g.ajoute(g.p, g.p + 0.5, P0 - 70, P0 - 63, 600);
  // 3) impulsion qui casse le dernier sommet (BOS) jusqu'au point B
  g.vers(P0 + 45, 240, 0.8);
  // 4) retour en M15 vers la zone d'achat H4, avec des creux égaux à P0-20
  g.vers(P0 + 10, 96, 0.6).vers(P0 + 15, 24, 0.6).vers(P0 - 14, 48, 0.6).vers(P0 - 20, 12, 0.4).vers(P0 - 12, 10, 0.4)
    .vers(P0 - 20, 10, 0.4).vers(P0 - 12, 10, 0.4).vers(P0 - 20, 8, 0.3);
  if (options.sansBalayage) return g;
  // 5) le balayage M15 : mèche sous les creux égaux, clôture au-dessus
  g.ajoute(P0 - 20, P0 - 19.5, P0 - 27, P0 - 19, 900);
  // 6) MSS : déplacement haussier qui laisse un FVG
  g.ajoute(P0 - 19, P0 - 14.8, P0 - 19.3, P0 - 15, 500);
  g.ajoute(P0 - 15, P0 - 8.5, P0 - 15.2, P0 - 9, 800);
  g.ajoute(P0 - 9, P0 - 5.5, P0 - 9.5, P0 - 6, 400);
  g.ajoute(P0 - 6, P0 - 0.8, P0 - 6.6, P0 - 1.2, 300);
  // 7) retour vers 0,5 du Fibonacci M15, dans le FVG
  g.ajoute(P0 - 1.2, P0 - 1, P0 - 4, P0 - 3.6, 150);
  g.ajoute(P0 - 3.6, P0 - 3.4, P0 - 8, P0 - 7.6, 150);
  g.ajoute(P0 - 7.6, P0 - 7.4, P0 - 12, P0 - 11.6, 150);
  g.ajoute(P0 - 11.6, P0 - 11.4, P0 - 15, P0 - 14.2, 150);
  if (options.sansRebond) return g;
  // 8) le rebond
  g.ajoute(P0 - 14.2, P0 - 9.8, P0 - 14.4, P0 - 10, 300);
  return g;
}

function analyser(bougies, etat) {
  return M.analyserActif('TEST', S.versBridge(bougies), S.maintenantApres(bougies), etat || {});
}

const resultats = [];
function test(nom, fn) {
  try { fn(); resultats.push('OK    ' + nom); }
  catch (e) { resultats.push('ECHEC ' + nom + '\n      ' + e.message); process.exitCode = 1; }
}

test('Achat complet : le bot achète', function () {
  const r = analyser(histoireAchat().b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.strictEqual(r.sens, 'buy');
  assert.ok(r.stop < r.entree && r.tp1 > r.entree, 'stop sous l\'entrée, objectif au-dessus');
  assert.ok(r.rr1 >= 2, 'au moins 2R');
  console.log('\n--- Lecture du bot (achat) ---\n' + r.lecture + '\nConfirmations : ' + r.confirmations.join(' ; ') + '\n');
});

test('Le même graphique à l\'envers : le bot vend (symétrie parfaite)', function () {
  const g = histoireAchat();
  const K = 5000;
  const r = analyser(S.inverser(g.b, K));
  const rA = analyser(g.b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.strictEqual(r.sens, 'sell');
  assert.ok(Math.abs(r.entree - (K - rA.entree)) < 1e-6, 'entrée miroir');
  assert.ok(Math.abs(r.stop - (K - rA.stop)) < 1e-6, 'stop miroir');
  assert.ok(r.stop > r.entree && r.tp1 < r.entree);
});

test('Avant le rebond : on attend', function () {
  const r = analyser(histoireAchat({ sansRebond: true }).b);
  assert.strictEqual(r.action, 'attendre');
});

test('Avant la vraie prise de liquidité : on n\'entre pas', function () {
  const r = analyser(histoireAchat({ sansBalayage: true }).b);
  assert.strictEqual(r.action, 'attendre');
  assert.ok(!/Achat : Données/.test(r.raison), r.raison);
});

test('Mouvement déjà tradé (même point A) : pas de nouveau trade', function () {
  const g = histoireAchat();
  const r1 = analyser(g.b);
  const r2 = analyser(g.b, { legsDejaTradees: [r1.cleMouvement] });
  assert.strictEqual(r2.action, 'attendre');
  assert.ok(/déjà été tradé/.test(r2.raison), r2.raison);
});

test('Range : pas de trade dedans', function () {
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 2000);
  for (let k = 0; k < 120; k++) g.vers(2000 + (k % 2 ? 15 : -15), 96, 1.2);
  const r = analyser(g.b);
  assert.strictEqual(r.action, 'attendre');
});

test('Bougie en cours ignorée : seules les bougies clôturées comptent', function () {
  const g = histoireAchat();
  const b = g.b;
  // « maintenant » tombe au milieu de la dernière bougie : elle n'est pas clôturée
  const maintenant = Date.parse(b[b.length - 1].time) + 5 * 60000;
  const r = M.analyserActif('TEST', S.versBridge(b), maintenant, {});
  assert.strictEqual(r.action, 'attendre');
});

test('Définitions : FVG, OB, IFVG, breaker', function () {
  const t0 = Date.parse('2026-01-05T00:00:00Z');
  const mk = function (arr) { return arr.map(function (x, i) { return { t: t0 + i * 900000, o: x[0], h: x[1], l: x[2], c: x[3], v: 0 }; }); };
  // 20 bougies calmes, puis bougie baissière (OB), puis déplacement haussier avec FVG
  const base = []; for (let i = 0; i < 20; i++) base.push([100, 100.5, 99.5, 100]);
  let bs = mk(base.concat([[100, 100.2, 99, 99.2], [99.2, 101.5, 99.1, 101.4], [101.4, 103.5, 101.3, 103.3], [103.3, 104, 103, 103.8]]));
  let z = M.zones(bs, 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'FVG' && x.role === 'achat'; }), 'FVG haussier trouvé');
  assert.ok(z.some(function (x) { return x.type === 'OB' && x.role === 'achat' && x.bas === 99 && x.haut === 100.2; }), 'OB haussier = dernière bougie baissière');
  // une mèche sous l'OB ne l'invalide pas
  bs = mk(base.concat([[100, 100.2, 99, 99.2], [99.2, 101.5, 99.1, 101.4], [101.4, 103.5, 101.3, 103.3], [103.3, 104, 103, 103.8], [103.8, 103.9, 98.8, 99.5]]));
  z = M.zones(bs, 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'OB' && x.role === 'achat'; }), 'mèche : OB toujours valide');
  // une clôture sous l'OB le transforme en breaker (résistance)
  bs = mk(base.concat([[100, 100.2, 99, 99.2], [99.2, 101.5, 99.1, 101.4], [101.4, 103.5, 101.3, 103.3], [103.3, 104, 103, 103.8], [103.8, 103.9, 98.5, 98.7]]));
  z = M.zones(bs, 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'Breaker' && x.role === 'vente'; }), 'clôture au-delà : breaker');
  assert.ok(z.some(function (x) { return x.type === 'IFVG' && x.role === 'vente'; }), 'FVG clôturé au-delà : IFVG');
});

console.log(resultats.join('\n'));
