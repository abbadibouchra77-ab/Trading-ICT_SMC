// Relit la décision du bot au moment où un trade du backtest a été placé (pour les images).
// Usage : node backtest/relire.js <dossier des CSV> <symbole> <tPlace en ms> [<tPlace> ...]
// Affiche une ligne JSON par trade : lecture, scénario, points A / B, zone, liquidité, confirmations.
const path = require('path');
const moteur = require('../src/moteur.js');
const { lireCSV, unitesDeTemps } = require('./donnees.js');
const { ACTIFS, trouverFichier } = require('./lancer.js');

const LIMITES = { M15: 500, H1: 500, H4: 1000, D1: 400, W1: 120, MN: 60 };
function fenetre(ut, maintenant) {
  const out = {};
  for (const u of Object.keys(LIMITES)) {
    const arr = ut[u];
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time < maintenant) lo = m + 1; else hi = m; }
    out[u] = arr.slice(Math.max(0, lo - LIMITES[u]), lo);
  }
  return out;
}

const [dossier, symbole] = process.argv.slice(2, 4);
const temps = process.argv.slice(4).map(Number);
const actif = ACTIFS.find(function (a) { return a.symbol === symbole; });
const ut = unitesDeTemps(lireCSV(trouverFichier(dossier, actif)));
const c = actif.correle ? ACTIFS.find(function (x) { return x.symbol === actif.correle; }) : null;
const fc = c ? trouverFichier(dossier, c) : null;
const utC = fc ? unitesDeTemps(lireCSV(fc)) : null;
for (const tPlace of temps) {
  const maintenant = tPlace + 60000; // le bot tourne 1 min après la clôture (comme simulation.js)
  const correle = utC ? { M15: fenetre(utC, maintenant).M15 } : null;
  const r = moteur.analyserActif(symbole, fenetre(ut, maintenant), correle, maintenant, { legsDejaTradees: [] }, { crypto: !!actif.crypto, correle: actif.correle || '' });
  console.log(JSON.stringify({ tPlace: tPlace, action: r.action, lecture: r.lecture || r.raison, scenario: r.scenario, grade: r.grade, pointA: r.pointA, pointB: r.pointB,
    zone: r.zone, liquidite: r.liquidite, confirmations: r.confirmations || [], entree: r.entree, stop: r.stop }));
}
