// Tests du moteur v2 : `node tests/test_moteur.js`
// Chaque test raconte une histoire de graphique et vérifie la décision du bot.
const assert = require('assert');
const M = require('../src/moteur.js');
const S = require('./scenarios.js');

// ---------- Histoire 1 : le setup A++ d'achat ----------
// Fond haussier ; retour H4 sous des creux égaux, balayage (point A) ; impulsion qui casse la
// structure (point B) ; retour dans l'OTE H4. La nuit, l'Asie forme un range avec des creux égaux.
// En killzone de Londres : balayage de l'Asie (Judas swing) sous l'ouverture de minuit,
// MSS avec déplacement et volume, FVG M15 -> ordre limite au 50 % du FVG.
// options : heureBalayage (heure UTC), sansBalayage, entreeTouchee
function histoireAchat(o) {
  o = o || {};
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 1500);
  for (let k = 0; k < 24; k++) g.vers(g.p + 50, 288, 0.8).vers(g.p - 25, 144, 0.8);
  const P0 = g.p + 50; g.vers(P0, 288, 0.8);
  g.vers(P0 - 60, 192, 0.8).vers(P0 - 38, 96, 0.8).vers(P0 - 59, 96, 0.8).vers(P0 - 35, 96, 0.8).vers(P0 - 64, 40, 0.8);
  g.ajoute(g.p, g.p + 0.5, P0 - 70, P0 - 63, 600);          // point A : balayage H4
  g.vers(P0 + 45, 120, 0.8);                                 // impulsion (déplacement) -> point B
  g.vers(P0 + 10, 96, 0.6).vers(P0 + 15, 24, 0.6).vers(P0 - 14, 120, 0.6); // retracement lent (correction, pas un déplacement)
  const hB = o.heureBalayage === undefined ? 6 : o.heureBalayage; // 06h UTC = 02h New York (été)
  g.jusquA((hB + 24 - 6) % 24, 0.4);                         // calme jusqu'à 6 h avant le balayage
  // range (Asie si balayage à 6 h UTC) avec creux égaux à P0-20
  g.vers(P0 - 20, 4, 0.3).vers(P0 - 12, 4, 0.3).vers(P0 - 20, 4, 0.3).vers(P0 - 12, 4, 0.3);
  g.vers(P0 - 16, 4, 0.3).vers(P0 - 12, 4, 0.3).vers(P0 - 17, 2, 0.3).vers(P0 - 19.5, 2, 0.2);
  if (o.sansBalayage) return g;
  if (o.grab) {
    // liquidity grab : clôture SOUS les creux égaux (fausse cassure), puis reprise du niveau
    g.ajoute(P0 - 19.5, P0 - 19.4, P0 - 23, P0 - 22, 700);
    g.ajoute(P0 - 22, P0 - 18.8, P0 - 27, P0 - 19, 900);
  } else g.ajoute(P0 - 19.5, P0 - 19.2, P0 - 27, P0 - 19, 900);     // balayage : grande mèche, clôture au-dessus
  g.ajoute(P0 - 19, P0 - 14.8, P0 - 19.3, P0 - 15, 500);     // déplacement...
  g.ajoute(P0 - 15, P0 - 8.5, P0 - 15.2, P0 - 9, 800);       // ... MSS (clôture au-dessus du sommet)
  g.ajoute(P0 - 9, P0 - 5.5, P0 - 9.5, P0 - 6, 400);         // FVG du déplacement : entre -19 et -15,2
  g.ajoute(P0 - 6, P0 - 4.8, P0 - 6.6, P0 - 5.2, 300);
  if (o.entreeTouchee) g.ajoute(P0 - 5.2, P0 - 5, P0 - 18, P0 - 11, 300);
  g.P0 = P0;
  return g;
}

function analyser(bougies, etat, options, correle) {
  return M.analyserActif('TEST', S.versBridge(bougies), correle ? { M15: correle.slice(-500) } : null, S.maintenantApres(bougies), etat || {}, options || {});
}

const resultats = [];
function test(nom, fn) {
  try { fn(); resultats.push('OK    ' + nom); }
  catch (e) { resultats.push('ECHEC ' + nom + '\n      ' + e.message); process.exitCode = 1; }
}

test('Setup A++ d\'achat : ordre limite au FVG', function () {
  const g = histoireAchat();
  const r = analyser(g.b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.strictEqual(r.sens, 'buy');
  assert.ok(Math.abs(r.entree - (g.P0 - 17.1)) < 0.01, 'entrée au 50 % du FVG du déplacement : ' + r.entree);
  assert.ok(r.stop < g.P0 - 27, 'stop sous la mèche du balayage');
  assert.ok(r.rr1 >= 2 && r.tp1 > r.entree);
  assert.strictEqual(r.killzone, 'Londres');
  assert.strictEqual(M.ny(Date.parse(r.expireA)).hm, 500, 'l\'ordre expire à la fin de la killzone de Londres (05h NY)');
  console.log('\n--- Lecture du bot (achat) ---\n' + r.lecture + '\nNote : ' + r.note + '\n  ' + r.confirmations.join('\n  ') + '\n');
});

test('Liquidity grab (clôture sous le niveau puis reprise) : reconnu comme prise de liquidité', function () {
  const r = analyser(histoireAchat({ grab: true }).b);
  assert.strictEqual(r.action, 'trader', r.raison);
  assert.ok(r.confirmations.some(function (x) { return /liquidity grab/.test(x); }), r.confirmations.join(' | '));
  assert.ok(r.stop < histoireAchat().P0 - 27, 'stop sous le plus bas du grab');
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
  // creux interne à 7,2 (bougie 6) pris par la bougie 10, avant le vrai balayage à 4,7 (bougie 11)
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
  assert.strictEqual(r.note, rA.note);
});

test('Avant le balayage : la Smart Money n\'a pas pris la liquidité, on attend', function () {
  const r = analyser(histoireAchat({ sansBalayage: true }).b);
  assert.strictEqual(r.action, 'attendre');
});

test('Entrée déjà touchée : on ne court pas après le prix', function () {
  const r = analyser(histoireAchat({ entreeTouchee: true }).b);
  assert.strictEqual(r.action, 'attendre');
  assert.ok(/déjà revenu sur l'entrée/.test(r.raison), r.raison);
});

test('Hors killzone : pas d\'ordre (forex / indices / métaux)', function () {
  const r = analyser(histoireAchat({ heureBalayage: 17 }).b); // 17h UTC = 13h New York
  assert.strictEqual(r.action, 'attendre');
  assert.ok(/hors killzone/.test(r.raison), r.raison);
});

test('Crypto : 24h/24, même hors killzone', function () {
  const r = analyser(histoireAchat({ heureBalayage: 17 }).b, {}, { crypto: true });
  assert.strictEqual(r.action, 'trader', r.raison);
});

test('SMT : l\'actif corrélé ne fait pas de plus bas -> points en plus', function () {
  const g = histoireAchat();
  const sans = analyser(g.b);
  // actif corrélé : mêmes bougies, mais sa mèche de balayage reste au-dessus du creux précédent
  const c = g.b.map(function (b) { return Object.assign({}, b); });
  const k = c.length - 5;
  c[k].low = g.P0 - 19.4; c[k].close = g.P0 - 19;
  const avec = analyser(g.b, {}, { correle: 'CORR' }, c);
  assert.ok(avec.confirmations.some(function (x) { return /SMT/.test(x); }), avec.confirmations.join(' | '));
  assert.strictEqual(avec.note, sans.note + 2);
});

test('Mouvement déjà tradé (même point A H4) : pas de nouveau trade', function () {
  const g = histoireAchat();
  const r1 = analyser(g.b);
  const r2 = analyser(g.b, { legsDejaTradees: [r1.cleMouvement] });
  assert.strictEqual(r2.action, 'attendre');
  assert.ok(/déjà été tradé/.test(r2.raison), r2.raison);
  // la même réaction M15 lue depuis un autre contexte (H1) n'est pas retradée non plus
  assert.ok(!/H1\|[^|]*\|[0-9]+\|buy -> /.test(r2.raison));
});

test('Histoire complète tendance H4 + réaction M15 : setup A+++', function () {
  const r = analyser(histoireAchat().b);
  assert.strictEqual(r.grade, 'A+++', r.scenario + ' / ' + r.confirmations.join(' | '));
  assert.ok(/tendance H4/.test(r.scenario), r.scenario);
});

test('Range : pas de trade dedans', function () {
  const g = new S.Constructeur(Date.parse('2026-05-04T00:00:00Z'), 2000);
  for (let k = 0; k < 120; k++) g.vers(2000 + (k % 2 ? 15 : -15), 96, 1.2);
  assert.strictEqual(analyser(g.b).action, 'attendre');
});

test('Bougie en cours ignorée : seules les bougies clôturées comptent', function () {
  const b = histoireAchat().b;
  // « maintenant » tombe au milieu de la dernière bougie : même décision que sans cette bougie
  const enCours = M.analyserActif('TEST', S.versBridge(b), null, Date.parse(b[b.length - 1].time) + 5 * 60000, {}, {});
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
