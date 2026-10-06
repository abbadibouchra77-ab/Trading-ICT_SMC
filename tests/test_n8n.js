// Teste les nœuds Code du workflow n8n hors de n8n, avec un faux « $ » et un faux bridge.
// Usage : node tests/test_n8n.js  (après node build/construire.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');

const sdk = fs.readFileSync(path.join(__dirname, '../n8n/workflow.sdk.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '../n8n/gestion.sdk.js'), 'utf8');
function codeDe(nom) {
  const i = sdk.indexOf('name: ' + JSON.stringify(nom) + ',');
  const m = /jsCode: ("(?:[^"\\]|\\.)*")/.exec(sdk.slice(i));
  return JSON.parse(m[1]);
}
// Exécute un nœud Code avec des sorties de nœuds simulées.
function executer(nom, sorties, entree) {
  const $ = function (n) {
    if (!(n in sorties)) throw new Error('Nœud non exécuté : ' + n);
    const items = sorties[n].map(function (j) { return { json: j }; });
    return { all: function () { return items; }, first: function () { return items[0]; } };
  };
  const $input = { all: function () { return (entree || []).map(function (j) { return { json: j }; }); } };
  return new Function('$', '$input', codeDe(nom))($, $input).map(function (i) { return i.json; });
}

// Histoire d'achat complète (la même que dans test_moteur.js)
const T = fs.readFileSync(path.join(__dirname, 'test_moteur.js'), 'utf8');
eval(T.slice(T.indexOf('function histoireAchat'), T.indexOf('function analyser(')));
const g = histoireAchat();
const br = S.versBridge(g.b);
const vraiNow = Date.now;
Date.now = function () { return S.maintenantApres(g.b); };

const config = executer('Configuration', {})[0];
const sorties = {
  'Configuration': [config],
  'Solde du compte': [{ balance: 10000 }],
  'Deals du jour': [{ deals: [] }],
  'Positions ouvertes': [{ positions: [{ symbol: 'EURUSD', label: 'SMC-Vision', positionId: 1 }] }],
  'Ordres en attente': [{}],
  'Journal SMC Vision': [{}]
};
const actifs = executer('Préparer le cycle', sorties);
assert.strictEqual(actifs.length, 12, 'EURUSD déjà engagé : 12 actifs à analyser');
assert.ok(actifs.every(function (a) { return a.risquePct === 3.5; }), 'solde 10 000 : 3,5 %');

// 2 pertes aujourd'hui : plus rien n'est analysé
const deuxPertes = Object.assign({}, sorties, { 'Deals du jour': [{ type: 'close', netProfit: -100, label: 'SMC-Vision' }, { type: 'close', netProfit: -95, label: 'SMC-Vision' }] });
assert.strictEqual(executer('Préparer le cycle', deuxPertes).length, 0, '2 pertes : on arrête');
// Risque dégressif selon le solde
[[5000, 5], [7499, 5], [7500, 4], [9999, 4], [10000, 3.5], [15000, 3], [20000, 2.5], [30000, 2], [49999, 2], [50000, 1.5], [99999, 1.5], [100000, 1], [250000, 1]].forEach(function (x) {
  const r = executer('Préparer le cycle', Object.assign({}, sorties, { 'Solde du compte': [{ balance: x[0] }] }))[0].risquePct;
  assert.strictEqual(r, x[1], 'solde ' + x[0] + ' : ' + r + ' % au lieu de ' + x[1] + ' %');
});
// un palier mal saisi à 10 % est ramené à 5 %
const cfgFaux = Object.assign({}, config, { paliersRisque: [{ jusqu_a: 1e9, risque: 10 }] });
assert.strictEqual(executer('Préparer le cycle', Object.assign({}, sorties, { Configuration: [cfgFaux] }))[0].risquePct, 5);

// Lecture ICT/SMC sur l'actif XAUUSD avec les bougies du scénario
const actif = actifs.find(function (a) { return a.symbol === 'XAUUSD'; });
const s2 = Object.assign({}, sorties, {
  'Actif en cours': [actif],
  'Bougies Monthly': [{ error: { message: 'timeframe inconnu' } }], // le bridge refuse : reconstruction depuis le Daily
  'Bougies Weekly': [{ candles: br.W1 }],
  'Bougies Daily': [{ candles: br.D1 }],
  'Bougies H4': br.H4, // liste directe
  'Bougies H1': [{ candles: br.H1 }],
  'Bougies M15': [{ candles: br.M15 }],
  'Bougies M15 corrélées': [{ candles: br.M15 }]
});
const lecture = executer('Lecture ICT/SMC', s2)[0];
assert.strictEqual(lecture.action, 'trader', lecture.raison);
assert.ok(lecture.notes.some(function (n) { return /Monthly reconstruit/.test(n); }));

// Taille de position : risque 3,5 % de 10 000 = 350 $
s2['Lecture ICT/SMC'] = [lecture];
s2['Spécification du symbole'] = [{ tickSize: 0.01, contractSize: 100, volumeStep: 0.01, minVolume: 0.01, maxVolume: 50 }];
const ordres = executer('Taille de position', s2);
const risque = ordres.reduce(function (s, o) { return s + o.volume * Math.abs(o.entree - o.stop) * 100; }, 0);
assert.ok(risque <= 350 + 1e-6 && risque > 300, 'risque réel ' + risque.toFixed(2) + ' $ pour 350 $ prévus');
assert.ok(ordres.every(function (o) { return o.volumeValide && o.objectif && o.expireA && o.entree === lecture.entree; }), 'ordres limites au prix d\'entrée avec expiration');

// Ligne du journal
s2['Taille de position'] = ordres;
const ligne = executer('Préparer la ligne du journal', s2, ordres.map(function (o, i) { return { orderId: 500 + i }; }))[0];
assert.strictEqual(ligne.statut, 'execute');
assert.ok(ligne.note >= 20 && ligne.expire_a && /ordre limite/.test(ligne.mode_entree));
assert.strictEqual(ligne.resultat, 'ouvert');
assert.ok(ligne.lecture_topdown.length > 50 && ligne.cle_mouvement);

// Résultats : trade fermé, ordre encore en attente, ordre expiré
const cfgR = { Configuration: [config] };
const ligneJ = { id: 7, statut: 'execute', resultat: 'ouvert', symbole: 'XAUUSD', ordres: '500,501', risque_montant: 100, horodatage: '2026-09-01T07:00:00Z', expire_a: '2026-09-01T09:00:00Z' };
let r = executer('Résultats des trades fermés', Object.assign({}, cfgR, {
  'Journal SMC Vision': [ligneJ],
  'Deals récents': [{ deals: [{ type: 'close', symbol: 'XAUUSD', time: '2026-09-01T08:00:00Z', netProfit: 150, label: 'SMCV' }, { type: 'close', symbol: 'XAUUSD', time: '2026-09-01T10:00:00Z', netProfit: 260, label: 'SMCV' }, { type: 'close', symbol: 'XAUUSD', time: '2026-09-01T10:00:00Z', netProfit: -50, label: 'n8n-autre' }] }],
  'Positions ouvertes': [{}], 'Ordres en attente': [{}]
}));
assert.deepStrictEqual(r[0], { id: 7, resultat: 'gagnant (4.10R)', resultat_montant: 410 });
r = executer('Résultats des trades fermés', Object.assign({}, cfgR, { 'Journal SMC Vision': [ligneJ], 'Deals récents': [{}], 'Positions ouvertes': [{}], 'Ordres en attente': [{ orderId: 500, symbol: 'XAUUSD', label: 'SMCV' }] }));
assert.strictEqual(r.length, 0, 'ordre encore en attente : on attend');
r = executer('Résultats des trades fermés', Object.assign({}, cfgR, { 'Journal SMC Vision': [ligneJ], 'Deals récents': [{}], 'Positions ouvertes': [{}], 'Ordres en attente': [{}] }));
assert.ok(/^expiré/.test(r[0].resultat), 'ordre jamais déclenché : expiré');

// Gestion : positions reconnues, break-even après TP1, puis stop suiveur sous les creux M15
const cfgG = executer('Configuration gestion', {})[0];
const jour = [{ id: 9, statut: 'execute', resultat: 'ouvert', symbole: 'XAUUSD', sens: 'buy', entree: 2000, stop: 1990, tp1: 2020, horodatage: '2026-09-01T07:00:00Z', gestion: '' }];
const aGerer = executer('Positions à gérer', { 'Configuration gestion': [cfgG], 'Journal SMC Vision': jour,
  'Positions ouvertes': [{ positions: [{ positionId: 1, symbol: 'XAUUSD', side: 'buy', openPrice: 2000.2, stopLoss: 1990, takeProfit: 2040, label: 'SMCV' },
    { positionId: 2, symbol: 'XAUUSD', side: 'buy', openPrice: 2000.1, stopLoss: 1990, takeProfit: 2040, label: 'n8n-autre-bot' },
    { positionId: 3, symbol: 'EURUSD', side: 'buy', openPrice: 1.1, stopLoss: 1.09, takeProfit: 1.12 }] }] });
assert.deepStrictEqual(aGerer.map(function (p) { return p.positionId; }), [1], 'seule la position SMC Vision est gérée');
// bougies M15 : montée jusqu'à TP1 (2021), puis repli à 2012 (creux), puis reprise à 2018
const t0 = Date.parse('2026-09-01T07:00:00Z');
const prixM15 = [2001, 2004, 2008, 2012, 2016, 2021, 2017, 2014, 2012, 2014, 2016, 2018, 2018.5];
const bougiesG = prixM15.map(function (c, i) { return { time: new Date(t0 + i * 900000).toISOString(), open: c - 0.5, high: c + 0.5, low: c - 0.5, close: c }; });
Date.now = function () { return t0 + prixM15.length * 900000 + 60000; };
const etat = function (sl) { return { 'Configuration gestion': [cfgG], 'Position en cours': [Object.assign({}, aGerer[0], { stopLoss: sl })], 'Bougies M15 gestion': [{ candles: bougiesG }] }; };
let dg = executer('Décider le stop', etat(1990))[0];
assert.ok(dg.changer && Math.abs(dg.stopLoss - 2000.7) < 1e-6 && /break-even/.test(dg.gestion), 'break-even après TP1 : ' + JSON.stringify(dg));
dg = executer('Décider le stop', etat(2000.7))[0];
assert.ok(dg.changer && dg.stopLoss < 2011.5 && dg.stopLoss > 2011 && /structure M15/.test(dg.gestion), 'stop suiveur sous le creux 2011,5 : ' + JSON.stringify(dg));
dg = executer('Décider le stop', etat(dg.stopLoss))[0];
assert.strictEqual(dg.changer, false, 'le stop ne bouge plus tant qu\'il n\'y a pas de nouveau creux');
const avantTP1 = executer('Décider le stop', Object.assign(etat(1990), { 'Bougies M15 gestion': [{ candles: bougiesG.slice(0, 4) }] }))[0];
assert.strictEqual(avantTP1.changer, false, 'avant TP1 : rien');

Date.now = vraiNow;
console.log('OK    nœuds n8n : cycle, lecture v2, ordres limites, journal, résultats, gestion des stops (' + ordres.length + ' ordres, risque ' + risque.toFixed(2) + ' $)');
