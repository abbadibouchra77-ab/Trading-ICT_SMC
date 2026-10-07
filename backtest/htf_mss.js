// Backtest de la stratégie « FVG haute unité de temps + MSS en M15 » (explication du 07/10/2026).
//
// Achat (la vente = la même chose sur le graphique retourné) :
//  1. Biais HTF : un FVG HAUSSIER en haute unité de temps (H1 / H4 / D1), tant qu'il n'est pas invalidé
//     (aucune clôture M15 sous son bas). Il sert de zone d'intérêt (POI).
//  2. Le prix REVIENT dans ce FVG HTF.
//  3. Dans la POI, on cherche UNIQUEMENT un MSS haussier en M15 : après le creux du retour, une clôture M15
//     au-dessus du dernier sommet pivot qui précède ce creux. Les FVG baissiers M15 sont ignorés.
//  4. Entrée : ordre limite au retour dans le FVG haussier créé par le MSS (50 %, sinon 50 % du corps de la
//     bougie qui casse). Stop sous le creux du retour.
//  5. Objectif : la première liquidité au-dessus (premier sommet pivot M15 non balayé, ou plus haut de la veille).
//     TP2 = la liquidité suivante (s'il y en a une). Break-even après TP1 puis stop suiveur (gestion du bot).
//
// Seules les bougies clôturées sont utilisées. Usage :
//   node backtest/htf_mss.js --donnees <dossier CSV> [--depuis 2019-01-01] [--jusqua 2023-12-31]
//        [--actifs XAUUSD,EURUSD] [--sortie dossier] [--reglages '{"htf":60}'] [--grille fichier.json]
const fs = require('fs');
const path = require('path');
const { lireCSV, unitesDeTemps, regrouper } = require('./donnees.js');
const { suivreTrade } = require('./simulation.js');
const { ACTIFS, trouverFichier } = require('./lancer.js');
const { bilan, grouper } = require('./amd15.js');

const DEFAUT = {
  htf: 240,             // unité de temps du FVG, en minutes : 60 (H1), 240 (H4) ou 1440 (D1)
  ageMax: 60,           // le FVG HTF reste valable 60 bougies HTF
  zoneMinAtr: 0,        // taille minimale du FVG HTF en ATR M15 (0 = pas de minimum)
  fenetreMss: 48,       // le MSS doit survenir dans les 48 bougies M15 après le creux du retour
  pivotMss: 2,          // pivot (sommet à casser) : plus haut des 2 bougies de chaque côté
  reculPivot: 40,       // le sommet à casser est cherché dans les 40 bougies avant le creux
  pivotLiquidite: 3,    // sommets pivots pour les objectifs
  rechercheLiquidite: 300,
  entree: 'fvg',        // 'fvg' (50 % du FVG du MSS, sinon corps) ou 'marche'
  margeStop: 0.1,       // marge sous le creux, en ATR M15
  stopMinAtr: 0.3,      // stop trop serré : on refuse
  rrMin: 1,             // la première liquidité doit offrir au moins 1 R
  rrMax: 0,             // 0 = pas de maximum ; sinon on plafonne TP1 à rrMax R
  dureeOrdre: 16,       // l'ordre limite attend 16 bougies (4 h)
  spreadMaxR: 1,
  spreadFacteur: 1,
  sessions: null        // ex. [[7, 17]] : heures UTC autorisées pour le MSS
};

function atrSerie(bs, n) {
  const out = new Array(bs.length).fill(NaN); let s = 0;
  for (let i = 1; i < bs.length; i++) {
    const tr = Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - bs[i - 1].c), Math.abs(bs[i].l - bs[i - 1].c));
    if (i <= n) { s += tr; if (i === n) out[i] = s / n; } else out[i] = (out[i - 1] * (n - 1) + tr) / n;
  }
  return out;
}
function miroir(bs) { return bs.map(function (b) { return { t: b.t, o: -b.o, h: -b.l, l: -b.h, c: -b.c, v: b.v }; }); }
function versBs(M) { return M.map(function (b) { return { t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }; }); }

// Sommet pivot en i : plus haut que les L bougies de chaque côté
function pivotHaut(bs, i, L) {
  if (i - L < 0 || i + L >= bs.length) return false;
  for (let q = i - L; q <= i + L; q++) if (q !== i && bs[q].h >= bs[i].h) return false;
  return true;
}

// FVG haussiers de la haute unité de temps : disponibles à la clôture de leur 3e bougie
function fvgHtf(H, htfMs) {
  const zs = [];
  for (let i = 2; i < H.length; i++) {
    if (H[i].l > H[i - 2].h) zs.push({ bas: H[i - 2].h, haut: H[i].l, dispo: H[i].t + htfMs, touche: -1, utilise: false });
  }
  return zs;
}

// MSS haussier à la clôture de k pour une zone déjà touchée en j0. Renvoie null ou le setup.
function chercherMss(bs, k, z, P) {
  // creux du retour : le plus bas entre la 1re touche de la POI et k
  let iBas = z.touche;
  for (let i = z.touche; i <= k; i++) if (bs[i].l < bs[iBas].l) iBas = i;
  if (iBas >= k || k - iBas > P.fenetreMss) return null;
  // sommet à casser : dernier sommet pivot avant le creux (confirmé : il est avant le creux)
  let p = -1;
  for (let i = iBas - 1; i >= Math.max(P.pivotMss, iBas - P.reculPivot); i--) if (pivotHaut(bs, i, P.pivotMss)) { p = i; break; }
  if (p < 0) return null;
  const niveau = bs[p].h;
  if (!(bs[k].c > niveau)) return null;
  for (let i = iBas + 1; i < k; i++) if (bs[i].c > niveau) return null; // déjà cassé plus tôt : MSS raté
  return { iBas: iBas, p: p, niveau: niveau, k: k };
}

// FVG haussier créé par le mouvement du MSS (entre le creux et la bougie qui casse) : le plus récent
function fvgMss(bs, iBas, k) {
  for (let i = k; i >= iBas + 2; i--) if (bs[i].l > bs[i - 2].h) return { bas: bs[i - 2].h, haut: bs[i].l, i: i };
  return null;
}

// Première liquidité au-dessus de l'entrée : sommet pivot M15 non balayé, ou plus haut de la veille
function liquidites(bs, k, entree, P, plusHautVeille) {
  const L = P.pivotLiquidite, c = [];
  for (let i = k - L; i >= Math.max(L, k - P.rechercheLiquidite); i--) {
    if (!pivotHaut(bs, i, L) || !(bs[i].h > entree)) continue;
    let balaye = false;
    for (let q = i + 1; q <= k; q++) if (bs[q].h >= bs[i].h) { balaye = true; break; }
    if (!balaye) c.push(bs[i].h);
  }
  if (Number.isFinite(plusHautVeille) && plusHautVeille > entree) c.push(plusHautVeille);
  c.sort(function (a, b) { return a - b; });
  return c.filter(function (x, i) { return i === 0 || x - c[i - 1] > 1e-12; });
}

function plusHautsVeille(bs) {
  const out = new Array(bs.length).fill(NaN);
  let jour = -1, hautJour = -Infinity, veille = NaN;
  for (let k = 0; k < bs.length; k++) {
    const j = Math.floor(bs[k].t / 86400000);
    if (j !== jour) { if (jour >= 0) veille = hautJour; jour = j; hautJour = -Infinity; }
    out[k] = veille;
    hautJour = Math.max(hautJour, bs[k].h);
  }
  return out;
}

// Parcourt un graphique (retourné pour les ventes) et renvoie les setups d'achat, dans l'ordre du temps.
function setupsAchat(bs, H, atrs, P, depuis, jusqua) {
  const htfMs = P.htf * 60000, zs = fvgHtf(H, htfMs), veille = plusHautsVeille(bs);
  const out = [];
  let prochaine = 0, actives = [], libre = 0;
  for (let k = 60; k < bs.length - 1; k++) {
    const t = bs[k].t + 15 * 60000; // clôture de la bougie k
    while (prochaine < zs.length && zs[prochaine].dispo <= t) { actives.push(zs[prochaine]); prochaine++; }
    const atr = atrs[k];
    // vie des zones : invalidée par une clôture sous son bas, ou trop vieille
    actives = actives.filter(function (z) { return !z.utilise && bs[k].c >= z.bas && t - z.dispo <= P.ageMax * htfMs; });
    if (!Number.isFinite(atr) || t < libre || t < depuis || bs[k].t > jusqua) {
      for (const z of actives) if (z.touche < 0 && bs[k].t >= z.dispo - 15 * 60000 && bs[k].l <= z.haut) z.touche = k;
      continue;
    }
    for (const z of actives) {
      if (z.touche < 0) { if (bs[k].l <= z.haut) z.touche = k; else continue; }  // 2. le prix revient dans le FVG HTF
      if (P.zoneMinAtr && z.haut - z.bas < P.zoneMinAtr * atr) continue;
      if (P.sessions) { const h = new Date(bs[k].t).getUTCHours(); if (!P.sessions.some(function (s) { return h >= s[0] && h < s[1]; })) continue; }
      const m = chercherMss(bs, k, z, P);                                         // 3. MSS en M15
      if (!m) continue;
      // 4. entrée
      const f = P.entree === 'marche' ? null : fvgMss(bs, m.iBas, k);
      const b = bs[k];
      let entree, type;
      if (P.entree === 'marche') { entree = b.c; type = 'au marché'; }
      else if (f) { entree = (f.bas + f.haut) / 2; type = 'FVG MSS 50 %'; }
      else { entree = (b.o + Math.max(b.c, b.o)) / 2; type = 'corps 50 %'; }
      const stop = bs[m.iBas].l - P.margeStop * atr, risque = entree - stop;
      if (!(risque >= P.stopMinAtr * atr)) continue;
      if (P.entree !== 'marche' && !(b.c > entree)) continue;                    // déjà sous l'entrée
      // 5. première liquidité
      const liq = liquidites(bs, k, entree, P, veille[k]);
      if (!liq.length) continue;
      let tp1 = liq[0];
      if ((tp1 - entree) / risque < P.rrMin) continue;
      if (P.rrMax && (tp1 - entree) / risque > P.rrMax) tp1 = entree + P.rrMax * risque;
      const tp2 = liq.length > 1 && liq[1] > tp1 ? liq[1] : null;
      z.utilise = true;
      out.push({ k: k, t: t, entree: entree, stop: stop, tp1: tp1, tp2: tp2, type: type, atr: atr, zone: z, mss: m });
      break;
    }
  }
  return out;
}

function backtesterActif(actif, M15, P, depuis, jusqua) {
  const bs = versBs(M15), bm = miroir(bs);
  const H = versBs(P.htf === 15 ? M15 : regrouper(M15, P.htf)), Hm = miroir(H);
  const atrA = atrSerie(bs, 14), atrV = atrSerie(bm, 14);
  const regl = { dureeMaxJours: 20, margeBeR: 0.05, margeStopAtr: 0.1, pasMinR: 0.1 };
  // setups des deux sens, triés dans le temps ; un seul trade à la fois par actif
  const tous = [];
  for (const S of [1, -1]) {
    const g = S > 0 ? bs : bm;
    for (const s of setupsAchat(g, S > 0 ? H : Hm, S > 0 ? atrA : atrV, P, depuis, jusqua)) tous.push({ S: S, s: s });
  }
  tous.sort(function (a, b) { return a.s.t - b.s.t; });
  const trades = [];
  let libre = 0;
  for (const x of tous) {
    const S = x.S, s = x.s;
    if (s.t < libre) continue;
    let entree = s.entree;
    if (P.entree === 'marche' && S > 0) entree += actif.spread * P.spreadFacteur;
    if (actif.spread > P.spreadMaxR * (entree - s.stop)) continue;
    const sig = { sens: S > 0 ? 'buy' : 'sell', entree: S * entree, stop: S * s.stop, tp1: S * s.tp1, tp2: s.tp2 === null ? null : S * s.tp2,
      expireA: new Date(s.t + P.dureeOrdre * 15 * 60000).toISOString() };
    const issue = suivreTrade(M15, s.k + 1, sig, actif.spread * P.spreadFacteur, regl);
    trades.push(Object.assign({ symbole: actif.symbol, sens: sig.sens, scenario: 'HTF FVG + MSS M15 (' + ({ 60: 'H1', 240: 'H4', 1440: 'D1' }[P.htf] || P.htf + 'min') + ')', grade: 'MSS',
      entree: sig.entree, stop: sig.stop, tp1: sig.tp1, tp2: sig.tp2, typeEntree: s.type, tSignal: (S > 0 ? bs : bm)[s.k].t,
      zoneHtf: { bas: S > 0 ? s.zone.bas : -s.zone.haut, haut: S > 0 ? s.zone.haut : -s.zone.bas, dispo: s.zone.dispo },
      f: { risqueAtr: +((entree - s.stop) / s.atr).toFixed(2), rrTp1: +((s.tp1 - entree) / (entree - s.stop)).toFixed(2) } }, issue));
    libre = (issue.tFin || s.t) + 1;
  }
  return trades;
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

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; } }
  if (!args.donnees) { console.error('Usage : node backtest/htf_mss.js --donnees <dossier CSV> [--depuis ...] [--jusqua ...] [--actifs ...] [--reglages \'{"htf":60}\'] [--grille f.json] [--sortie dossier]'); process.exit(1); }
  const depuis = Date.parse(args.depuis || '2019-01-01'), jusqua = Date.parse(args.jusqua || '2023-12-31T23:59:59Z');
  const actifs = args.actifs ? String(args.actifs).split(',') : null;
  const cache = {};
  const variantes = args.grille ? JSON.parse(fs.readFileSync(args.grille, 'utf8')) : [{ nom: 'base', reglages: args.reglages ? JSON.parse(args.reglages) : {} }];
  for (const v of variantes) {
    const P = Object.assign({}, DEFAUT, v.reglages);
    const tr = lancer(args.donnees, P, depuis, jusqua, actifs, cache);
    const b = bilan(tr), ac = grouper(tr, function (t) { return t.symbole; });
    console.log(v.nom.padEnd(24) + ' trades ' + String(b.trades).padStart(5) + ' | réussite ' + (100 * b.reussite).toFixed(1) + ' % | R moyen ' + b.Rmoyen + ' | R total ' + b.Rtotal + ' | PF ' + b.pf + ' | DD ' + b.ddR + 'R' +
      Object.keys(ac).map(function (k) { return '\n    ' + k.padEnd(14) + ' ' + ac[k].trades + ' trades, ' + (100 * ac[k].reussite).toFixed(1) + ' %, ' + ac[k].Rmoyen + ' R/trade, ' + ac[k].Rtotal + ' R'; }).join(''));
    if (args.sortie) {
      fs.mkdirSync(args.sortie, { recursive: true });
      fs.writeFileSync(path.join(args.sortie, 'htf_mss_' + v.nom + '.json'), JSON.stringify({ reglages: P, bilan: b, actifs: ac,
        annees: grouper(tr, function (t) { return new Date(t.tPlace).getUTCFullYear() + ''; }), trades: tr }, null, 1));
    }
  }
}

module.exports = { DEFAUT, fvgHtf, chercherMss, fvgMss, liquidites, setupsAchat, backtesterActif, lancer };
