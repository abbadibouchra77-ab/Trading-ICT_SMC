// Backtest de la stratégie « FVG haute unité de temps + MSS en M15 » (explication du 07/10/2026).
//
// Achat (la vente = la même chose sur le graphique retourné) :
//  1. Biais HTF : un POI HAUSSIER en haute unité de temps (FVG et/ou OB, réglage poi), tant qu'il n'est pas invalidé
//     (aucune clôture M15 sous son bas).
//  2. Le prix REVIENT dans ce FVG HTF.
//  3. Dans la POI, on cherche UNIQUEMENT un MSS haussier en M15 : après le creux du retour, une clôture M15
//     au-dessus du dernier sommet pivot qui précède ce creux. Les FVG baissiers M15 sont ignorés.
//  4. Entrée : ordre limite au retour dans le FVG et/ou l'OB créés par le MSS (réglage zoneEntree ; 50 % de la zone)
//     Stop sous le creux du retour.
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
  poi: 'fvg+ob',        // POI de la haute unité de temps : 'fvg', 'ob' ou 'fvg+ob' (l'un OU l'autre)
  zoneEntree: 'fvg+ob', // zone d'entrée du MSS en M15 : 'fvg', 'ob', 'ote' ou une combinaison ('fvg+ob+ote') : la plus proche du prix est touchée en premier
  oteFiltre: false,     // la zone d'entrée (50 % du FVG / de l'OB du MSS) doit être dans l'OTE : retracement de oteMin à oteMax % de la jambe du MSS
  oteMin: 62, oteMax: 79,
  oteNiveau: 70.5,      // zone 'ote' : retracement de la jambe du MSS (62 = bord proche, 70,5 = milieu de l'OTE, 79 = bord lointain)
  niveauEntree: 50,     // 50 = milieu de la zone, 0 = bord proche (haut de la zone, entrée au 1er contact)
  obCorps: 1.0,         // OB HTF : la bougie qui suit a un corps ≥ 1 × le corps moyen des 20 bougies
  biaisEma: 0,          // 0 = aucun ; sinon la clôture H4 doit être du bon côté de l'EMA de cette période (ex. 50)
  fvgCorpsMin: 0,       // FVG HTF : la bougie centrale (l'impulsion) a un corps ≥ ce multiple du corps moyen des 20 bougies (0 = aucune exigence)
  zoneMinAtrH: 0,       // taille de la POI HTF au moins ce multiple de l'ATR HTF (0 = aucun minimum)
  zoneMaxAtrH: 0,       // ... et au plus (0 = aucun maximum) : écarte les zones démesurées
  unSeulRetour: false,  // la POI est consommée après son premier retour : sans MSS dans la fenêtre, on n'y revient plus
  fvgMssChoix: 'dernier', // 'premier' : on entre sur le 1er FVG du déplacement (celui du haut) ; 'dernier' : sur le plus récent
  bos: false,           // après le MSS, on attend un BOS et on prend un 2e trade sur le 1er FVG du BOS (même cible)
  bosStop: 'repli',     // stop du 2e trade : 'repli' (derrière le sommet du repli entre MSS et BOS) ou 'origine' (même stop que le 1er)
  fenetreBos: 192,      // le BOS doit venir dans les 192 bougies M15 après le MSS
  oteBandeMin: 50, oteBandeMax: 78,   // mode 'ote' : bande de retracement de la jambe complète où doit se trouver le 50 % du FVG
  confirmeRetrace: 0.2, // mode 'ote' : la jambe est terminée quand le prix a retracé 20 % de sa longueur
  oteZones: 'fvg',      // mode 'ote' : zones d'entrée dans la bande OTE : 'fvg', 'ob' ou 'fvg+ob'
  fvgOteMinAtr: 0,      // mode 'ote' : le FVG retenu fait au moins ce multiple de l'ATR M15 (écarte les micro-FVG)
  jambeMinAtr: 3,       // mode 'ote' : la jambe doit mesurer au moins 3 ATR M15 avant qu'on trace son OTE
  fenetreJambe: 96,     // mode 'ote' : la jambe doit se terminer dans les 96 bougies M15
  poiLive: false,       // mode 'ote' : la POI HTF (FVG) est suivie EN DIRECT dès l'ouverture de sa 3e bougie, sans attendre la clôture
  annulerSiCible: true, // un ordre limite est ANNULÉ si le prix touche la cible (ou le stop) avant d'être rempli
  mode: 'mss',          // 'mss' : on attend un nouveau MSS M15 dans la POI ; 'sniper' : ordre limite à 50 % du FVG M15 qui a créé le mouvement de la POI HTF
  sniperCorps: 1.0,     // sniper : la bougie d'impulsion du FVG M15 a un corps ≥ ce multiple du corps moyen des 20 bougies
  sniperFvgMinAtr: 0.2, // sniper : taille minimale du FVG M15 en ATR M15
  sniperBos: false,     // sniper + 'mss' : un BOS (nouvelle cassure dans le même sens, après le MSS) doit confirmer avant que la POI soit disponible
  sniperChoix: 'mss',   // 'mss' (le FVG créé par le MSS M15 du mouvement),  // 'premier' (le 1er FVG M15 du mouvement : celui de la cassure de structure), 'proche' (50 % le plus proche du prix) ou 'profond' (le plus loin dans la POI)
  origineBougies: 6,    // sniper : la mèche d'origine = le plus bas des 6 bougies M15 qui précèdent l'impulsion (1re bougie du FVG comprise)
  dureeSniper: 96,      // sniper : l'ordre limite attend 96 bougies M15 (24 h)
  htf: 240,             // unité de temps du FVG, en minutes : 60 (H1), 240 (H4) ou 1440 (D1)
  ageMax: 60,           // le FVG HTF reste valable 60 bougies HTF
  zoneMinAtr: 0,        // taille minimale du FVG HTF en ATR M15 (0 = pas de minimum)
  fenetreMss: 48,       // le MSS doit survenir dans les 48 bougies M15 après le creux du retour
  pivotMss: 2,          // pivot (sommet à casser) : plus haut des 2 bougies de chaque côté
  reculPivot: 40,       // le sommet à casser est cherché dans les 40 bougies avant le creux
  pivotLiquidite: 3,    // sommets pivots pour les objectifs
  rechercheLiquidite: 300,
  entree: 'fvg',        // 'fvg' (50 % du FVG du MSS, sinon corps) ou 'marche'
  stopMode: 'creux',    // 'origine' (derrière la mèche de la bougie qui a créé le mouvement de la POI HTF), 'creux' (sous le creux du retour), 'poi' (sous le bas de la POI HTF si plus bas), 'recul' (sous le plus bas des stopRecul dernières bougies M15 : origine de la jambe)
  stopRecul: 96,        // mode 'recul' : nombre de bougies M15 regardées (96 = 24 h)
  margeStop: 0.1,       // marge sous le creux, en ATR M15
  stopMinAtr: 0.3,      // stop trop serré : on refuse
  margeCible: 0,        // la cible est posée à cette fraction d'ATR AVANT la liquidité (elle n'est pas toujours touchée au tick près)
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

// POI haussiers de la haute unité de temps (FVG et/ou OB), disponibles à la clôture de leur dernière bougie
function poiHtf(H, htfMs, P) {
  const zs = [];
  const ema = new Array(H.length).fill(NaN);
  if (P.biaisEma) { const a = 2 / (P.biaisEma + 1); let e = H.length ? H[0].c : 0; for (let i = 0; i < H.length; i++) { e += a * (H[i].c - e); ema[i] = e; } }
  const corpsMoy = function (i) { let s = 0, n = 0; for (let q = Math.max(0, i - 20); q < i; q++) { s += Math.abs(H[q].c - H[q].o); n++; } return n ? s / n : 0; };
  const atrH = atrSerie(H, 14);
  for (let i = 2; i < H.length; i++) {
    const taille = function (z) { return (!P.zoneMinAtrH || z >= P.zoneMinAtrH * atrH[i]) && (!P.zoneMaxAtrH || z <= P.zoneMaxAtrH * atrH[i]); };
    const biaisOk = !P.biaisEma || H[i].c > ema[i];
    if (!biaisOk) continue;
    if (P.poiLive && /fvg/.test(P.poi) && H[i - 1].c > H[i - 1].o && H[i - 1].c > H[i - 2].h && H[i].o > H[i - 2].h && Math.abs(H[i - 1].c - H[i - 1].o) >= P.fvgCorpsMin * corpsMoy(i - 1)) {
      // FVG « en direct » : bas = haut de la 1re bougie ; le haut descend avec le plus bas de la 3e bougie tant qu'elle n'est pas close
      zs.push({ genre: 'FVG live', live: true, bas: H[i - 2].h, haut: Infinity, dispo: H[i].t, fin: H[i].t + htfMs, minAtrH: P.zoneMinAtrH * atrH[i], touche: -1, utilise: false, origine: H[i - 2].l, t0: H[i - 2].t });
    }
    if (!P.poiLive && /fvg/.test(P.poi) && H[i].l > H[i - 2].h && taille(H[i].l - H[i - 2].h) && Math.abs(H[i - 1].c - H[i - 1].o) >= P.fvgCorpsMin * corpsMoy(i - 1)) zs.push({ genre: 'FVG', bas: H[i - 2].h, haut: H[i].l, dispo: H[i].t + htfMs, t0: H[i - 2].t, touche: -1, utilise: false, origine: H[i - 2].l });
    // OB : dernière bougie baissière avant une bougie haussière qui clôture au-dessus de son plus haut (déplacement)
    const j = i - 1;
    if (/ob/.test(P.poi) && H[j].c < H[j].o && H[i].c > H[i].o && H[i].c > H[j].h && Math.abs(H[i].c - H[i].o) >= P.obCorps * corpsMoy(i) && taille(H[j].h - H[j].l))
      zs.push({ genre: 'OB', bas: H[j].l, haut: H[j].h, dispo: H[i].t + htfMs, t0: H[j].t, touche: -1, utilise: false, origine: H[j].l });
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
function fvgMss(bs, iBas, k, premier) {
  if (premier) { for (let i = iBas + 2; i <= k; i++) if (bs[i].l > bs[i - 2].h) return { bas: bs[i - 2].h, haut: bs[i].l, i: i }; return null; }   // le 1er FVG du déplacement (celui du haut)
  for (let i = k; i >= iBas + 2; i--) if (bs[i].l > bs[i - 2].h) return { bas: bs[i - 2].h, haut: bs[i].l, i: i };
  return null;
}

// OB haussier du MSS : la dernière bougie baissière avant la poussée qui mène à la bougie qui casse
function obMss(bs, iBas, k) {
  let i = k - 1;
  while (i > iBas && !(bs[i].c < bs[i].o)) i--;
  return bs[i].c < bs[i].o ? { bas: bs[i].l, haut: bs[i].h, i: i } : null;
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
  const htfMs = P.htf * 60000, zs = poiHtf(H, htfMs, P), veille = plusHautsVeille(bs);
  const out = [];
  let prochaine = 0, actives = [], libre = 0;
  for (let k = 60; k < bs.length - 1; k++) {
    const t = bs[k].t + 15 * 60000; // clôture de la bougie k
    while (prochaine < zs.length && zs[prochaine].dispo <= t) { actives.push(zs[prochaine]); prochaine++; }
    const atr = atrs[k];
    // vie des zones : invalidée par une clôture sous son bas, ou trop vieille
    actives = actives.filter(function (z) { return !z.utilise && !(P.unSeulRetour && z.touche >= 0 && k - z.touche > P.fenetreMss + 8) && bs[k].c >= z.bas && t - z.dispo <= P.ageMax * htfMs; });
    if (!Number.isFinite(atr) || t < libre || t < depuis || bs[k].t > jusqua) {
      for (const z of actives) if (z.touche < 0 && bs[k].t >= z.dispo - 15 * 60000 && bs[k].l <= z.haut) z.touche = k;
      continue;
    }
    for (const z of actives) {
      if (z.touche < 0) { if (bs[k].l <= z.haut) z.touche = k; else continue; }  // 2. le prix revient dans le FVG HTF
      if (P.zoneMinAtr && z.haut - z.bas < P.zoneMinAtr * atr) continue;
      if (P.sessions) { const h = new Date(bs[k].t).getUTCHours(); if (!P.sessions.some(function (s) { return h >= s[0] && h < s[1]; })) continue; }
      if (z.bos) {   // le MSS est déjà pris : on attend le BOS (nouvelle cassure dans le même sens) et on entre sur le 1er FVG de ce déplacement
        if (k - z.bos.k > P.fenetreBos || bs[k].l < bs[z.bos.iBas].l) { z.utilise = true; continue; }   // trop long, ou la structure est cassée
        if (!(bs[k].c > z.bos.hi)) continue;
        let i2 = z.bos.k + 1; for (let q = z.bos.k + 1; q <= k; q++) if (bs[q].l < bs[i2].l) i2 = q;     // creux du repli entre le MSS et le BOS
        const f2 = fvgMss(bs, i2, k, P.fvgMssChoix === 'premier');
        if (!f2) { z.utilise = true; continue; }
        const e2 = (f2.bas + f2.haut) / 2;
        if (!(bs[k].c > e2)) { z.utilise = true; continue; }
        const stop2 = (P.bosStop === 'origine' ? bs[z.bos.iBas].l : bs[i2].l) - P.margeStop * atr, risque2 = e2 - stop2;
        z.utilise = true;
        if (!(risque2 >= P.stopMinAtr * atr)) continue;
        const liq2 = liquidites(bs, k, e2, P, veille[k]);
        if (!liq2.length) continue;
        const tp12 = liq2[0] - P.margeCible * atr;
        if ((tp12 - e2) / risque2 < P.rrMin) continue;
        out.push({ lect: { iTouche: z.touche, iBas: i2, iPivot: z.bos.iBas, k: k, hi: z.bos.hi, lo: bs[i2].l, fvg: f2, ob: null }, k: k, t: t, entree: e2, stop: stop2, tp1: tp12, tp2: null, type: 'FVG BOS 50 %', atr: atr, zone: z,
          mss: { iBas: i2, p: z.bos.iBas, niveau: z.bos.hi, k: k } });
        break;
      }
      const m = chercherMss(bs, k, z, P);                                         // 3. MSS en M15
      if (!m) continue;
      // 4. entrée
      const b = bs[k];
      let entree = null, type = '';
      if (P.entree === 'marche') { entree = b.c; type = 'au marché'; }
      else {
        const niv = function (zn) { return zn.haut - (zn.haut - zn.bas) * P.niveauEntree / 100; };
        const c = [];
        if (/fvg/.test(P.zoneEntree)) { const f = fvgMss(bs, m.iBas, k, P.fvgMssChoix === 'premier'); if (f) c.push({ e: niv(f), t: 'FVG MSS' }); }
        if (/ob/.test(P.zoneEntree)) { const o = obMss(bs, m.iBas, k); if (o) c.push({ e: niv(o), t: 'OB MSS' }); }
        if (/ote/.test(P.zoneEntree)) {
          let hi = -Infinity; for (let q = m.iBas; q <= k; q++) hi = Math.max(hi, bs[q].h);
          const lo = bs[m.iBas].l;
          c.push({ e: hi - (hi - lo) * P.oteNiveau / 100, t: 'OTE ' + P.oteNiveau + ' %' });   // retracement de la jambe lo -> hi
        }
        c.sort(function (x, y) { return y.e - x.e; });
        if (P.oteFiltre) {
          let hi = -Infinity; for (let q = m.iBas; q <= k; q++) hi = Math.max(hi, bs[q].h);
          const lo = bs[m.iBas].l, h = hi - lo;
          for (let q = c.length - 1; q >= 0; q--) { const r = (hi - c[q].e) / h * 100; if (!(r >= P.oteMin && r <= P.oteMax)) c.splice(q, 1); }
        }      // la plus haute est touchée en premier
        const ok = c.filter(function (x) { return b.c > x.e; });
        if (!ok.length) continue;                            // pas de zone, ou le prix est déjà sous elle
        entree = ok[0].e; type = ok[0].t;
      }
      let base = bs[m.iBas].l;
      if (P.stopMode === 'origine') base = Math.min(base, z.origine);   // derrière la mèche de la bougie qui a créé le mouvement (origine de la POI HTF)
      else if (P.stopMode === 'poi') base = Math.min(base, z.bas);
      else if (P.stopMode === 'recul') for (let q = Math.max(0, k - P.stopRecul); q <= k; q++) base = Math.min(base, bs[q].l);
      const stop = base - P.margeStop * atr, risque = entree - stop;
      if (!(risque >= P.stopMinAtr * atr)) continue;
      // 5. première liquidité
      const liq = liquidites(bs, k, entree, P, veille[k]);
      if (!liq.length) continue;
      let tp1 = liq[0] - P.margeCible * atr;
      if ((tp1 - entree) / risque < P.rrMin) continue;
      if (P.rrMax && (tp1 - entree) / risque > P.rrMax) tp1 = entree + P.rrMax * risque;
      const tp2 = liq.length > 1 && liq[1] > tp1 ? liq[1] : null;
      let legHi = -Infinity; for (let q = m.iBas; q <= k; q++) legHi = Math.max(legHi, bs[q].h);
      if (P.bos) z.bos = { k: k, iBas: m.iBas, hi: legHi }; else z.utilise = true;
      const lect = { iTouche: z.touche, iBas: m.iBas, iPivot: m.p, k: k, hi: legHi, lo: bs[m.iBas].l, fvg: fvgMss(bs, m.iBas, k), ob: obMss(bs, m.iBas, k) };
      out.push({ lect: lect, k: k, t: t, entree: entree, stop: stop, tp1: tp1, tp2: tp2, type: type, atr: atr, zone: z, mss: m });
      break;
    }
  }
  return out;
}

// La lecture du bot, en prix et en temps réels (les ventes sont remises dans le bon sens), pour la dessiner sur un graphique
function lecture(S, g, l) {
  const pr = function (x) { return S * x; };
  const zone = function (z, i0) { return z ? { bas: Math.min(pr(z.bas), pr(z.haut)), haut: Math.max(pr(z.bas), pr(z.haut)), t: g[i0 === undefined ? z.i : i0].t } : null; };
  return { tTouche: g[l.iTouche].t, tCreux: g[l.iBas].t, prixCreux: pr(l.lo), tPivot: g[l.iPivot].t, tCassure: g[l.k].t, hautJambe: pr(l.hi),
    fvg: l.fvg ? { bas: Math.min(pr(l.fvg.bas), pr(l.fvg.haut)), haut: Math.max(pr(l.fvg.bas), pr(l.fvg.haut)), t: g[l.fvg.i - 2].t } : null,
    ob: l.ob ? { bas: Math.min(pr(l.ob.bas), pr(l.ob.haut)), haut: Math.max(pr(l.ob.bas), pr(l.ob.haut)), t: g[l.ob.i].t } : null };
}

// Mèche d'origine du mouvement : plus bas des `origineBougies` bougies jusqu'à la 1re bougie du FVG M15 (le petit groupe qui précède l'impulsion)
function extremeOrigine(bs, c1, P) {
  let b = bs[c1].l; for (let i = Math.max(0, c1 - P.origineBougies + 1); i <= c1; i++) b = Math.min(b, bs[i].l);
  return b;
}

// Mode « sniper » : la POI HTF devient disponible ; parmi les FVG M15 formés PENDANT le mouvement qui l'a créée
// (impulsion avec corps), on prend celui dont le 50 % est dans la POI (le plus proche du prix) et on place un ordre limite dessus.
// Stop derrière la mèche de la bougie qui a créé le mouvement (1re bougie du FVG M15). Cible : première liquidité.
function setupsSniper(bs, H, atrs, P, depuis, jusqua) {
  const htfMs = P.htf * 60000, zs = poiHtf(H, htfMs, P), veille = plusHautsVeille(bs), out = [];
  const debut = function (t) { let a = 0, b = bs.length; while (a < b) { const m = (a + b) >> 1; if (bs[m].t < t) a = m + 1; else b = m; } return a; };
  for (const z of zs) {
    const k0 = debut(z.dispo - 15 * 60000);                        // 1re bougie M15 clôturée à / après la disponibilité de la POI
    if (k0 < 60 || k0 >= bs.length - 1) continue;
    const t = bs[k0].t + 15 * 60000, atr = atrs[k0];
    if (!Number.isFinite(atr) || t < depuis || bs[k0].t > jusqua) continue;
    if (!(bs[k0].c >= z.bas)) continue;                            // POI déjà invalidée
    let meilleur = null; const tous = [];
    if (P.sniperChoix === 'mss') {
      // MSS M15 dans le mouvement qui a créé la POI : clôture au-delà du dernier sommet pivot avant le creux ; le FVG créé par cette cassure
      const i0 = Math.max(debut(z.t0), 30), P2 = Object.assign({}, P, { fenetreMss: 96 });
      for (let q = i0 + 3; q < k0 && !meilleur; q++) {
        const m = chercherMss(bs, q, { touche: i0 }, P2);
        if (!m) continue;
        const f = fvgMss(bs, m.iBas, q);
        if (!f) continue;
        const e = (f.bas + f.haut) / 2;
        if (!(e >= z.bas && e <= z.haut)) continue;
        if (P.sniperBos) { let bos = false; for (let r = q + 1; r < k0; r++) if (bs[r].c > bs[q].h) { bos = true; break; } if (!bos) continue; }
        meilleur = { e: e, q: q, stop: extremeOrigine(bs, f.i - 2, P) };
      }
    } else
    for (let q = Math.max(debut(z.t0) + 2, 22); q < k0; q++) {
      if (!(bs[q].l > bs[q - 2].h)) continue;                      // FVG haussier M15 (q-2, q-1, q)
      const zb = bs[q - 2].h, zh = bs[q].l, e = (zb + zh) / 2;
      if (zh - zb < P.sniperFvgMinAtr * atrs[q]) continue;
      let cm = 0; for (let i = q - 21; i < q - 1; i++) cm += Math.abs(bs[i].c - bs[i].o); cm /= 20;
      if (!(Math.abs(bs[q - 1].c - bs[q - 1].o) >= P.sniperCorps * cm)) continue;   // vraie impulsion
      if (!(e >= z.bas && e <= z.haut)) continue;                  // le 50 % est dans la POI
      if (P.sniperChoix === 'tous') { tous.push({ e: e, q: q, stop: extremeOrigine(bs, q - 2, P) }); continue; }
      const mieux = !meilleur || (P.sniperChoix === 'proche' ? e > meilleur.e : P.sniperChoix === 'profond' ? e < meilleur.e : false);   // 'premier' : on garde le 1er trouvé
      if (mieux) meilleur = { e: e, q: q, stop: extremeOrigine(bs, q - 2, P) };
    }
    const liste = P.sniperChoix === 'tous' ? tous : (meilleur ? [meilleur] : []);
    for (const mm of liste) {
      if (!(bs[k0].c > mm.e)) continue;                              // ordre limite d'achat : le prix doit être au-dessus
      const stop = mm.stop - P.margeStop * atr, risque = mm.e - stop;
      if (!(risque >= P.stopMinAtr * atr)) continue;
      const liq = liquidites(bs, k0, mm.e, P, veille[k0]);
      if (!liq.length) continue;
      let tp1 = liq[0] - P.margeCible * atr;
      if (!((tp1 - mm.e) / risque >= P.rrMin)) continue;
      if (P.rrMax && (tp1 - mm.e) / risque > P.rrMax) tp1 = mm.e + P.rrMax * risque;
      out.push({ k: k0, t: t, groupe: z, entree: mm.e, stop: stop, tp1: tp1, tp2: liq.length > 1 && liq[1] - P.margeCible * atr > tp1 ? liq[1] - P.margeCible * atr : null, type: 'FVG M15 50 % (sniper)', atr: atr, zone: z, mss: null, lect: null, expireBars: P.dureeSniper });
    }
  }
  return out;
}

// Mode « ote » (explication du 07/10/2026) : POI HTF touchée -> MSS M15 -> la jambe se termine (le prix retrace 20 %) ->
// la zone OTE est la bande 50-78 % de retracement de la JAMBE COMPLÈTE ; tout FVG M15 de la jambe dont le 50 % est dans cette bande
// est une zone d'intérêt (le plus proche du prix en premier) : ordre limite à son 50 %, stop derrière la mèche d'origine de la jambe.
// Ensuite un BOS (nouvelle cassure dans le même sens) donne une 2e jambe : même raisonnement, même cible.
function ordreOte(bs, iBas, r, hiR, P, atrR) {
  const lo = bs[iBas].l, L = hiR - lo;
  let meilleur = null;
  if (/ob/.test(P.oteZones)) {                                   // order block : dernière bougie baissière avant une bougie qui clôture au-dessus de son plus haut
    for (let i = iBas; i < r; i++) {
      if (!(bs[i].c < bs[i].o && bs[i + 1].c > bs[i].h)) continue;
      const e = (bs[i].l + bs[i].h) / 2, ret = (hiR - e) / L * 100;
      if (ret < P.oteBandeMin || ret > P.oteBandeMax || !(bs[r].c > e)) continue;
      if (!meilleur || e > meilleur.e) meilleur = { e: e, i: i + 2, ob: true };
    }
  }
  for (let i = iBas + 2; i <= r && /fvg/.test(P.oteZones); i++) {
    if (!(bs[i].l > bs[i - 2].h)) continue;
    if (bs[i].l - bs[i - 2].h < P.fvgOteMinAtr * atrR) continue;
    const e = (bs[i - 2].h + bs[i].l) / 2, ret = (hiR - e) / L * 100;
    if (ret < P.oteBandeMin || ret > P.oteBandeMax) continue;
    if (!(bs[r].c > e)) continue;
    if (!meilleur || e > meilleur.e) meilleur = { e: e, i: i };
  }
  return meilleur;
}

function setupsOte(bs, H, atrs, P, depuis, jusqua) {
  const htfMs = P.htf * 60000, zs = poiHtf(H, htfMs, P), veille = plusHautsVeille(bs), out = [];
  let prochaine = 0, actives = [];
  for (let k = 60; k < bs.length - 1; k++) {
    const t = bs[k].t + 15 * 60000, atr = atrs[k];
    while (prochaine < zs.length && zs[prochaine].dispo <= t) { actives.push(zs[prochaine]); prochaine++; }
    actives = actives.filter(function (z) { return !z.utilise && (z.leg || bs[k].c >= z.bas) && t - z.dispo <= P.ageMax * htfMs; });
    const actif = Number.isFinite(atr) && t >= depuis && bs[k].t <= jusqua;
    for (const z of actives) {
      if (z.live && bs[k].t < z.fin) { z.haut = Math.min(z.haut, bs[k].l); if (z.haut <= z.bas) { z.utilise = true; continue; } }   // le FVG se referme : zone morte
      else if (z.live && !z.verifie) { z.verifie = true; if (z.haut - z.bas < z.minAtrH) { z.utilise = true; continue; } }
      if (z.touche < 0) { if (bs[k].l <= z.haut) z.touche = k; else continue; }
      if (!actif) continue;
      const g = z.leg;
      if (!g) {                                                    // 1. POI touchée : on cherche le MSS
        const m = chercherMss(bs, k, z, Object.assign({}, P, { fenetreMss: P.fenetreJambe }));
        if (m) z.leg = { etape: 1, iBas: m.iBas, k0: k, hi: -Infinity, origine: m.iBas };
        else continue;
        continue;
      }
      if (bs[k].l < bs[g.iBas].l && g.etape !== 2) { z.utilise = true; continue; }   // le bas d'origine est repris : plus de structure
      if (g.etape === 1 || g.etape === 3) {                       // 2. jambe en cours : on suit son sommet, on attend que le prix retrace
        for (let q = Math.max(g.k0, g.iBas); q <= k; q++) g.hi = Math.max(g.hi, bs[q].h);
        const lo = bs[g.iBas].l;
        if (k - g.k0 > P.fenetreJambe) { z.utilise = true; continue; }
        if (g.hi - lo < P.jambeMinAtr * atr) continue;
        if (!(bs[k].c <= g.hi - P.confirmeRetrace * (g.hi - lo))) continue;
        const o = ordreOte(bs, g.iBas, k, g.hi, P, atr);
        if (o) {
          const base = g.etape === 1 || P.bosStop !== 'origine' ? lo : bs[g.origine].l;
          const stop = base - P.margeStop * atr, risque = o.e - stop;
          const liq = liquidites(bs, k, o.e, P, veille[k]);
          if (risque >= P.stopMinAtr * atr && liq.length) {
            const tp1 = liq[0] - P.margeCible * atr;
            if ((tp1 - o.e) / risque >= P.rrMin)
              out.push({ k: k, t: t, groupe: z, entree: o.e, stop: stop, tp1: tp1, tp2: null, type: g.etape === 1 ? 'FVG OTE (MSS)' : 'FVG OTE (BOS)', atr: atr, zone: z, mss: null, lect: null, ote: { iBas: g.iBas, lo: lo, hi: g.hi, fi: o.i, k: k }, expireBars: P.dureeSniper });
          }
        }
        if (g.etape === 1 && P.bos) z.leg = { etape: 2, iBas: g.iBas, origine: g.origine, hi: g.hi, from: k, k0: k };
        else z.utilise = true;
        continue;
      }
      if (g.etape === 2) {                                         // 3. on attend le BOS : clôture au-delà du sommet de la 1re jambe
        if (k - g.k0 > P.fenetreBos || bs[k].l < bs[g.origine].l) { z.utilise = true; continue; }
        if (bs[k].c > g.hi) {
          let i2 = g.from; for (let q = g.from; q <= k; q++) if (bs[q].l < bs[i2].l) i2 = q;     // creux du repli = origine de la 2e jambe
          z.leg = { etape: 3, iBas: i2, k0: k, hi: -Infinity, origine: g.origine };
        }
      }
    }
  }
  return out;
}

// Un ordre limite qui n'a pas été rempli quand le prix atteint la cible (ou le stop) est caduc : le mouvement est parti sans nous.
// Renvoie true si l'ordre doit être annulé. dir = +1 achat, -1 vente (prix réels, ordre placé à la clôture de la bougie k0 - 1).
function ordreCaduc(M15, k0, sig, dirSens, nBougies) {
  const dir = dirSens === 'buy' ? 1 : -1;
  for (let i = k0; i < Math.min(M15.length, k0 + nBougies); i++) {
    const b = M15[i];
    const rempli = dir > 0 ? b.low <= sig.entree : b.high >= sig.entree;
    if (rempli) return false;                                          // rempli d'abord (ou dans la même bougie) : on garde
    const cible = dir > 0 ? b.high >= sig.tp1 : b.low <= sig.tp1;
    const stop = dir > 0 ? b.low <= sig.stop : b.high >= sig.stop;
    if (cible || stop) return true;                                    // parti sans nous
  }
  return false;
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
    for (const s of (P.mode === 'ote' ? setupsOte : P.mode === 'sniper' ? setupsSniper : setupsAchat)(g, S > 0 ? H : Hm, S > 0 ? atrA : atrV, P, depuis, jusqua)) tous.push({ S: S, s: s });
  }
  tous.sort(function (a, b) { return a.s.t - b.s.t; });
  const trades = [];
  let libre = 0;
  let groupeEnCours = null, finGroupe = 0;
  for (const x of tous) {
    const S = x.S, s = x.s;
    if (s.groupe && s.groupe === groupeEnCours) libre = 0;   // plusieurs entrées sniper sur la même POI : toutes prises
    else if (s.t < libre) continue;
    else if (s.groupe) { groupeEnCours = s.groupe; finGroupe = 0; }
    let entree = s.entree;
    if (P.entree === 'marche' && S > 0) entree += actif.spread * P.spreadFacteur;
    if (actif.spread > P.spreadMaxR * (entree - s.stop)) continue;
    const sig = { sens: S > 0 ? 'buy' : 'sell', entree: S * entree, stop: S * s.stop, tp1: S * s.tp1, tp2: s.tp2 === null ? null : S * s.tp2,
      expireA: new Date(s.t + (s.expireBars || P.dureeOrdre) * 15 * 60000).toISOString() };
    if (P.annulerSiCible && ordreCaduc(M15, s.k + 1, sig, sig.sens, s.expireBars || P.dureeOrdre)) continue;
    const issue = suivreTrade(M15, s.k + 1, sig, actif.spread * P.spreadFacteur, regl);
    trades.push(Object.assign({ symbole: actif.symbol, sens: sig.sens, scenario: (P.mode === 'ote' ? 'HTF + MSS/BOS + FVG dans l\'OTE (' : P.mode === 'sniper' ? 'HTF + FVG M15 sniper (' : 'HTF FVG + MSS M15 (') + ({ 60: 'H1', 240: 'H4', 1440: 'D1' }[P.htf] || P.htf + 'min') + ')', grade: 'MSS',
      entree: sig.entree, stop: sig.stop, tp1: sig.tp1, tp2: sig.tp2, typeEntree: s.type, tSignal: (S > 0 ? bs : bm)[s.k].t,
      mss: !s.mss ? null : { tBas: (S > 0 ? bs : bm)[s.mss.iBas].t, tPivot: (S > 0 ? bs : bm)[s.mss.p].t, niveau: S * s.mss.niveau, bas: S * (S > 0 ? bs : bm)[s.mss.iBas].l, tCassure: (S > 0 ? bs : bm)[s.k].t },
      ote: s.ote ? { tOrigine: bs[s.ote.iBas].t, prixOrigine: S * s.ote.lo, prixExtreme: S * s.ote.hi, tFvg: bs[s.ote.fi - 2].t, fvgBas: Math.min(S * (S > 0 ? bs : bm)[s.ote.fi - 2].h, S * (S > 0 ? bs : bm)[s.ote.fi].l), fvgHaut: Math.max(S * (S > 0 ? bs : bm)[s.ote.fi - 2].h, S * (S > 0 ? bs : bm)[s.ote.fi].l), tOrdre: bs[s.ote.k].t,
        bandeA: S * (s.ote.hi - 0.01 * P.oteBandeMin * (s.ote.hi - s.ote.lo)), bandeB: S * (s.ote.hi - 0.01 * P.oteBandeMax * (s.ote.hi - s.ote.lo)) } : null,
      lecture: s.lect ? lecture(S, S > 0 ? bs : bm, s.lect) : null,
      zoneHtf: { genre: s.zone.genre, bas: S > 0 ? s.zone.bas : -s.zone.haut, haut: S > 0 ? s.zone.haut : -s.zone.bas, dispo: s.zone.dispo },
      f: { risqueAtr: +((entree - s.stop) / s.atr).toFixed(2), rrTp1: +((s.tp1 - entree) / (entree - s.stop)).toFixed(2) } }, issue));
    finGroupe = Math.max(finGroupe, (issue.tFin || s.t) + 1);
    libre = s.groupe ? finGroupe : (issue.tFin || s.t) + 1;
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

module.exports = { DEFAUT, poiHtf, chercherMss, fvgMss, liquidites, setupsAchat, backtesterActif, lancer };
