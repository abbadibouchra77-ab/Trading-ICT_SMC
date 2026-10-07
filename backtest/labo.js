// Banc d'essai : lance des configurations en parallèle (worker_threads), découpe chaque résultat en 3 périodes
// (apprentissage 2019-2021, validation 2022-2023, test 2024-2026) et vérifie si le bot reproduit les trades de référence de l'utilisateur.
// Usage : node backtest/labo.js --donnees <dossier CSV> --grille <fichier.json> [--workers 4] [--sortie fichier.json] [--actifs A,B]
//   grille = [{ nom, moteur: 'htf' | 'amd', reglages: {...} }, ...]
const fs = require('fs');
const { fork } = require('child_process');
const estEnfant = process.argv[2] === '--enfant';

const PERIODES = [
  ['apprentissage', Date.parse('2019-01-01'), Date.parse('2022-01-01')],
  ['validation', Date.parse('2022-01-01'), Date.parse('2024-01-01')],
  ['test', Date.parse('2024-01-01'), Date.parse('2027-01-01')]
];

// Trades de référence donnés par l'utilisateur (fenêtre de remplissage en UTC, prix d'entrée plausibles, cible au plus / au moins)
const REFERENCES = [
  { nom: 'US500 vente 25/03/2019 (FVG F4)', symbole: 'US 500', sens: 'sell', de: '2019-03-25T08:00', a: '2019-03-25T13:00', pMin: 2798, pMax: 2808, tpMax: 2792 },
  { nom: 'US500 vente 14/12/2021 (OB)', symbole: 'US 500', sens: 'sell', de: '2021-12-14T13:00', a: '2021-12-14T17:00', pMin: 4644, pMax: 4662, tpMax: 4625 },
  { nom: 'XAUUSD achat 08/03/2022 (cassure range)', symbole: 'XAUUSD', sens: 'buy', de: '2022-03-08T06:30', a: '2022-03-08T11:00', pMin: 1999, pMax: 2008, tpMin: 2020 },
  { nom: 'XAUUSD vente 09/03/2022 (OTE + FVG)', symbole: 'XAUUSD', sens: 'sell', de: '2022-03-08T20:00', a: '2022-03-09T08:00', pMin: 2040, pMax: 2066, tpMax: 2030 }
];

function reproduit(trades, ref) {
  const t0 = Date.parse(ref.de + ':00Z'), t1 = Date.parse(ref.a + ':00Z');
  return trades.some(function (t) {
    const tf = t.tRempli || t.tPlace;
    if (t.symbole !== ref.symbole || t.sens !== ref.sens || tf < t0 || tf > t1) return false;
    if (t.entree < ref.pMin || t.entree > ref.pMax) return false;
    if (ref.tpMax !== undefined && t.tp1 > ref.tpMax) return false;
    if (ref.tpMin !== undefined && t.tp1 < ref.tpMin) return false;
    return true;
  });
}

function stats(trades) {
  const c = trades.filter(function (t) { return t.statut === 'clôturé'; });
  let R = 0, g = 0, p = 0, w = 0, pic = 0, dd = 0, cum = 0;
  for (const t of c) { R += t.R; cum += t.R; pic = Math.max(pic, cum); dd = Math.max(dd, pic - cum); if (t.R > 0) { g += t.R; w++; } else p -= t.R; }
  return { n: c.length, wr: c.length ? w / c.length : 0, R: +R.toFixed(1), pf: p > 0 ? +(g / p).toFixed(2) : null, dd: +dd.toFixed(1) };
}

function evaluer(trades) {
  const out = { periodes: {} };
  for (const [nom, a, b] of PERIODES) out.periodes[nom] = stats(trades.filter(function (t) { const tf = t.tRempli || t.tPlace; return tf >= a && tf < b; }));
  out.refs = REFERENCES.map(function (r) { return reproduit(trades, r) ? 1 : 0; });
  return out;
}

if (estEnfant) {
  const htf = require('./htf_mss.js'), amd = require('./amd15.js');
  const cache = {};
  const workerData = JSON.parse(process.argv[3]);
  const parentPort = { postMessage: function (x) { process.send(x); } };
  process.on('message', function (m) {
    if (m.fin) { process.exit(0); }
    const moteur = m.cfg.moteur === 'amd' ? amd : htf;
    const P = Object.assign({}, moteur.DEFAUT, m.cfg.reglages);
    const debut = Date.parse('2019-01-01'), fin = Date.parse('2026-12-31T23:59:59Z');
    let trades = [];
    try { trades = moteur.lancer(workerData.donnees, P, debut, fin, workerData.actifs, cache); } catch (e) { parentPort.postMessage({ nom: m.cfg.nom, erreur: String(e && e.stack || e) }); return; }
    parentPort.postMessage({ nom: m.cfg.nom, res: evaluer(trades), prete: true });
  });
  process.send({ pret: true });
} else if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; } }
  const grille = JSON.parse(fs.readFileSync(args.grille, 'utf8'));
  const nW = Math.min(+args.workers || 4, grille.length);
  const actifs = args.actifs ? String(args.actifs).split(',') : null;
  const file = grille.slice(), resultats = [];
  let enCours = 0, termines = 0;
  const entete = 'config'.padEnd(46) + ' | ' + PERIODES.map(function (p) { return p[0].slice(0, 5).padEnd(31); }).join(' | ') + ' | réf';
  console.log(entete);
  function ligne(r) {
    const p = r.res.periodes;
    const f = function (s) { return (String(s.n).padStart(5) + ' ' + (100 * s.wr).toFixed(0).padStart(3) + '% ' + String(s.R).padStart(7) + 'R PF ' + String(s.pf).padStart(5)).padEnd(31); };
    return r.nom.slice(0, 46).padEnd(46) + ' | ' + f(p.apprentissage) + ' | ' + f(p.validation) + ' | ' + f(p.test) + ' | ' + r.res.refs.join('');
  }
  for (let i = 0; i < nW; i++) {
    const w = fork(__filename, ['--enfant', JSON.stringify({ donnees: args.donnees, actifs: actifs })]);
    w.postMessage = function (x) { w.send(x); };
    w.on('message', function (m) {
      if (m.prete || m.erreur) {
        termines++; enCours--;
        if (m.erreur) console.error(m.nom + ' : ERREUR ' + m.erreur); else { resultats.push({ nom: m.nom, res: m.res }); console.log(ligne({ nom: m.nom, res: m.res })); }
      }
      if (file.length) { const cfg = file.shift(); enCours++; w.postMessage({ cfg: cfg }); }
      else if (enCours === 0) { if (args.sortie) fs.writeFileSync(args.sortie, JSON.stringify(resultats, null, 1)); process.exit(0); }
    });
  }
}

module.exports = { evaluer, reproduit, REFERENCES, PERIODES };
