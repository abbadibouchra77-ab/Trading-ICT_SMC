// Lance le backtest de SMC Vision sur l'historique des actifs.
// Usage :
//   node backtest/lancer.js --donnees <dossier des CSV> [--depuis 2021-01-01] [--jusqua 2025-12-31]
//                           [--capital 10000] [--sortie resultats] [--actifs XAUUSD,EURUSD] [--sans-prefiltre]
// Un CSV par actif ; le nom du fichier doit contenir le symbole broker ou le nom usuel
// (ex. « XAUUSD.csv », « US TECH 100_M15.csv », « NAS100.csv »).
// Résultat : <sortie>/rapport.md, trades.csv, resultats.json (+ un fichier par actif).
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// Actifs (mêmes que le nœud Configuration) + spread moyen estimé (en prix) pour Fusion Markets.
const ACTIFS = [
  { symbol: 'XAUUSD', noms: ['XAUUSD', 'GOLD'], correle: 'XAGUSD', spread: 0.12 },
  { symbol: 'XAGUSD', noms: ['XAGUSD', 'SILVER'], correle: 'XAUUSD', spread: 0.02 },
  { symbol: 'US TECH 100', noms: ['US TECH 100', 'USTECH100', 'NAS100', 'NASDAQ', 'USTEC', 'NDX'], correle: 'US 500', spread: 1.0 },
  { symbol: 'US 500', noms: ['US 500', 'US500', 'SPX500', 'SP500', 'SPX'], correle: 'US TECH 100', spread: 0.4 },
  { symbol: 'US 30', noms: ['US 30', 'US30', 'DJ30', 'DOW'], correle: 'US 500', spread: 1.5 },
  { symbol: 'GERMANY 40', noms: ['GERMANY 40', 'GER40', 'DE40', 'DAX'], correle: 'EUROPE 50', spread: 1.0 },
  { symbol: 'XTIUSD', noms: ['XTIUSD', 'USOIL', 'WTI', 'USOUSD', 'OIL'], correle: '', spread: 0.03 },
  { symbol: 'EURUSD', noms: ['EURUSD'], correle: 'GBPUSD', spread: 0.00008 },
  { symbol: 'GBPUSD', noms: ['GBPUSD'], correle: 'EURUSD', spread: 0.0001 },
  { symbol: 'USDJPY', noms: ['USDJPY'], correle: '', spread: 0.01 },
  { symbol: 'AUDUSD', noms: ['AUDUSD'], correle: 'EURUSD', spread: 0.0001 },
  { symbol: 'BTCUSD', noms: ['BTCUSD', 'BTCUSDT', 'BITCOIN'], correle: 'ETHUSD', spread: 15, crypto: true },
  { symbol: 'ETHUSD', noms: ['ETHUSD', 'ETHUSDT', 'ETHEREUM'], correle: 'BTCUSD', spread: 1.5, crypto: true }
];

function normaliser(s) { return String(s).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function trouverFichier(dossier, actif) {
  const fichiers = fs.readdirSync(dossier).filter(function (f) { return /\.(csv|txt)$/i.test(f); });
  for (const nom of actif.noms) {
    const n = normaliser(nom);
    const f = fichiers.find(function (x) { return normaliser(x).indexOf(n) >= 0; });
    if (f) return path.join(dossier, f);
  }
  return null;
}

if (!isMainThread) {
  // ---- travailleur : un actif ----
  const { lireCSV } = require('./donnees.js');
  const { backtesterActif } = require('./simulation.js');
  const w = workerData;
  const t0 = Date.now();
  const brut = lireCSV(w.fichier);
  if (brut.length < 1000) throw new Error(w.fichier + ' : seulement ' + brut.length + ' bougies lisibles');
  const brutC = w.fichierCorrele ? lireCSV(w.fichierCorrele) : null;
  const res = backtesterActif(w.actif, brut, brutC, { spread: w.actif.spread, depuis: w.depuis, jusqua: w.jusqua, preFiltre: w.preFiltre });
  res.secondes = Math.round((Date.now() - t0) / 1000);
  parentPort.postMessage(res);
} else {
  // ---- programme principal ----
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; }
  }
  if (!args.donnees) { console.error('Usage : node backtest/lancer.js --donnees <dossier> [--depuis AAAA-MM-JJ] [--jusqua AAAA-MM-JJ] [--capital 10000] [--sortie resultats]'); process.exit(1); }
  const sortie = args.sortie || 'resultats';
  fs.mkdirSync(sortie, { recursive: true });
  const capital = Number(args.capital || 10000);
  const filtre = args.actifs ? String(args.actifs).split(',').map(normaliser) : null;
  const travaux = [];
  for (const a of ACTIFS) {
    if (filtre && !a.noms.some(function (n) { return filtre.indexOf(normaliser(n)) >= 0; })) continue;
    const f = trouverFichier(args.donnees, a);
    if (!f) { console.log('  (pas de fichier pour ' + a.symbol + ')'); continue; }
    const c = a.correle ? ACTIFS.find(function (x) { return x.symbol === a.correle; }) : null;
    const fc = c ? trouverFichier(args.donnees, c) : null;
    travaux.push({ actif: a, fichier: f, fichierCorrele: fc, depuis: args.depuis || null, jusqua: args.jusqua || null, preFiltre: !args['sans-prefiltre'] });
  }
  const nbTravailleurs = Math.max(1, Math.min(require('os').cpus().length, travaux.length));
  const resultats = [];
  let suivant = 0;
  console.log('Backtest SMC Vision : ' + travaux.length + ' actifs, ' + nbTravailleurs + ' calculs en parallèle');
  function lancer() {
    if (suivant >= travaux.length) return null;
    const w = travaux[suivant++];
    return new Promise(function (ok, ko) {
      const t = new Worker(__filename, { workerData: w });
      t.on('message', function (r) { console.log('  ' + w.actif.symbol + ' : ' + r.trades.length + ' ordres, ' + r.analyses + ' analyses, ' + r.secondes + ' s'); fs.writeFileSync(path.join(sortie, 'trades_' + normaliser(w.actif.symbol) + '.json'), JSON.stringify(r, null, 1)); resultats.push(r); ok(); });
      t.on('error', function (e) { console.error('  ' + w.actif.symbol + ' : ERREUR ' + e.message); ok(); });
    }).then(lancer);
  }
  Promise.all(Array.from({ length: nbTravailleurs }, lancer)).then(function () {
    const rapport = require('./rapport.js');
    rapport.ecrire(resultats, capital, sortie, args);
    console.log('Rapport : ' + path.join(sortie, 'rapport.md'));
  });
}

module.exports = { ACTIFS, trouverFichier };
