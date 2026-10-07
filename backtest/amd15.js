// Backtest rapide de la stratégie AMD en M15 uniquement (demande du 07/10/2026 : « on revient sur l'AMD,
// on écarte Claude, on affine jusqu'à avoir des résultats solides, backtest uniquement en M15 »).
//
// Les deux cas, en M15 :
//  1. AMD validée (retournement) : un range (accumulation) ; une MÈCHE sort du range d'un côté pour prendre la
//     liquidité et la bougie revient dedans (manipulation) ; puis une bougie de DÉPLACEMENT avec VOLUME part
//     dans le sens opposé (distribution). On trade dans le sens de la distribution.
//  2. Continuation : une bougie de déplacement casse le range SANS mèche (ou avec une très petite mèche).
//     On trade dans le sens de la cassure.
// Entrée : ordre limite au retour du prix (50 % du FVG du déplacement, ou 50 % du corps de la bougie de
// déplacement s'il n'y a pas de FVG). Stop : au-delà de la mèche (cas 1) ou de la bougie de cassure (cas 2).
// Objectif : TP1 à rr1 R et TP2 à rr2 R ; break-even après TP1 puis stop suiveur M15 (même gestion que le bot).
//
// On ne regarde que le M15 et seulement les bougies clôturées. La vente = l'achat sur le graphique retourné.
// Usage : node backtest/amd15.js --donnees <dossier CSV> [--depuis 2019-01-01] [--jusqua 2023-12-31]
//         [--actifs XAUUSD,EURUSD] [--sortie dossier] [--reglages '{"rr1":2}'] [--grille fichier.json]
const fs = require('fs');
const path = require('path');
const { lireCSV, unitesDeTemps } = require('./donnees.js');
const { suivreTrade } = require('./simulation.js');
const { ACTIFS, trouverFichier } = require('./lancer.js');

const DEFAUT = {
  fenetres: [12, 16, 24, 32, 48],  // durée du range (bougies M15)
  hauteurMin: 1.0, hauteurMax: 5,   // hauteur du range en ATR M15
  touches: 2,                       // touches séparées du haut et du bas
  efficaciteMax: 0.35,              // range = sans direction
  mecheMin: 0.4,                    // cas 1 : la mèche fait au moins 40 % de la bougie
  mecheSortieMin: 0.1,              // cas 1 : la mèche dépasse le range d'au moins 10 % de sa hauteur
  delaiDeplacement: 2,              // cas 1 : le déplacement part dans les 2 bougies après la mèche (0 = la bougie de la mèche elle-même peut compter ? non : 1 et 2)
  corpsMin: 1.5,                    // déplacement : corps ≥ 1,5 × le corps moyen des 20 bougies
  volumeMin: 1.3,                   // déplacement : volume ≥ 1,3 × la moyenne des 20 bougies
  volumeCassure: false,             // cas 2 : volume exigé aussi ?
  petiteMeche: 0.15,                // cas 2 : chaque mèche ≤ 15 % de la bougie
  sortieCassure: 0.1,               // cas 2 : clôture au-delà du range d'au moins 0,1 ATR
  milieuDistribution: true,         // cas 1 : la distribution clôture au-delà du milieu du range
  entree: 'fvg',                    // 'fvg' (50 % du FVG, sinon 50 % du corps) ou 'corps' (50 % du corps)
  stop: 'meche',                    // 'meche' (au-delà de la mèche / bougie de cassure), 'milieu' (cassure : sous le milieu du range), 'range' (au-delà du range entier)
  stopAtr: 0,                       // distance minimale du stop en ATR M15 (0 = pas de minimum)
  margeStop: 0.1,                  // marge du stop en ATR
  stopMinAtr: 0.3,                  // stop trop serré en dessous
  rr1: 2, rr2: 3,                   // objectifs en R
  dureeOrdre: 16,                   // l'ordre limite attend 16 bougies (4 h)
  cas: ['manipulation', 'cassure'],
  spreadMaxR: 1,                    // le spread ne doit pas dépasser cette part du risque (0,1 = 10 %)
  objectif: 'R',                    // 'R' = TP à rr1 / rr2 R ; 'range' = liquidité en face / projection du range
  rrMin: 1.5,                       // objectif 'range' : au moins 1,5 R
  spreadFacteur: 1,                // 0 = sans spread (diagnostic)
  sessions: null                    // ex. [[7, 17]] : heures UTC autorisées pour le signal (null = 24 h / 24)
};

function moyenne(a) { let s = 0; for (const x of a) s += x; return a.length ? s / a.length : 0; }
function corps(b) { return Math.abs(b.c - b.o); }

function atrSerie(bs, n) {
  const out = new Array(bs.length).fill(NaN); let s = 0;
  for (let i = 1; i < bs.length; i++) {
    const tr = Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - bs[i - 1].c), Math.abs(bs[i].l - bs[i - 1].c));
    if (i <= n) { s += tr; if (i === n) out[i] = s / n; } else out[i] = (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}

// Range qui se termine à la bougie e (incluse). On garde le plus long qui remplit les conditions.
function range(bs, e, atr, P) {
  let meilleur = null;
  for (const W of P.fenetres) {
    const d0 = e - W + 1;
    if (d0 < 1) break;
    let hi = -Infinity, lo = Infinity, chemin = 0;
    for (let i = d0; i <= e; i++) { if (bs[i].h > hi) hi = bs[i].h; if (bs[i].l < lo) lo = bs[i].l; if (i > d0) chemin += Math.abs(bs[i].c - bs[i - 1].c); }
    const h = hi - lo;
    if (h < P.hauteurMin * atr || h > P.hauteurMax * atr) continue;
    let th = 0, tl = 0, pH0 = false, pL0 = false;
    for (let i = d0; i <= e; i++) {
      const pH = bs[i].h >= hi - 0.15 * h, pL = bs[i].l <= lo + 0.15 * h;
      if (pH && !pH0) th++; if (pL && !pL0) tl++; pH0 = pH; pL0 = pL;
    }
    const eff = chemin > 0 ? Math.abs(bs[e].c - bs[d0].c) / chemin : 1;
    if (th >= P.touches && tl >= P.touches && eff < P.efficaciteMax) meilleur = { debut: d0, fin: e, haut: hi, bas: lo, hauteur: h, bougies: W };
  }
  return meilleur;
}

// Caractéristiques du signal (pour chercher ce qui distingue les bons AMD des mauvais)
function carac(bs, q, rg, atr, cm, vm, meche) {
  const b = bs[q];
  let hi = -Infinity, lo = Infinity; for (let i = Math.max(0, q - 192); i < rg.debut; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
  let e = 0, a = 2 / 201; for (let i = Math.max(0, q - 600); i <= q; i++) e = e ? e + a * (bs[i].c - e) : bs[i].c;
  return { heure: new Date(b.t).getUTCHours(), bougies: rg.bougies, hauteurAtr: +(rg.hauteur / atr).toFixed(2), corps: +(corps(b) / cm).toFixed(2),
    volume: vm > 0 ? +(b.v / vm).toFixed(2) : null, meche: +meche.toFixed(2),
    position: hi > lo ? +(((rg.haut + rg.bas) / 2 - lo) / (hi - lo)).toFixed(2) : null, // 0 = range en bas des 2 derniers jours (décote), 1 = en haut (prime)
    ema200: b.c > e ? 'au-dessus' : 'en dessous' };
}

// Signal d'ACHAT à la clôture de la bougie q (bs = graphique, éventuellement retourné). Renvoie null ou le setup.
function signalAchat(bs, q, atrs, P) {
  const atr = atrs[q];
  if (!Number.isFinite(atr) || q < 60) return null;
  const b = bs[q];
  if (!(b.c > b.o)) return null;
  const cm = moyenne(bs.slice(q - 20, q).map(corps));
  const vm = moyenne(bs.slice(q - 20, q).map(function (x) { return x.v; }));
  const deplacement = corps(b) >= P.corpsMin * cm;
  if (!deplacement) return null;
  const volumeOk = vm <= 0 || b.v >= P.volumeMin * vm;
  // Cas 1 : mèche de manipulation sous le range dans les `delaiDeplacement` bougies avant q (le range finit avant la mèche)
  if (P.cas.indexOf('manipulation') >= 0 && volumeOk) {
    for (let d = 1; d <= P.delaiDeplacement; d++) {
      const m = q - d;
      const rg = range(bs, m - 1, atrs[m - 1], P);
      if (!rg) continue;
      const w = bs[m];
      const meche = Math.min(w.o, w.c) - w.l, taille = w.h - w.l;
      if (!(w.l < rg.bas - P.mecheSortieMin * rg.hauteur)) continue;   // la mèche sort du range (prise de liquidité)
      if (!(w.c >= rg.bas)) continue;                                  // et la bougie revient dans le range
      if (!(taille > 0 && meche >= P.mecheMin * taille)) continue;     // vraie mèche
      // entre la mèche et le déplacement : pas de nouvelle clôture sous le range
      let ok = true; for (let k = m + 1; k < q; k++) if (bs[k].c < rg.bas || bs[k].l < w.l) ok = false;
      if (!ok) continue;
      if (P.milieuDistribution && !(b.c > (rg.haut + rg.bas) / 2)) continue;
      return { cas: 'manipulation', rg: rg, m: m, q: q, extreme: w.l, atr: atr, f: carac(bs, q, rg, atr, cm, vm, meche / taille) };
    }
  }
  // Cas 2 : bougie de déplacement qui casse le haut du range sans mèche (ou très petite)
  if (P.cas.indexOf('cassure') >= 0 && (!P.volumeCassure || volumeOk)) {
    const rg = range(bs, q - 1, atrs[q - 1], P);
    if (rg) {
      const taille = b.h - b.l;
      const mHaut = b.h - b.c, mBas = b.o - b.l;
      if (taille > 0 && mHaut <= P.petiteMeche * taille && mBas <= P.petiteMeche * taille &&
          b.c > rg.haut + P.sortieCassure * atr && b.o <= rg.haut) {
        return { cas: 'cassure', rg: rg, m: q, q: q, extreme: b.l, atr: atr, f: carac(bs, q, rg, atr, cm, vm, 0) };
      }
    }
  }
  return null;
}

// Niveaux de l'ordre à la clôture de la bougie k (k = q, ou q + 1 si on attend le FVG)
function niveaux(bs, s, k, P) {
  const q = s.q, b = bs[q];
  let entree = null, type = '';
  if (P.entree === 'marche') { entree = bs[k].c; type = 'au marché'; }
  else if (P.entree === 'fvg' && k >= q + 1 && bs[q + 1].l > bs[q - 1].h) {
    entree = (bs[q + 1].l + bs[q - 1].h) / 2; type = 'FVG 50 %';
  } else { entree = (b.o + b.c) / 2; type = 'corps 50 %'; }
  let bas = s.extreme; for (let i = s.m; i <= k; i++) bas = Math.min(bas, bs[i].l);
  // stop non serré : au-delà de la mèche / de la cassure, ou au-delà du range entier (P.stop = 'range'),
  // et jamais à moins de P.stopAtr ATR de l'entrée (on l'éloigne au lieu de refuser)
  if (P.stop === 'range') bas = Math.min(bas, s.rg.bas);
  if (P.stop === 'milieu' && s.cas === 'cassure') bas = Math.min(bas, (s.rg.haut + s.rg.bas) / 2);
  let stop = bas - P.margeStop * s.atr;
  if (P.stopAtr) stop = Math.min(stop, entree - P.stopAtr * s.atr);
  const risque = entree - stop;
  if (!(risque >= P.stopMinAtr * s.atr)) return null;
  const prix = bs[k].c;
  if (P.entree !== 'marche' && !(prix > entree)) return null; // le prix est déjà revenu sous l'entrée
  if (P.objectif === 'range') {
    // objectif AMD : la liquidité en face (haut du range) après une manipulation ; la projection du range après une cassure
    const rg = s.rg, tp1 = s.cas === 'manipulation' ? rg.haut : rg.haut + rg.hauteur;
    if ((tp1 - entree) / risque < P.rrMin) return null;
    return { entree: entree, stop: stop, tp1: tp1, tp2: P.rr2 ? tp1 + rg.hauteur : null, type: type };
  }
  return { entree: entree, stop: stop, tp1: entree + P.rr1 * risque, tp2: P.rr2 ? entree + P.rr2 * risque : null, type: type };
}

function miroir(bs) { return bs.map(function (b) { return { t: b.t, o: -b.o, h: -b.l, l: -b.h, c: -b.c, v: b.v }; }); }

function backtesterActif(actif, M15, P, depuis, jusqua) {
  const bs = M15.map(function (b) { return { t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }; });
  const bm = miroir(bs);
  const atrA = atrSerie(bs, 14), atrV = atrSerie(bm, 14);
  const trades = [];
  let libre = 0;
  const regl = { dureeMaxJours: 20, margeBeR: 0.05, margeStopAtr: 0.1, pasMinR: 0.1 };
  for (let k = 60; k < bs.length - 1; k++) {
    const t = bs[k].t + 15 * 60000; // clôture de la bougie k
    if (t < depuis || bs[k].t > jusqua || t < libre) continue;
    if (P.sessions) { const h = new Date(bs[k].t).getUTCHours(); if (!P.sessions.some(function (s) { return h >= s[0] && h < s[1]; })) continue; }
    // signal sur la bougie k (entrée « corps ») ou sur la bougie k-1 avec FVG confirmé par k
    let trouve = null;
    for (const S of [1, -1]) {
      const g = S > 0 ? bs : bm, atrs = S > 0 ? atrA : atrV;
      const qs = P.entree === 'fvg' ? [k - 1, k] : [k];
      for (const q of qs) {
        const s = signalAchat(g, q, atrs, P);
        if (!s) continue;
        // en mode FVG : à la clôture de q on attend la bougie suivante ; à la clôture de q+1 on place l'ordre
        if (P.entree === 'fvg' && q === k) continue;
        const nv = niveaux(g, s, k, P);
        if (nv && P.entree === 'marche' && S > 0) nv.entree += actif.spread * P.spreadFacteur; // achat au marché : payé à l'ask
        if (!nv) continue;
        if (actif.spread > P.spreadMaxR * (nv.entree - nv.stop)) continue; // stop trop petit face au spread
        trouve = { S: S, s: s, nv: nv };
        break;
      }
      if (trouve) break;
    }
    if (!trouve) continue;
    const S = trouve.S, nv = trouve.nv;
    const sig = { sens: S > 0 ? 'buy' : 'sell', entree: S * nv.entree, stop: S * nv.stop, tp1: S * nv.tp1, tp2: nv.tp2 === null ? null : S * nv.tp2,
      expireA: new Date(t + P.dureeOrdre * 15 * 60000).toISOString() };
    const issue = suivreTrade(M15, k + 1, sig, actif.spread * P.spreadFacteur, regl);
    trades.push(Object.assign({ symbole: actif.symbol, sens: sig.sens, scenario: 'AMD ' + trouve.s.cas + ' M15', grade: 'AMD', entree: sig.entree, stop: sig.stop, tp1: sig.tp1, tp2: sig.tp2,
      typeEntree: nv.type, range: { debut: bs[trouve.s.rg.debut].t, haut: S > 0 ? trouve.s.rg.haut : -trouve.s.rg.bas, bas: S > 0 ? trouve.s.rg.bas : -trouve.s.rg.haut, bougies: trouve.s.rg.bougies },
      tSignal: bs[trouve.s.q].t, f: Object.assign({ risqueAtr: +((nv.entree - nv.stop) / trouve.s.atr).toFixed(2), fvg: nv.type === 'FVG 50 %' }, trouve.s.f), tMeche: bs[trouve.s.m].t }, issue));
    libre = (issue.tFin || t) + 1;
  }
  return trades;
}

function bilan(trades) {
  const c = trades.filter(function (t) { return t.statut === 'clôturé'; });
  const R = c.map(function (t) { return t.R; });
  const gains = R.filter(function (x) { return x > 0; }), pertes = R.filter(function (x) { return x <= 0; });
  let cum = 0, pic = 0, dd = 0, serie = 0, pire = 0;
  for (const x of R) { cum += x; pic = Math.max(pic, cum); dd = Math.max(dd, pic - cum); if (x < 0) { serie++; pire = Math.max(pire, serie); } else if (x > 0) serie = 0; }
  const sp = gains.reduce(function (a, b) { return a + b; }, 0), sn = -pertes.reduce(function (a, b) { return a + b; }, 0);
  return { trades: c.length, expires: trades.length - c.length, reussite: c.length ? gains.length / c.length : 0, Rtotal: +cum.toFixed(2), Rmoyen: c.length ? +(cum / c.length).toFixed(3) : 0,
    pf: sn > 0 ? +(sp / sn).toFixed(2) : null, ddR: +dd.toFixed(2), pertesSuite: pire };
}

function lancer(donnees, P, depuis, jusqua, actifs, cache) {
  const tous = [];
  for (const a of ACTIFS) {
    if (actifs && actifs.indexOf(a.symbol) < 0) continue;
    const f = trouverFichier(donnees, a); if (!f) continue;
    if (!cache[a.symbol]) cache[a.symbol] = unitesDeTemps(lireCSV(f)).M15;
    tous.push.apply(tous, backtesterActif(a, cache[a.symbol], P, depuis, jusqua));
  }
  return tous;
}

function grouper(trades, cle) {
  const g = {};
  for (const t of trades) { const k = cle(t); (g[k] = g[k] || []).push(t); }
  const out = {}; Object.keys(g).sort().forEach(function (k) { out[k] = bilan(g[k]); });
  return out;
}

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; } }
  const depuis = Date.parse(args.depuis || '2019-01-01'), jusqua = Date.parse(args.jusqua || '2023-12-31T23:59:59Z');
  const actifs = args.actifs ? String(args.actifs).split(',') : null;
  const cache = {};
  const variantes = args.grille ? JSON.parse(fs.readFileSync(args.grille, 'utf8')) : [{ nom: 'base', reglages: args.reglages ? JSON.parse(args.reglages) : {} }];
  const lignes = [];
  for (const v of variantes) {
    const P = Object.assign({}, DEFAUT, v.reglages);
    const tr = lancer(args.donnees, P, depuis, jusqua, actifs, cache);
    const b = bilan(tr), sc = grouper(tr, function (t) { return t.scenario; });
    lignes.push(Object.assign({ nom: v.nom }, b));
    console.log(v.nom.padEnd(28) + ' trades ' + String(b.trades).padStart(5) + ' | réussite ' + (100 * b.reussite).toFixed(1) + ' % | R moyen ' + b.Rmoyen + ' | R total ' + b.Rtotal + ' | PF ' + b.pf + ' | DD ' + b.ddR + 'R' +
      Object.keys(sc).map(function (k) { return '\n    ' + k.padEnd(26) + ' ' + sc[k].trades + ' trades, ' + (100 * sc[k].reussite).toFixed(1) + ' %, ' + sc[k].Rmoyen + ' R/trade, ' + sc[k].Rtotal + ' R'; }).join(''));
    if (args.sortie) {
      fs.mkdirSync(args.sortie, { recursive: true });
      fs.writeFileSync(path.join(args.sortie, v.nom + '.json'), JSON.stringify({ reglages: P, bilan: b, scenarios: sc, actifs: grouper(tr, function (t) { return t.symbole; }),
        annees: grouper(tr, function (t) { return new Date(t.tPlace).getUTCFullYear() + ''; }), trades: tr }, null, 1));
    }
  }
}

module.exports = { DEFAUT, range, signalAchat, niveaux, backtesterActif, bilan, grouper, lancer };
