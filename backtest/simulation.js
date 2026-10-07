// Rejoue le bot sur l'historique d'UN actif, bougie M15 par bougie M15, sans jamais regarder le futur.
//  - À chaque clôture M15 : le moteur reçoit seulement les bougies déjà clôturées (comme dans n8n).
//  - Un setup A++ place un ordre limite (deux demi-ordres TP1 / TP2) qui expire à l'heure prévue.
//  - Exécution réaliste : spread, stop compté en premier si stop et objectif sont touchés dans la même bougie.
//  - Gestion comme le workflow « Gestion des trades » : break-even (+0,05R) quand TP1 est atteint,
//    puis stop suiveur sous les creux M15 (au-dessus des sommets pour une vente), jamais en arrière.
//  - Pendant qu'un ordre attend ou qu'une position est ouverte, l'actif n'est plus analysé (comme le bot).
// Les résultats sont en R (1R = le risque prévu). Le passage en argent se fait dans portefeuille.js.
const moteur = require('../src/moteur.js');
const { unitesDeTemps } = require('./donnees.js');

const M15 = 15 * 60000;
const LIMITES = { M15: 500, H1: 500, H4: 1000, D1: 400, W1: 120, MN: 60 };
const DUREES = { M15: M15, H1: 3600000, H4: 4 * 3600000, D1: 86400000, W1: 7 * 86400000, MN: 31 * 86400000 };

// Pré-filtre rapide : il ne garde que les bougies où le moteur PEUT trouver un setup.
// Condition nécessaire du moteur : une mèche M15 dans les 48 dernières bougies qui est l'extrême
// des 8 bougies précédentes au moins (la réaction M15, réglage reactionMin), et (hors cryptos) l'heure dans une killzone.
// tests/test_backtest.js vérifie que ce filtre ne change aucune décision.
function preFiltre(bs, n, atr, crypto, maintenant) {
  if (!crypto && moteur.REGLAGES.killzoneObligatoire) {
    const h = moteur.ny(maintenant).hm;
    if (!moteur.REGLAGES.killzones.some(function (k) { return h >= k.debut && h < k.fin; })) return false;
  }
  const tol = 0.1 * atr;
  const N = moteur.REGLAGES.reactionMin;
  for (let i = Math.max(N + 1, n - 48); i < n; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let q = i - N; q < i; q++) { if (bs[q].low < mn) mn = bs[q].low; if (bs[q].high > mx) mx = bs[q].high; }
    // la mèche d'un balayage peut s'étendre sur 4 bougies (liquidity grab)
    let lo = Infinity, hi = -Infinity;
    for (let q = i; q < Math.min(n, i + 4); q++) { if (bs[q].low < lo) lo = bs[q].low; if (bs[q].high > hi) hi = bs[q].high; }
    if (lo <= mn + tol || hi >= mx - tol) return true;
  }
  return false;
}

function atrDernier(bs, n) {
  let s = 0, k = 0;
  for (let i = Math.max(1, n - 14); i < n; i++) { s += Math.max(bs[i].high - bs[i].low, Math.abs(bs[i].high - bs[i - 1].close), Math.abs(bs[i].low - bs[i - 1].close)); k++; }
  return k ? s / k : 0;
}

// Fenêtres « bridge » à l'instant `maintenant` : les dernières bougies commencées avant maintenant
// (le moteur écarte lui-même la bougie pas encore clôturée).
function fenetres(ut, ptr, maintenant) {
  const out = {};
  for (const u of Object.keys(LIMITES)) {
    const arr = ut[u];
    while (ptr[u] < arr.length && arr[ptr[u]].time < maintenant) ptr[u]++;
    out[u] = arr.slice(Math.max(0, ptr[u] - LIMITES[u]), ptr[u]);
  }
  return out;
}

// Suit un ordre limite puis la position jusqu'à la fin. dir = +1 achat, -1 vente.
// Les prix des données sont des prix « bid » : un achat est rempli quand ask = bid + spread touche l'entrée,
// une vente est clôturée à l'ask (bid + spread).
function suivreTrade(bs, k0, sig, spread, regl) {
  const dir = sig.sens === 'buy' ? 1 : -1;
  const E = sig.entree, R = Math.abs(sig.entree - sig.stop);
  const expire = Date.parse(sig.expireA);
  const deux = sig.tp2 !== null && sig.tp2 !== undefined;
  const parts = deux ? [{ tp: sig.tp1, poids: 0.5, ouverte: true }, { tp: sig.tp2, poids: 0.5, ouverte: true }] : [{ tp: sig.tp1, poids: 1, ouverte: true }];
  // prix vu par la position : achat -> sorties au bid ; vente -> sorties à l'ask
  const sortieBas = function (b) { return dir > 0 ? b.low : b.low + spread; };
  const sortieHaut = function (b) { return dir > 0 ? b.high : b.high + spread; };
  let k = k0, rempli = -1;
  // 1) attente du remplissage
  for (; k < bs.length; k++) {
    const b = bs[k];
    if (b.time >= expire) return { statut: 'expiré', tPlace: bs[k0].time, tFin: expire, R: 0 };
    const touche = dir > 0 ? b.low + spread <= E : b.high >= E;
    if (touche) { rempli = k; break; }
  }
  if (rempli < 0) return { statut: 'fin des données', tPlace: bs[k0].time, tFin: bs[bs.length - 1].time, R: 0 };
  // 2) position ouverte
  let sl = sig.stop, be = false, Rtot = 0;
  const evenements = [];
  const tLimite = bs[rempli].time + regl.dureeMaxJours * 86400000;
  for (k = rempli; k < bs.length; k++) {
    const b = bs[k];
    const bas = sortieBas(b), haut = sortieHaut(b);
    // stop d'abord (prudent), y compris sur la bougie de remplissage
    const stopTouche = dir > 0 ? bas <= sl : haut >= sl;
    if (stopTouche) {
      // si la bougie ouvre déjà au-delà du stop (gap), la sortie se fait à l'ouverture
      const ouv = dir > 0 ? b.open : b.open + spread;
      const px = k > rempli && dir * (ouv - sl) < 0 ? ouv : sl;
      for (const p of parts) if (p.ouverte) { p.ouverte = false; const r = dir * (px - E) / R; Rtot += p.poids * r; evenements.push({ t: b.time, quoi: be ? 'stop suiveur / break-even' : 'stop', R: +(p.poids * r).toFixed(3) }); }
      break;
    }
    for (const p of parts) if (p.ouverte && (dir > 0 ? haut >= p.tp : bas <= p.tp)) {
      p.ouverte = false; const r = dir * (p.tp - E) / R; Rtot += p.poids * r; evenements.push({ t: b.time, quoi: p === parts[0] ? 'TP1' : 'TP2', R: +(p.poids * r).toFixed(3) });
    }
    if (!parts.some(function (p) { return p.ouverte; })) break;
    if (b.time >= tLimite) {
      const px = dir > 0 ? b.close : b.close + spread;
      for (const p of parts) if (p.ouverte) { p.ouverte = false; const r = dir * (px - E) / R; Rtot += p.poids * r; evenements.push({ t: b.time, quoi: 'clôture (durée max)', R: +(p.poids * r).toFixed(3) }); }
      break;
    }
    // gestion à la clôture de la bougie (appliquée à partir de la bougie suivante)
    if (deux && !parts[0].ouverte) {
      if (!be) { be = true; const nv = E + dir * regl.margeBeR * R; if (dir * (nv - sl) > 0) sl = nv; }
      else {
        // dernier creux (sommet) M15 confirmé depuis le remplissage
        let pivot = null;
        for (let i = k - 2; i >= rempli + 2; i--) {
          const x = dir > 0 ? bs[i].low : bs[i].high;
          let ok = true;
          for (let q = 1; q <= 2; q++) { const a = dir > 0 ? bs[i - q].low : bs[i - q].high, c = dir > 0 ? bs[i + q].low : bs[i + q].high; if (dir > 0 ? (a <= x || c < x) : (a >= x || c > x)) ok = false; }
          if (ok) { pivot = x; break; }
        }
        if (pivot !== null) {
          const nv = pivot - dir * regl.margeStopAtr * atrDernier(bs, k + 1);
          if (dir * (nv - sl) >= regl.pasMinR * R && dir * (b.close - nv) > 0) sl = nv;
        }
      }
    }
  }
  const fini = !parts.some(function (p) { return p.ouverte; });
  return { statut: fini ? 'clôturé' : 'fin des données', tPlace: bs[k0].time, tRempli: bs[rempli].time,
    tFin: evenements.length ? evenements[evenements.length - 1].t : bs[bs.length - 1].time, R: +Rtot.toFixed(3), evenements: evenements, kFin: k };
}

// Backtest complet d'un actif.
// actif = { symbol, crypto, correle }, brut = bougies (M1 ou M15), brutCorrele = bougies de l'actif corrélé ou null
function backtesterActif(actif, brut, brutCorrele, options) {
  options = options || {};
  const regl = Object.assign({ spread: 0, depuis: null, jusqua: null, dureeMaxJours: 20, margeBeR: 0.05, margeStopAtr: 0.1, pasMinR: 0.1, preFiltre: true, reglagesMoteur: {} }, options);
  const ut = unitesDeTemps(brut);
  const utC = brutCorrele ? unitesDeTemps(brutCorrele) : null;
  const bs = ut.M15;
  const ptr = { M15: 0, H1: 0, H4: 0, D1: 0, W1: 0, MN: 0 }, ptrC = { M15: 0 };
  const legs = [];
  const trades = [];
  let analyses = 0, filtres = 0;
  const debut = regl.depuis ? Date.parse(regl.depuis) : bs[0].time + 60 * 86400000; // 60 jours de préchauffage
  const fin = regl.jusqua ? Date.parse(regl.jusqua) : Infinity;
  let libreA = 0; // l'actif est engagé (ordre ou position) jusqu'à cet instant
  for (let n = 200; n < bs.length; n++) {
    const maintenant = bs[n - 1].time + M15 + 60000; // le bot tourne 1 min après la clôture
    if (maintenant < debut || bs[n - 1].time > fin || maintenant < libreA) continue;
    if (regl.preFiltre && !preFiltre(bs, n, atrDernier(bs, n), !!actif.crypto, maintenant)) { filtres++; continue; }
    analyses++;
    const f = fenetres(ut, ptr, maintenant);
    let fc = null;
    if (utC) { const arr = utC.M15; while (ptrC.M15 < arr.length && arr[ptrC.M15].time < maintenant) ptrC.M15++; fc = { M15: arr.slice(Math.max(0, ptrC.M15 - 500), ptrC.M15) }; }
    const r = moteur.analyserActif(actif.symbol, f, fc, maintenant, { legsDejaTradees: legs }, { crypto: !!actif.crypto, correle: actif.correle || '', reglages: regl.reglagesMoteur });
    if (r.action !== 'trader') continue;
    const issue = suivreTrade(bs, n, r, regl.spread, regl);
    trades.push(Object.assign({ symbole: actif.symbol, sens: r.sens, note: r.note, grade: r.grade, scenario: r.scenario, modeEntree: r.modeEntree, entree: r.entree, stop: r.stop, tp1: r.tp1, tp2: r.tp2, rr1: r.rr1, rr2: r.rr2,
      killzone: r.killzone, cle: r.cleMouvement, confirmations: r.confirmations }, issue));
    if (issue.statut !== 'expiré') legs.push(r.cleMouvement); // comme le journal : un mouvement exécuté n'est plus retradé
    libreA = issue.tFin + 1;
  }
  return { symbole: actif.symbol, trades: trades, analyses: analyses, filtres: filtres, bougies: bs.length, debut: bs[0].time, fin: bs[bs.length - 1].time };
}

module.exports = { backtesterActif, suivreTrade, preFiltre };
