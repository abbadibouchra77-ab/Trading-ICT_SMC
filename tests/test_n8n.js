// Teste les nœuds Code du workflow n8n hors de n8n, avec un faux « $ » et un faux bridge.
// Usage : node tests/test_n8n.js  (après node build/construire.js)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require('./scenarios.js');

const sdk = fs.readFileSync(path.join(__dirname, '../n8n/workflow.sdk.js'), 'utf8');
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
  'Bougies M15': [{ candles: br.M15 }]
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
assert.ok(ordres.every(function (o) { return o.volumeValide && o.objectif; }));

// Ligne du journal
s2['Taille de position'] = ordres;
const ligne = executer('Préparer la ligne du journal', s2, ordres.map(function (o, i) { return { positionId: 500 + i }; }))[0];
assert.strictEqual(ligne.statut, 'execute');
assert.strictEqual(ligne.resultat, 'ouvert');
assert.ok(ligne.lecture_topdown.length > 50 && ligne.cle_mouvement);

// Résultat d'un trade fermé
const r = executer('Résultats des trades fermés', {
  'Journal SMC Vision': [{ id: 7, statut: 'execute', resultat: 'ouvert', ordres: '500,501', risque_montant: 100 }],
  'Deals récents': [{ deals: [{ type: 'close', positionId: 500, netProfit: 150 }, { type: 'close', positionId: 501, netProfit: 260 }] }],
  'Positions ouvertes': [{}]
});
assert.deepStrictEqual(r[0], { id: 7, resultat: 'gagnant (4.10R)', resultat_montant: 410 });

Date.now = vraiNow;
console.log('OK    nœuds n8n : cycle, lecture, taille de position, journal, résultats (' + ordres.length + ' ordres, risque ' + risque.toFixed(2) + ' $)');
