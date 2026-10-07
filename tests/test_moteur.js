// Tests du moteur v2 : `node tests/test_moteur.js`
// Chaque test raconte une histoire de graphique et vérifie la décision du bot.
const assert = require('assert');
const M = require('../src/moteur.js');
const S = require('./scenarios.js');

// ---------- L'histoire d'achat ----------
// Fond haussier ; sommets égaux au-dessus (liquidité) ; baisse sous des creux égaux, mèche qui liquide
// le bas du range (point A) ; impulsion de déplacement qui casse la structure (point B) ; puis retour lent
// vers la décote de la jambe. Le bot place un ordre limite au 50 % du FVG de la jambe, stop sous le point A,
// TP1 sur la liquidité au-dessus (à portée, 2R au moins).
// options : retour (où s'arrête le retour, en points depuis P0), suite (chemin après le retour : [[cible, bougies]])
function histoireAchat(o) {
  o = o || {};
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 1500);
  for (let k = 0; k < 24; k++) g.vers(g.p + 50, 288, 0.8).vers(g.p - 25, 144, 0.8);
  const P0 = g.p + 50; g.vers(P0, 288, 0.8);
  g.vers(P0 + 75, 96, 0.8).vers(P0 + 50, 48, 0.8).vers(P0 + 75, 48, 0.8).vers(P0, 96, 0.8);   // sommets égaux
  g.vers(P0 - 60, 192, 0.8).vers(P0 - 38, 96, 0.8).vers(P0 - 59, 96, 0.8).vers(P0 - 35, 96, 0.8).vers(P0 - 64, 40, 0.8);
  g.ajoute(g.p, g.p + 0.5, P0 - 70, P0 - 63, 600);          // point A : mèche qui liquide le bas du range
  g.vers(P0 + 45, 120, 0.8);                                 // impulsion (déplacement) -> point B
  g.vers(P0 + (o.retour === undefined ? 15 : o.retour), 96, 0.6); // retour lent
  for (const c of (o.suite || [])) g.vers(P0 + c[0], c[1], 0.3);
  g.P0 = P0;
  return g;
}

// (ces histoires testent l'ancienne lecture par scénarios, gardée dans le moteur : strategie 'lecture')
function analyser(bougies, etat, options, correle) {
  options = Object.assign({}, options || {}); options.reglages = Object.assign({ strategie: 'lecture' }, options.reglages || {});
  return M.analyserActif('TEST', S.versBridge(bougies), correle ? { M15: correle.slice(-500) } : null, S.maintenantApres(bougies), etat || {}, options);
}

const resultats = [];
function test(nom, fn) {
  try { fn(); resultats.push('OK    ' + nom); }
  catch (e) { resultats.push('ECHEC ' + nom + '\n      ' + e.message); process.exitCode = 1; }
}

test('Setup d\'achat : ordre limite au FVG de la jambe, stop sous le point A, TP1 à portée', function () {
  const g = histoireAchat();
  const r = analyser(g.b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.strictEqual(r.sens, 'buy');
  assert.ok(/FVG .* de la jambe|OTE de la jambe/.test(r.typeEntree), r.typeEntree);
  assert.ok(r.entree < g.P0 + 15 && r.entree < g.P0 - 70 + 0.5 * 115, 'entrée dans la décote de la jambe : ' + r.entree);
  assert.ok(r.stop < g.P0 - 70, 'stop sous le point A : ' + r.stop);
  assert.ok(r.rr1 >= 2 && r.tp1 <= r.entree + 1.5 * 115 + 1e-6, 'TP1 à 2R au moins et à portée : ' + r.tp1 + ' (' + r.rr1 + 'R)');
  console.log('\n--- Lecture du bot (achat) ---\n' + r.lecture + '\n  ' + r.confirmations.join('\n  ') + '\n');
});

test('Une vraie cassure (le prix s\'installe sous le niveau) n\'est pas un grab', function () {
  const t0 = Date.parse('2026-01-05T00:00:00Z');
  const bs = []; for (let i = 0; i < 30; i++) bs.push({ t: t0 + i * 900000, o: 100, h: 100.5, l: 99.5, c: 100, v: 0 });
  [[100, 100.2, 98.8, 99.0], [99.0, 99.2, 98.5, 98.7], [98.7, 98.9, 98.3, 98.5], [98.5, 98.8, 98.2, 98.4], [98.4, 99.8, 98.3, 99.7]]
    .forEach(function (x, k) { bs.push({ t: t0 + (30 + k) * 900000, o: x[0], h: x[1], l: x[2], c: x[3], v: 0 }); });
  const niv = [{ p: 99.5, cote: 'L', genre: 'creux égaux', ut: 'M15', t0: t0, touches: 2, ligne: null }];
  assert.strictEqual(M.balayagesBas(bs, niv, 1, 30).length, 0, '4 clôtures sous le niveau : acceptation, pas un piège');
});

test('Inducement et OB + FVG superposés', function () {
  const t0 = Date.parse('2026-01-05T00:00:00Z');
  const px = [10, 9, 8, 9, 10, 9, 7.5, 8.5, 9, 8, 6, 5, 7, 8];
  const bs = px.map(function (c, i) { return { t: t0 + i * 900000, o: c, h: c + 0.3, l: c - 0.3, c: c, v: 0 }; });
  const idm = M.inducement(bs, 11, 4.7, 1);
  assert.ok(idm && Math.abs(idm.p - 7.2) < 1e-9, 'inducement trouvé : ' + JSON.stringify(idm));
  assert.strictEqual(M.obEtFvgSuperposes([{ type: 'OB', ut: 'H4', bas: 10, haut: 12 }, { type: 'FVG', ut: 'H4', bas: 11, haut: 13 }]), 'OB H4 + FVG H4');
  assert.strictEqual(M.obEtFvgSuperposes([{ type: 'OB', ut: 'H4', bas: 10, haut: 12 }, { type: 'FVG', ut: 'H4', bas: 12.5, haut: 13 }]), null);
});

test('Le même graphique retourné : vente symétrique', function () {
  const g = histoireAchat();
  const rA = analyser(g.b);
  const r = analyser(S.inverser(g.b, 5000));
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.strictEqual(r.sens, 'sell');
  assert.ok(Math.abs(r.entree - (5000 - rA.entree)) < 1e-6 && Math.abs(r.stop - (5000 - rA.stop)) < 1e-6);
});

test('Entrée déjà touchée : on ne court pas après le prix', function () {
  const r = analyser(histoireAchat({ suite: [[-40, 24], [0, 24]] }).b);
  assert.strictEqual(r.action, 'attendre');
  assert.ok(/déjà revenu sur l'entrée/.test(r.raison), r.raison);
});

test('24h/24 : ordre placé hors killzone, valable 4 h', function () {
  const b = histoireAchat().b;
  const r = analyser(b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.ok(Math.abs((Date.parse(r.expireA) - S.maintenantApres(b)) / 3600000 - 4) < 0.01);
});

test('Mouvement déjà tradé : pas de nouveau trade', function () {
  const g = histoireAchat();
  const r1 = analyser(g.b);
  const r2 = analyser(g.b, { legsDejaTradees: [r1.cleMouvement] });
  assert.ok(r2.action === 'attendre' || r2.cleMouvement !== r1.cleMouvement, 'le même contexte n\'est pas retradé');
});

test('Structure externe : un creux interne cassé n\'est pas un BOS, le strong low cassé est un CHoCH', function () {
  const t0 = Date.parse('2026-01-05T00:00:00Z');
  // hausse : creux 100, sommet 110, creux 104 (strong low), sommet 116 (BOS), creux interne 112, sommet 115
  const px = [100, 103, 106, 110, 107, 104, 108, 112, 116, 114, 112, 113, 115, 113.5];
  const mk = function (arr) { return arr.map(function (c, i) { return { t: t0 + i * 3600000, o: c, h: c + 0.4, l: c - 0.4, c: c, v: 0 }; }); };
  let ev = M.structureSwing(mk(px.concat([111.5]))).evts;
  assert.ok(!ev.some(function (e) { return e.dir === -1; }), 'clôture sous le creux interne 112 : pas de cassure baissière');
  ev = M.structureSwing(mk(px.concat([111.5, 106, 103]))).evts;
  assert.ok(ev.some(function (e) { return e.dir === -1 && e.type === 'CHoCH'; }), 'clôture sous le strong low : CHoCH baissier');
});

// ---------- Stratégie AMD ----------
// bougies M15 : range de 40 bougies entre 100 et 102, puis la suite donnée
function grapheAMD(suite) {
  // range : vagues de 8 bougies entre 100 et 102 (5 allers-retours)
  const t0 = Date.parse('2026-01-05T00:00:00Z'), bs = [];
  const vague = [100.2, 100.7, 101.2, 101.7, 101.9, 101.4, 100.9, 100.4];
  let o = 100.2;
  for (let i = 0; i < 48; i++) { const c = vague[i % 8]; bs.push({ t: t0 + i * 900000, o: o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c: c, v: 100 }); o = c; }
  suite.forEach(function (x, k) { bs.push({ t: t0 + (48 + k) * 900000, o: x[0], h: x[1], l: x[2], c: x[3], v: x[4] || 100 }); });
  return bs;
}
test('AMD : mèche(s) sous le range puis déplacement haussier avec volume = manipulation + distribution', function () {
  const bs = grapheAMD([[100.4, 100.6, 99.2, 100.3], [100.3, 100.5, 99.3, 100.2], [100.2, 102.4, 100.1, 102.3, 300], [102.3, 102.9, 102.6, 102.8]]);
  const e = M.amdAchat(bs, 'M15', 1, 10);
  assert.ok(e.length && e[0].cas === 'manipulation' && e[0].nbMeches === 2, JSON.stringify(e.map(function (x) { return x.cas + x.nbMeches; })));
  assert.ok(Math.abs(e[0].extreme - 99.2) < 1e-9, 'stop de référence : la plus basse des mèches');
});
test('AMD : cassure franche du haut du range par une bougie pleine = continuation', function () {
  const bs = grapheAMD([[100.4, 102.7, 100.3, 102.6], [102.6, 102.9, 102.5, 102.8]]);
  const e = M.amdAchat(bs, 'M15', 1, 10);
  assert.ok(e.length && e[0].cas === 'cassure', JSON.stringify(e.map(function (x) { return x.cas; })));
});
test('AMD : une mèche sous le range sans déplacement ni volume n\'est pas une AMD', function () {
  const bs = grapheAMD([[100.4, 100.6, 99.2, 100.3], [100.3, 100.9, 100.2, 100.8], [100.8, 101.0, 100.6, 100.9]]);
  assert.ok(!M.amdAchat(bs, 'M15', 1, 10).some(function (x) { return x.cas === 'manipulation'; }));
});

test('Range : pas de trade dedans', function () {
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 2000);
  for (let k = 0; k < 120; k++) g.vers(2000 + (k % 2 ? 15 : -15), 96, 1.2);
  assert.strictEqual(analyser(g.b).action, 'attendre');
});

test('Bougie en cours ignorée : seules les bougies clôturées comptent', function () {
  const b = histoireAchat().b;
  // « maintenant » tombe au milieu de la dernière bougie : même décision que sans cette bougie
  const enCours = M.analyserActif('TEST', S.versBridge(b), null, Date.parse(b[b.length - 1].time) + 5 * 60000, {}, { reglages: { strategie: 'lecture' } });
  const sansElle = analyser(b.slice(0, -1));
  assert.strictEqual(enCours.action, sansElle.action);
  assert.strictEqual(enCours.entree, sansElle.entree);
});

test('Définitions : FVG, OB, IFVG, breaker, BPR', function () {
  const t0 = Date.parse('2026-01-05T00:00:00Z');
  const mk = function (arr) { return arr.map(function (x, i) { return { t: t0 + i * 900000, o: x[0], h: x[1], l: x[2], c: x[3], v: 0 }; }); };
  const base = []; for (let i = 0; i < 20; i++) base.push([100, 100.5, 99.5, 100]);
  const jambe = [[100, 100.2, 99, 99.2], [99.2, 101.5, 99.1, 101.4], [101.4, 103.5, 101.3, 103.3], [103.3, 104, 103, 103.8]];
  let z = M.zones(mk(base.concat(jambe)), 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'FVG' && x.role === 'achat'; }), 'FVG haussier');
  assert.ok(z.some(function (x) { return x.type === 'OB' && x.role === 'achat' && x.bas === 99 && x.haut === 100.2; }), 'OB = dernière bougie baissière');
  z = M.zones(mk(base.concat(jambe, [[103.8, 103.9, 98.8, 99.5]])), 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'OB' && x.role === 'achat'; }), 'une mèche n\'invalide pas l\'OB');
  z = M.zones(mk(base.concat(jambe, [[103.8, 103.9, 98.5, 98.7]])), 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'Breaker' && x.role === 'vente'; }), 'clôture au-delà : breaker');
  assert.ok(z.some(function (x) { return x.type === 'IFVG' && x.role === 'vente'; }), 'clôture au-delà : IFVG');
  // BPR : FVG baissier puis FVG haussier qui se chevauchent
  z = M.zones(mk(base.concat([[100, 100.1, 99.8, 99.9], [99.9, 99.9, 97, 97.2], [97.2, 99.0, 96.8, 98.8], [98.8, 102, 98.7, 101.8], [101.8, 102.2, 99.6, 101.9]])), 'M15', 0);
  assert.ok(z.some(function (x) { return x.type === 'BPR'; }), 'BPR');
});

test('Heure de New York et sessions', function () {
  assert.strictEqual(M.ny(Date.parse('2026-08-10T07:00:00Z')).hm, 300);  // été : UTC-4
  assert.strictEqual(M.ny(Date.parse('2026-12-10T07:00:00Z')).hm, 200);  // hiver : UTC-5
});

console.log(resultats.join('\n'));
