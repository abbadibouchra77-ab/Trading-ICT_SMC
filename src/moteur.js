// =====================================================================================
// SMC Vision v2 : moteur de lecture ICT / SMC
// -------------------------------------------------------------------------------------
// Le bot lit le graphique comme une trader. Il ne suit pas une checklist : il cherche une histoire
// de marché cohérente, qui peut prendre plusieurs formes.
//   1. Vision du marché             -> Monthly / Weekly / Daily : direction globale, dealing range, point B (DOL)
//   2. Contexte (H4, ou H1 dans le sens du H4) -> tendance + retour en OTE, AMD sur un range,
//                                      cassure d'un range horizontal ou diagonal par déplacement...
//   3. Réaction M15 dans ce contexte -> prise de liquidité, MSS avec déplacement, en killzone
//   4. Entrée                       -> ordre LIMITE au FVG (ou à l'OB) du déplacement, 2R au moins
// Les autres éléments (SMT, volume, RSI, Judas swing, confirmation H1...) sont des confirmations
// notées dans le journal ; ils ne bloquent jamais un trade. Interdits absolus : jamais sans prise
// de liquidité, jamais sous 2R, jamais hors killzone (sauf cryptos), on ne court pas après le prix.
//
// Astuce : on code seulement la logique « achat ». Pour la vente, on retourne le graphique
// (miroir : le prix devient négatif, un sommet devient un creux) et on applique exactement
// les mêmes règles. Les deux sens sont donc toujours traités pareil.
//
// Ce code est collé tel quel dans un nœud Code de n8n et testé en local (tests/).
// Seules les bougies CLÔTURÉES sont utilisées. Heures des sessions : heure de New York.
// =====================================================================================

// ------------------------------- Réglages -------------------------------------------
const REGLAGES = {
    rrMin: 2,                // TP1 à au moins 2R
  margeStopAtr: 0.15,      // marge derrière la mèche du balayage M15, en ATR M15
  fraicheurMSS: 8,         // le MSS M15 doit dater de 8 bougies (2 h) au plus
  mssPivot: 3,             // le MSS casse un vrai sommet M15 (pivot de 3 bougies de chaque côté), pas une petite bosse
  stopMinAtrH1: 1.0,       // le stop est au moins à 1 ATR H1 de l'entrée : jamais collé à l'entrée
  rangeH1: { bougies: 24, largeurAtr: 3, efficacite: 0.3 }, // H1 en range : 24 bougies dans 3 ATR, sans direction
  fenetreBalayageM15: 48,  // balayage M15 cherché sur les 12 dernières heures
  fenetreLegH4: 60,        // point B H4 cherché sur les 60 dernières bougies H4 (H1 : 80)
  dureeOrdreCrypto: 3,     // cryptos : l'ordre limite expire au bout de 3 h
  // Killzones (heure de New York) : Londres 02h-05h, New York matin 07h-11h. Cryptos : 24h/24.
  killzones: [{ nom: 'Londres', debut: 200, fin: 500 }, { nom: 'New York matin', debut: 700, fin: 1100 }],
  minBougies: { M15: 150, H1: 100, H4: 80, D1: 30, W1: 10, MN: 3 }
};

const DUREE = { M15: 15 * 60000, H1: 3600000, H4: 4 * 3600000, D1: 86400000, W1: 7 * 86400000 };

// ======================================================================================
// Outils de base
// ======================================================================================

// Bougies du bridge -> {t, o, h, l, c, v}, triées, seulement les bougies CLÔTURÉES.
function preparerBougies(brutes, ut, maintenant) {
  let liste = brutes || [];
  if (liste.length === 1 && liste[0] && Array.isArray(liste[0].candles)) liste = liste[0].candles;
  if (!Array.isArray(liste)) liste = [];
  const out = [];
  for (const b of liste) {
    if (!b) continue;
    const brut = b.time !== undefined ? b.time : (b.t !== undefined ? b.t : b.timestamp);
    const t = typeof brut === 'number' ? brut : Date.parse(brut);
    const x = { t: t, o: +b.open, h: +b.high, l: +b.low, c: +b.close,
      v: +(b.volume !== undefined ? b.volume : (b.tickVolume !== undefined ? b.tickVolume : 0)) || 0 };
    if (![x.t, x.o, x.h, x.l, x.c].every(Number.isFinite)) continue;
    if (!estCloturee(x.t, ut, maintenant)) continue;
    out.push(x);
  }
  out.sort(function (a, b) { return a.t - b.t; });
  return out.filter(function (b, i) { return i === 0 || b.t !== out[i - 1].t; });
}
function estCloturee(t, ut, maintenant) {
  if (ut === 'MN') { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) <= maintenant; }
  return t + DUREE[ut] <= maintenant;
}
// Reconstruit une unité de temps plus grande (secours si le bridge ne la fournit pas).
function regrouper(bougies, cle) {
  const out = []; let cur = null, k = null;
  for (const b of bougies) {
    const kb = cle(b.t);
    if (kb !== k) { if (cur) out.push(cur); cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; k = kb; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  return out;
}
function cleJour(t) { return new Date(t).toISOString().slice(0, 10); }
function cleSemaine(t) { const d = new Date(t); return cleJour(t - ((d.getUTCDay() + 6) % 7) * 86400000); }
function cleMois(t) { return new Date(t).toISOString().slice(0, 7); }
// Graphique miroir : la vente devient un achat.
function miroir(bs) { return bs.map(function (b) { return { t: b.t, o: -b.o, h: -b.l, l: -b.h, c: -b.c, v: b.v }; }); }

// Heure de New York (sessions ICT), avec cache.
const _fmtNY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const _cacheNY = new Map();
function ny(t) {
  let v = _cacheNY.get(t); if (v) return v;
  const o = {}; _fmtNY.formatToParts(t).forEach(function (p) { o[p.type] = p.value; });
  v = { jour: o.year + '-' + o.month + '-' + o.day, hm: (+o.hour) * 100 + (+o.minute) };
  _cacheNY.set(t, v); return v;
}

// ATR (taille moyenne des bougies) et RSI 14 (Wilder ; sur le miroir il vaut 100 - RSI).
function atrSerie(bs, n) {
  n = n || 14;
  const out = new Array(bs.length).fill(NaN); let s = 0;
  const tr = bs.map(function (b, i) { if (i === 0) return b.h - b.l; const pc = bs[i - 1].c; return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc)); });
  for (let i = 0; i < bs.length; i++) { s += tr[i]; if (i >= n) s -= tr[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function dernier(arr) { for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i]; return NaN; }
function rsiSerie(bs, n) {
  n = n || 14;
  const out = new Array(bs.length).fill(NaN);
  if (bs.length <= n) return out;
  let g = 0, p = 0;
  for (let i = 1; i <= n; i++) { const d = bs[i].c - bs[i - 1].c; if (d >= 0) g += d; else p -= d; }
  g /= n; p /= n; out[n] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  for (let i = n + 1; i < bs.length; i++) {
    const d = bs[i].c - bs[i - 1].c;
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n; p = (p * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  return out;
}
function moyenne(arr) { const v = arr.filter(Number.isFinite); return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : NaN; }
function corps(b) { return Math.abs(b.c - b.o); }
function uniques(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }

// ======================================================================================
// Structure : pivots, BOS / CHoCH (MSS), tendance, range
// ======================================================================================

// Pivot = sommet (ou creux) plus haut (bas) que les L bougies de chaque côté.
function pivots(bs, L) {
  const out = [];
  for (let i = L; i < bs.length - L; i++) {
    let sommet = true, creux = true;
    for (let k = 1; k <= L; k++) {
      if (bs[i - k].h >= bs[i].h || bs[i + k].h > bs[i].h) sommet = false;
      if (bs[i - k].l <= bs[i].l || bs[i + k].l < bs[i].l) creux = false;
    }
    if (sommet) out.push({ i: i, p: bs[i].h, type: 'H' });
    if (creux) out.push({ i: i, p: bs[i].l, type: 'L' });
  }
  return out;
}
// Cassures en CLÔTURE du dernier sommet / creux : BOS (dans la tendance) ou CHoCH (changement).
function structure(bs, L) {
  const piv = pivots(bs, L), evts = [];
  let tendance = 0, sh = null, sl = null, k = 0;
  for (let i = 0; i < bs.length; i++) {
    while (k < piv.length && piv[k].i + L <= i) { if (piv[k].type === 'H') sh = piv[k]; else sl = piv[k]; k++; }
    const c = bs[i].c;
    if (sh && c > sh.p) { evts.push({ i: i, dir: 1, type: tendance === -1 ? 'CHoCH' : 'BOS', niveau: sh.p, iNiveau: sh.i }); tendance = 1; sh = null; }
    else if (sl && c < sl.p) { evts.push({ i: i, dir: -1, type: tendance === 1 ? 'CHoCH' : 'BOS', niveau: sl.p, iNiveau: sl.i }); tendance = -1; sl = null; }
  }
  return { pivots: piv, evts: evts, tendance: tendance };
}
// Lecture d'une unité de temps : tendance (plus hauts / plus bas + dernière cassure) et range.
function lireUT(bs, L, nRange) {
  const st = structure(bs, L), n = bs.length;
  const atr = dernier(atrSerie(bs, 14)), rsi = rsiSerie(bs, 14), tol = 0.15 * atr;
  const H = st.pivots.filter(function (p) { return p.type === 'H'; }), Lw = st.pivots.filter(function (p) { return p.type === 'L'; });
  let score = 0;
  if (H.length >= 2) { const a = H[H.length - 2].p, b = H[H.length - 1].p; if (b > a + tol) score++; else if (b < a - tol) score--; }
  if (Lw.length >= 2) { const a = Lw[Lw.length - 2].p, b = Lw[Lw.length - 1].p; if (b > a + tol) score++; else if (b < a - tol) score--; }
  const dernierEvt = st.evts.length ? st.evts[st.evts.length - 1] : null;
  const dirEvt = dernierEvt ? dernierEvt.dir : 0;
  let tendance = 'range';
  if ((dirEvt === 1 && score >= 0) || score >= 2) tendance = 'haussier';
  else if ((dirEvt === -1 && score <= 0) || score <= -2) tendance = 'baissier';
  let hi = -Infinity, lo = Infinity;
  for (let i = Math.max(0, n - nRange); i < n; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
  const rsiPlat = rsiTourneAutourDe50(rsi, 16);
  const enRange = (score === 0 || dirEvt === 0) && (rsiPlat || (hi - lo) <= 4.5 * atr);
  return { st: st, atr: atr, rsi: rsi, tendance: tendance, dernierEvt: dernierEvt, enRange: enRange, rangeHaut: hi, rangeBas: lo, rsiPlat: rsiPlat };
}
function rsiTourneAutourDe50(rsi, n) {
  const v = rsi.slice(-n).filter(Number.isFinite);
  if (v.length < n * 0.8) return false;
  let x = 0; for (let i = 1; i < v.length; i++) if ((v[i] - 50) * (v[i - 1] - 50) < 0) x++;
  return x >= 3 && Math.min.apply(null, v) > 38 && Math.max.apply(null, v) < 62;
}

// ======================================================================================
// Zones : OB, Breaker (BB), FVG, IFVG, BPR
// role = 'achat' (support) ou 'vente' (résistance). Une mèche ne change rien : seule une
// CLÔTURE au-delà retourne la zone (OB -> breaker, FVG -> IFVG) ou la tue (2e cassure).
// ======================================================================================
function zones(bs, ut, depuis) {
  const atrS = atrSerie(bs, 14), n = bs.length, z = [];
  for (let i = Math.max(2, depuis || 0); i < n; i++) {
    const a = atrS[i]; if (!Number.isFinite(a)) continue;
    // FVG : le bas de la bougie i au-dessus du haut de la bougie i-2 (et le miroir)
    if (bs[i].l > bs[i - 2].h && bs[i].l - bs[i - 2].h >= 0.1 * a) z.push({ type: 'FVG', role: 'achat', bas: bs[i - 2].h, haut: bs[i].l, i: i, ut: ut });
    if (bs[i].h < bs[i - 2].l && bs[i - 2].l - bs[i].h >= 0.1 * a) z.push({ type: 'FVG', role: 'vente', bas: bs[i].h, haut: bs[i - 2].l, i: i, ut: ut });
    // OB : dernière bougie opposée avant un déplacement qui clôture au-delà d'elle
    const k = i - 1;
    if (k >= 1) {
      const ob = bs[k], s = bs[k + 1];
      if (ob.c < ob.o && s.c > s.o) for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) if (bs[j].c > ob.h) {
        let mx = -Infinity; for (let q = k + 1; q <= j; q++) mx = Math.max(mx, bs[q].h);
        if (mx - ob.l >= 1.0 * a) z.push({ type: 'OB', role: 'achat', bas: ob.l, haut: ob.h, i: j, iOrigine: k, ut: ut });
        break;
      }
      if (ob.c > ob.o && s.c < s.o) for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) if (bs[j].c < ob.l) {
        let mn = Infinity; for (let q = k + 1; q <= j; q++) mn = Math.min(mn, bs[q].l);
        if (ob.h - mn >= 1.0 * a) z.push({ type: 'OB', role: 'vente', bas: ob.l, haut: ob.h, i: j, iOrigine: k, ut: ut });
        break;
      }
    }
  }
  // BPR : un FVG haussier et un FVG baissier qui se chevauchent ; le rôle suit le plus récent.
  const fvgs = z.filter(function (x) { return x.type === 'FVG'; });
  for (let a = 0; a < fvgs.length; a++) for (let b = a + 1; b < fvgs.length; b++) {
    const A = fvgs[a], B = fvgs[b];
    if (A.role === B.role || B.i - A.i > 30) continue;
    const bas = Math.max(A.bas, B.bas), haut = Math.min(A.haut, B.haut);
    if (haut > bas) z.push({ type: 'BPR', role: B.role, bas: bas, haut: haut, i: B.i, ut: ut });
  }
  // Vie de chaque zone après sa formation
  for (const x of z) {
    x.touches = 0; x.mort = false;
    for (let j = x.i + 1; j < n; j++) {
      const b = bs[j];
      if (x.role === 'achat') {
        if (b.c < x.bas) { if (x.type === 'FVG' || x.type === 'OB') { x.type = x.type === 'FVG' ? 'IFVG' : 'Breaker'; x.role = 'vente'; x.iRetournement = j; } else { x.mort = true; break; } }
        else if (b.l <= x.haut) x.touches++;
      } else {
        if (b.c > x.haut) { if (x.type === 'FVG' || x.type === 'OB') { x.type = x.type === 'FVG' ? 'IFVG' : 'Breaker'; x.role = 'achat'; x.iRetournement = j; } else { x.mort = true; break; } }
        else if (b.h >= x.bas) x.touches++;
      }
    }
  }
  return z.filter(function (x) { return !x.mort; });
}

// ======================================================================================
// Liquidité : où sont les stops ?
// cote 'H' = au-dessus (stops des vendeurs), 'L' = en dessous (stops des acheteurs).
// ======================================================================================
function niveau(p, cote, genre, ut, t0, touches, ligne) {
  return { p: p, cote: cote, genre: genre, ut: ut, t0: t0, touches: touches || 1, ligne: ligne || null };
}
function prixNiveau(nv, t) { return nv.ligne ? nv.ligne.p0 + nv.ligne.pente * (t - nv.ligne.t0) / nv.ligne.pas : nv.p; }

// Plus hauts / plus bas de la veille, de la semaine, du mois (sur le miroir, haut et bas sont échangés).
function niveauxPeriodes(d) {
  const out = [], inv = d.inverse;
  function ajoute(bs, h, l, ut, duree) {
    if (!bs || !bs.length) return;
    const b = bs[bs.length - 1];
    const t0 = ut === 'MN' ? (function () { const x = new Date(b.t); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1); })() : b.t + duree;
    out.push(niveau(b.h, 'H', inv ? l : h, ut, t0, 1));
    out.push(niveau(b.l, 'L', inv ? h : l, ut, t0, 1));
  }
  ajoute(d.D1, 'plus haut de la veille (PDH)', 'plus bas de la veille (PDL)', 'D1', DUREE.D1);
  ajoute(d.W1, 'plus haut de la semaine passée (PWH)', 'plus bas de la semaine passée (PWL)', 'W1', DUREE.W1);
  ajoute(d.MN, 'plus haut du mois passé (PMH)', 'plus bas du mois passé (PML)', 'MN', 0);
  return out;
}
// Sessions (heure de New York) : Asie 20h-00h, Londres 02h-05h, New York 07h-11h.
// Pour chaque type, la dernière session terminée ; plus l'ouverture de minuit NY du jour.
function sessions(M15, maintenant, inverse) {
  const s = {};
  let ouvertureMinuit = null, jourMinuit = null;
  for (const b of M15) {
    const x = ny(b.t), hm = x.hm;
    if (hm === 0) { ouvertureMinuit = b.o; jourMinuit = x.jour; }
    const nomS = hm >= 2000 ? 'Asie' : (hm >= 200 && hm < 500 ? 'Londres' : (hm >= 700 && hm < 1100 ? 'New York' : null));
    if (!nomS) continue;
    const cle = nomS + '|' + x.jour;
    if (!s[cle]) s[cle] = { nom: nomS, h: b.h, l: b.l, fin: b.t + DUREE.M15 };
    else { s[cle].h = Math.max(s[cle].h, b.h); s[cle].l = Math.min(s[cle].l, b.l); s[cle].fin = b.t + DUREE.M15; }
  }
  // fin théorique de chaque session : Asie 00h, Londres 05h, New York 11h (NY)
  const finTheorique = { Asie: 2400, Londres: 500, 'New York': 1100 };
  const hmNow = ny(maintenant).hm, jourNow = ny(maintenant).jour;
  const derniere = {};
  for (const k in s) {
    const x = s[k], jour = k.split('|')[1];
    const enCours = jour === jourNow && hmNow < finTheorique[x.nom] && (x.nom !== 'Asie' || hmNow >= 2000);
    if (enCours) continue;
    if (!derniere[x.nom] || derniere[x.nom].fin < x.fin) derniere[x.nom] = x;
  }
  const niveaux = [];
  for (const n in derniere) {
    const x = derniere[n];
    niveaux.push(niveau(x.h, 'H', (inverse ? 'plus bas session ' : 'plus haut session ') + n, 'M15', x.fin, 1));
    niveaux.push(niveau(x.l, 'L', (inverse ? 'plus haut session ' : 'plus bas session ') + n, 'M15', x.fin, 1));
  }
  return { niveaux: niveaux, ouvertureMinuit: ouvertureMinuit, jourMinuit: jourMinuit };
}
// Liquidité des pivots : chaque sommet / creux, sommets / creux égaux (EQH / EQL),
// supports / résistances droits (≥ 3 touches), lignes de tendance (liquidité en biais),
// bords de range horizontal.
function niveauxPivots(bs, L, ut, recul, inverse) {
  const out = [], n = bs.length;
  if (n < 20) return out;
  const atr = dernier(atrSerie(bs, 14));
  const piv = pivots(bs, L).filter(function (p) { return p.i >= n - recul; });
  const pasMs = bs[n - 1].t - bs[n - 2].t;
  ['H', 'L'].forEach(function (cote) {
    const ps = piv.filter(function (p) { return p.type === cote; });
    const vraiHaut = (cote === 'H') !== !!inverse;
    for (const p of ps) out.push(niveau(p.p, cote, (vraiHaut ? 'sommet ' : 'creux ') + ut, ut, bs[Math.min(n - 1, p.i + L)].t, 1));
    [[0.1, 2, vraiHaut ? 'sommets égaux (EQH) ' : 'creux égaux (EQL) '], [0.3, 3, vraiHaut ? 'résistance droite ' : 'support droit ']].forEach(function (r) {
      const tol = r[0] * atr, vus = {};
      for (let a = 0; a < ps.length; a++) {
        if (vus[a]) continue;
        const g = [ps[a]];
        for (let b = a + 1; b < ps.length; b++) if (!vus[b] && Math.abs(ps[b].p - ps[a].p) <= tol) { g.push(ps[b]); vus[b] = true; }
        if (g.length >= r[1]) {
          const prix = cote === 'H' ? Math.max.apply(null, g.map(function (x) { return x.p; })) : Math.min.apply(null, g.map(function (x) { return x.p; }));
          const iMax = Math.max.apply(null, g.map(function (x) { return x.i; }));
          out.push(niveau(prix, cote, r[2] + ut + ' (' + g.length + ' touches)', ut, bs[Math.min(n - 1, iMax + L)].t, g.length));
        }
      }
    });
    // ligne de tendance : 2 pivots + au moins 1 autre touche, aucune clôture au-delà
    const der = ps.slice(-7);
    let best = null;
    for (let a = 0; a < der.length; a++) for (let b = a + 1; b < der.length; b++) {
      const A = der[a], B = der[b];
      if (B.i - A.i < 3) continue;
      const pente = (B.p - A.p) / (B.i - A.i);
      if (Math.abs(pente) < 0.02 * atr) continue;
      let touches = 0, casse = false;
      for (const P of der) if (Math.abs(A.p + pente * (P.i - A.i) - P.p) <= 0.2 * atr) touches++;
      for (let j = A.i; j < n && !casse; j++) { const lj = A.p + pente * (j - A.i); if (cote === 'H' ? bs[j].c > lj + 0.2 * atr : bs[j].c < lj - 0.2 * atr) casse = true; }
      if (casse || touches < 3) continue;
      if (!best || touches > best.touches || (touches === best.touches && B.i > best.B.i)) best = { A: A, B: B, pente: pente, touches: touches };
    }
    if (best) out.push(niveau(best.A.p + best.pente * (n - best.A.i), cote, (vraiHaut ? 'résistance en biais ' : 'support en biais ') + ut + ' (' + best.touches + ' touches)', ut,
      bs[Math.min(n - 1, best.B.i + L)].t, best.touches, { p0: best.A.p, t0: bs[best.A.i].t, pente: best.pente, pas: pasMs }));
  });
  // range horizontal récent : 24 bougies dans moins de 3,5 ATR, au moins 2 touches de chaque bord
  for (let fin = n - 1; fin >= Math.max(24, n - 30); fin -= 6) {
    let hi = -Infinity, lo = Infinity;
    for (let i = fin - 23; i <= fin; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
    if (hi - lo > 3.5 * atr) continue;
    let th = 0, tl = 0;
    for (let i = fin - 23; i <= fin; i++) { if (bs[i].h >= hi - 0.15 * atr) th++; if (bs[i].l <= lo + 0.15 * atr) tl++; }
    if (th >= 2 && tl >= 2) {
      out.push(niveau(hi, 'H', (inverse ? 'bas de range ' : 'haut de range ') + ut, ut, bs[fin].t, th));
      out.push(niveau(lo, 'L', (inverse ? 'haut de range ' : 'bas de range ') + ut, ut, bs[fin].t, tl));
      break;
    }
  }
  return out;
}
// Un niveau a-t-il été pris depuis sa création ?
function dejaPris(nv, series) {
  for (const bs of series) for (const b of bs) {
    if (b.t < nv.t0) continue;
    if (nv.cote === 'H' ? b.h > prixNiveau(nv, b.t) : b.l < prixNiveau(nv, b.t)) return true;
  }
  return false;
}
// Balayages côté bas : mèche sous un niveau encore intact, puis clôture qui revient au-dessus
// (même bougie ou la suivante). Ce n'est pas une acceptation.
// Liquidity grab (fausse cassure) : le prix CLÔTURE sous le niveau pour faire croire à une cassure,
// puis le reprend en 3 bougies au plus, sans s'installer dessous (au plus 2 clôtures dessous,
// jamais de clôture à plus de 1 ATR sous le niveau ; la mèche, elle, peut aller loin).
// C'est le piège : les vendeurs entrent sur la fausse cassure, la Smart Money achète.
function balayagesBas(bs, niveaux, atr, depuis) {
  const out = [];
  for (let i = Math.max(1, depuis); i < bs.length; i++) {
    const b = bs[i];
    for (const nv of niveaux) {
      if (nv.cote !== 'L' || b.t < nv.t0) continue;
      const p = prixNiveau(nv, b.t);
      if (!(b.l < p - 0.02 * atr)) continue;
      let pris = false;
      for (let q = i - 1; q >= 0 && bs[q].t >= nv.t0; q--) if (bs[q].l < prixNiveau(nv, bs[q].t)) { pris = true; break; }
      if (pris) continue; // déjà pris avant : il n'y a plus de liquidité
      let retour = null, grab = false;
      if (b.c > p) retour = i;
      else if (i + 1 < bs.length && bs[i + 1].c > p && bs[i + 1].l >= b.l - 0.5 * atr) retour = i + 1;
      else {
        // liquidity grab : reprise du niveau en 3 bougies au plus, sans acceptation dessous
        let dessous = 0;
        for (let q = i; q < Math.min(bs.length, i + 4); q++) {
          if (bs[q].c < p - 1.0 * atr) break; // clôture loin sous le niveau : vraie cassure
          if (bs[q].c > p) { if (q > i) { retour = q; grab = true; } break; }
          if (++dessous > 2) break;
        }
      }
      if (retour === null) continue;
      let meche = Infinity; for (let q = i; q <= retour; q++) meche = Math.min(meche, bs[q].l);
      out.push({ i: i, iRetour: retour, meche: meche, niveau: nv, grab: grab });
    }
  }
  return out;
}
// Regroupe les balayages d'une même mèche : plusieurs liquidités prises d'un coup = liquidité cumulée.
function grouperBalayages(bals) {
  const g = {};
  for (const s of bals) {
    if (!g[s.i]) g[s.i] = { i: s.i, iRetour: s.iRetour, meche: s.meche, niveaux: [], grab: true };
    g[s.i].niveaux.push(s.niveau); g[s.i].iRetour = Math.min(g[s.i].iRetour, s.iRetour);
    g[s.i].meche = Math.min(g[s.i].meche, s.meche); g[s.i].grab = g[s.i].grab && s.grab; // grab seulement si aucun simple balayage
  }
  return Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return a.i - b.i; });
}
// Le vrai balayage prend l'extrême de toute la structure (pas un petit creux interne).
function estExtreme(bs, i, meche, N, tol) {
  let mn = Infinity; for (let q = Math.max(0, i - N); q < i; q++) mn = Math.min(mn, bs[q].l);
  return meche <= mn + tol;
}
// Inducement (le piège) : avant le vrai balayage, le prix a pris un petit creux interne
// (au-dessus de la vraie liquidité) pour attirer les acheteurs trop tôt ; leurs stops sont
// ensuite pris par le vrai balayage.
function inducement(bs, iBal, meche, atr) {
  const creux = pivots(bs, 1).filter(function (p) { return p.type === 'L' && p.i >= iBal - 40 && p.i <= iBal - 3 && p.p > meche + 0.2 * atr; });
  for (let k = creux.length - 1; k >= 0; k--) {
    const c = creux[k];
    for (let q = c.i + 2; q < iBal; q++) if (bs[q].l < c.p) return c;
  }
  return null;
}
// OB + FVG superposés : un OB (ou breaker) et un FVG (ou IFVG / BPR) qui se chevauchent = zone à fort potentiel.
function obEtFvgSuperposes(zs) {
  const obs = zs.filter(function (z) { return z.type === 'OB' || z.type === 'Breaker'; });
  const fvgs = zs.filter(function (z) { return z.type === 'FVG' || z.type === 'IFVG' || z.type === 'BPR'; });
  for (const a of obs) for (const b of fvgs) if (Math.min(a.haut, b.haut) > Math.max(a.bas, b.bas)) return a.type + ' ' + a.ut + ' + ' + b.type + ' ' + b.ut;
  return null;
}
function importance(nv) {
  if (nv.ut === 'MN' || nv.ut === 'W1') return 4;
  if (nv.ut === 'D1') return 3;
  if (nv.touches >= 2 || /session|range|biais/.test(nv.genre)) return 2;
  return 1;
}

// ======================================================================================
// Confirmations : RSI, divergences, volume, SMT
// ======================================================================================
// Divergence haussière : prix plus bas, RSI plus haut (sur les derniers creux avant iMax).
function divergence(bs, rsi, L, recul, iMax) {
  const creux = pivots(bs, L).filter(function (p) { return p.type === 'L' && p.i <= iMax && p.i >= iMax - recul && Number.isFinite(rsi[p.i]); }).slice(-3);
  let nb = 0;
  for (let k = creux.length - 1; k >= 1; k--) { if (creux[k].p < creux[k - 1].p && rsi[creux[k].i] > rsi[creux[k - 1].i]) nb++; else break; }
  return nb;
}
// RSI qui sort de sa zone neutre (40-60) par le haut, en venant de 50 ou en dessous.
function rsiSortieZoneNeutre(rsi, n, fenetre) {
  if (!(rsi[n - 1] > 60)) return false;
  for (let j = n - 2; j >= Math.max(0, n - fenetre); j--) if (rsi[j] <= 50) return true;
  return false;
}
function volumeMoyen(bs, i, n) { let s = 0, k = 0; for (let q = Math.max(0, i - n); q < i; q++) { s += bs[q].v; k++; } return k ? s / k : 0; }
// SMT : notre actif fait un plus bas plus bas (balayage) mais l'actif corrélé ne le fait pas.
function smt(M15, C15, iBal, recul) {
  if (!C15 || C15.length < recul) return false;
  const parT = new Map(); C15.forEach(function (b, i) { parT.set(b.t, i); });
  const deb = Math.max(0, iBal - recul), fin = Math.min(M15.length - 1, iBal + 2);
  let refA = Infinity, minA = Infinity, refB = Infinity, minB = Infinity, vus = 0;
  for (let q = deb; q <= fin; q++) {
    const avant = q < iBal - 2;
    if (avant) refA = Math.min(refA, M15[q].l); else minA = Math.min(minA, M15[q].l);
    const j = parT.get(M15[q].t); if (j === undefined) continue; vus++;
    if (avant) refB = Math.min(refB, C15[j].l); else minB = Math.min(minB, C15[j].l);
  }
  return vus >= 0.7 * (fin - deb + 1) && minA < refA && minB > refB;
}
function retracement(A, B, prix) { return (B - prix) / (B - A); }

// ======================================================================================
// Lecture d'un côté (achat sur le graphique normal ; vente = achat sur le miroir)
// Le bot ne suit pas une checklist : il cherche une HISTOIRE de marché cohérente.
//   1. Un CONTEXTE H4 ou H1 qui donne la direction. Plusieurs lectures possibles :
//        - tendance : jambe qui casse la structure (BOS / CHoCH) puis retour en décote (OTE) ;
//        - AMD : range, mèche qui liquide le range dans une zone d'intérêt, déplacement opposé ;
//        - cassure : bougie de déplacement qui casse un range horizontal ou diagonal et clôture dehors.
//      Un contexte H1 doit aller dans le sens du H4 (ou H4 sans direction).
//   2. Une RÉACTION M15 dans ce contexte : creux de réaction dans la zone, MSS avec déplacement.
//      Il faut au moins une prise de liquidité dans l'histoire (au M15 ou sur le contexte).
//   3. Une ENTRÉE propre : ordre limite au 50 % du FVG (ou de l'OB) du déplacement, 2R au moins.
// Le reste (zones, OTE, confirmation H1, SMT, volume, RSI, Judas swing, Power of 3...) = confirmations :
// notées dans le journal, elles ne bloquent jamais un trade.
// ======================================================================================

// Range juste avant la bougie j : 16 bougies dans moins de 3,5 ATR, au moins 2 touches de chaque bord.
function rangeAvant(bs, j, atr) {
  const W = 16;
  for (let e = j - 1; e >= Math.max(W, j - 3); e--) {
    let hi = -Infinity, lo = Infinity;
    for (let i = e - W + 1; i <= e; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
    if (hi - lo > 3.5 * atr || hi - lo < 0.8 * atr) continue;
    let th = 0, tl = 0;
    for (let i = e - W + 1; i <= e; i++) { if (bs[i].h >= hi - 0.2 * atr) th++; if (bs[i].l <= lo + 0.2 * atr) tl++; }
    if (th < 2 || tl < 2) continue;
    let sorti = false; for (let i = e + 1; i < j; i++) if (bs[i].c > hi || bs[i].c < lo) sorti = true;
    if (sorti) continue;
    return { debut: e - W + 1, fin: e, haut: hi, bas: lo };
  }
  return null;
}
// Ligne de tendance baissière (range diagonal) juste avant la bougie j : au moins 3 sommets alignés,
// aucune clôture au-dessus avant j.
function ligneBaissiere(bs, j, atr) {
  const som = pivots(bs.slice(0, j), 2).filter(function (p) { return p.type === 'H' && p.i >= j - 80; }).slice(-6);
  let best = null;
  for (let a = 0; a < som.length; a++) for (let b = a + 1; b < som.length; b++) {
    const A = som[a], B = som[b];
    if (B.i - A.i < 4) continue;
    const pente = (B.p - A.p) / (B.i - A.i);
    if (pente > -0.02 * atr) continue;
    let touches = 0; for (const P of som) if (P.i >= A.i && Math.abs(A.p + pente * (P.i - A.i) - P.p) <= 0.25 * atr) touches++;
    if (touches < 3) continue;
    let casse = false; for (let q = A.i; q < j && !casse; q++) if (bs[q].c > A.p + pente * (q - A.i) + 0.1 * atr) casse = true;
    if (casse) continue;
    if (!best || touches > best.touches || (touches === best.touches && B.i > best.B.i)) best = { A: A, B: B, pente: pente, touches: touches };
  }
  if (!best) return null;
  let bas = Infinity; for (let q = best.A.i; q < j; q++) bas = Math.min(bas, bs[q].l);
  return { prix: best.A.p + best.pente * (j - best.A.i), touches: best.touches, bas: bas, debut: best.A.i };
}

function analyserCote(d, dc, S, ctx, R) {
  const mot = S > 0
    ? { achat: 'achat', haussier: 'haussier', baissier: 'baissier', haussiere: 'haussière', decote: 'décote', prime: 'prime', bas: 'plus bas', baissiere: 'baissière' }
    : { achat: 'vente', haussier: 'baissier', baissier: 'haussier', haussiere: 'baissière', decote: 'prime', prime: 'décote', bas: 'plus haut', baissiere: 'haussière' };
  function P(x) { return Number.isFinite(x) ? +(S * x).toFixed(ctx.decimales) : null; }
  function T(t) { return t === 'haussier' ? mot.haussier : t === 'baissier' ? mot.baissier : 'neutre'; }
  const histoire = [], raisons = [];
  const res = { sens: S > 0 ? 'buy' : 'sell', ok: false, raisons: raisons, histoire: histoire, points: [], note: 0 };

  const M15 = d.M15, H1 = d.H1, H4 = d.H4, D1 = d.D1, W1 = d.W1, MN = d.MN;
  const n15 = M15.length, n1 = H1.length, n4 = H4.length;
  const prix = M15[n15 - 1].c;
  const atr15 = dernier(atrSerie(M15, 14)), atr1 = dernier(atrSerie(H1, 14)), atr4 = dernier(atrSerie(H4, 14));

  // ---------------- 1. VISION HTF : Monthly, Weekly, Daily (vision du marché, ne bloque rien) ----------------
  const lMN = lireUT(MN, 1, 12), lW1 = lireUT(W1, 2, 10), lD1 = lireUT(D1, 2, 20);
  function v(l) { return l.tendance === 'haussier' ? 1 : l.tendance === 'baissier' ? -1 : 0; }
  const scoreHTF = (1.5 * v(lMN) + 3 * v(lW1) + 3 * v(lD1)) / 7.5;
  const biais = scoreHTF >= 0.3 ? 'aligné' : scoreHTF <= -0.3 ? 'contraire' : 'neutre';
  const pivD = pivots(D1, 3);
  const hD = pivD.filter(function (p) { return p.type === 'H'; }).slice(-1)[0], lD = pivD.filter(function (p) { return p.type === 'L'; }).slice(-1)[0];
  const enDecote = hD && lD ? prix < (hD.p + lD.p) / 2 : null;
  histoire.push('Vision HTF : Monthly ' + T(lMN.tendance) + ', Weekly ' + T(lW1.tendance) + ', Daily ' + T(lD1.tendance) +
    (enDecote === null ? '' : ' ; le prix est en ' + (enDecote ? mot.decote : mot.prime) + ' du dealing range Daily') + '.');

  // Liquidité de toutes les unités de temps, et zones
  const ses = sessions(M15, ctx.maintenant, d.inverse);
  const niveaux = niveauxPeriodes(d).concat(ses.niveaux)
    .concat(niveauxPivots(D1, 2, 'D1', 120, d.inverse)).concat(niveauxPivots(W1, 2, 'W1', 60, d.inverse))
    .concat(niveauxPivots(H4, 2, 'H4', 150, d.inverse)).concat(niveauxPivots(H1, 2, 'H1', 200, d.inverse))
    .concat(niveauxPivots(M15, 2, 'M15', 200, d.inverse));
  const series = [D1, H4, M15];
  const zD1 = zones(D1, 'D1', Math.max(0, D1.length - 150)), zW1 = zones(W1, 'W1', 0);
  const zH4 = zones(H4, 'H4', Math.max(0, n4 - 200)), zH1 = zones(H1, 'H1', Math.max(0, n1 - 200)), zM15 = zones(M15, 'M15', Math.max(0, n15 - 300));
  // toutes les zones d'intérêt avec leur heure de formation
  const SER = { W1: W1, D1: D1, H4: H4, H1: H1 };
  const zonesT = zW1.concat(zD1, zH4, zH1).map(function (z) { return Object.assign({ t: SER[z.ut][z.i].t }, z); });
  function zonesSous(p, tol, avantT, uts) {
    return zonesT.filter(function (z) { return z.role === 'achat' && uts.indexOf(z.ut) >= 0 && z.t < avantT && p <= z.haut + tol && p >= z.bas - tol; });
  }
  const nomsZ = function (zs) { return uniques(zs.map(function (z) { return z.type + ' ' + z.ut; })).join(', '); };

  // Point B (DOL) : liquidité HTF intacte au-dessus du prix
  const cibles = niveaux.filter(function (nv) { return nv.cote === 'H' && prixNiveau(nv, ctx.maintenant) > prix && !dejaPris(nv, series); });
  const dol = cibles.filter(function (nv) { return nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1'; })
    .sort(function (a, b) { return prixNiveau(a, ctx.maintenant) - prixNiveau(b, ctx.maintenant); })[0] || null;
  if (dol) histoire.push('Point B visé (DOL) : ' + dol.genre + ' à ' + P(prixNiveau(dol, ctx.maintenant)) + '.');

  // ---------------- 2. CONTEXTES H4 et H1 ----------------
  const l4 = lireUT(H4, 2, 20);
  const UTS = [
    { ut: 'H4', bs: H4, atr: atr4, z: zH4, recul: 30, fenetreLeg: R.fenetreLegH4, zonesUT: ['H4', 'D1', 'W1'] },
    { ut: 'H1', bs: H1, atr: atr1, z: zH1, recul: 48, fenetreLeg: 80, zonesUT: ['H1', 'H4', 'D1', 'W1'] }
  ];

  // a) Tendance : jambe A -> B qui casse la structure, puis retour en décote
  function contexteTendance(c) {
    const bs = c.bs, n = bs.length, atr = c.atr;
    let iB = -1, B = -Infinity;
    for (let i = Math.max(0, n - c.fenetreLeg); i < n; i++) if (bs[i].h >= B) { B = bs[i].h; iB = i; }
    let iA = -1, A = Infinity;
    for (let i = Math.max(0, iB - 80); i < iB; i++) if (bs[i].l < A) { A = bs[i].l; iA = i; }
    if (iA < 0 || iB - iA < 3 || B - A < 2 * atr) return { echec: 'pas de jambe ' + mot.haussiere + ' nette' };
    const st = structure(bs, 2);
    const evts = st.evts.filter(function (e) { return e.dir === 1 && e.i > iA && e.i <= iB + 1; });
    if (!evts.length) return { echec: 'la jambe n\'a cassé aucune structure (ni BOS ni CHoCH)' };
    for (let i = iB + 1; i < n; i++) if (bs[i].c < A) return { echec: 'clôture sous le point A' };
    const finMouvement = niveaux.filter(function (nv) {
      if (nv.cote !== 'H' || nv.t0 > bs[iB].t || !(nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1' || /égaux|résistance|range/.test(nv.genre))) return false;
      const p = prixNiveau(nv, bs[iB].t);
      return bs[iB].h > p && (bs[iB].c < p || (iB + 1 < n && bs[iB + 1].c < p));
    });
    if (finMouvement.length) return { echec: 'point B a déjà balayé ' + finMouvement[0].genre + ' : mouvement terminé' };
    const balA = grouperBalayages(balayagesBas(bs, niveaux.filter(function (nv) { return nv.t0 <= bs[iA].t; }), atr, Math.max(1, iA - 1))
      .filter(function (s) { return s.i >= iA - 1 && s.i <= iA + 1; }))[0] || null;
    const conf = ['structure ' + c.ut + ' cassée (' + evts[evts.length - 1].type + ')'];
    if (iA >= 12) { let hi = -Infinity, lo = Infinity; for (let q = iA - 12; q < iA; q++) { hi = Math.max(hi, bs[q].h); lo = Math.min(lo, bs[q].l); } if (hi - lo <= 4 * atr && balA) conf.push('AMD ' + c.ut + ' au point A'); }
    return { type: 'tendance', ut: c.ut, A: A, B: B, zoneBas: A - 1.0 * atr, zoneHaut: A + 0.5 * (B - A), invalidation: A,
      liquidite: balA ? balA.niveaux.map(function (x) { return x.genre; }) : [], conf: conf, cle: c.ut + '|tendance|' + bs[iA].t,
      recit: 'tendance ' + c.ut + ' : jambe ' + mot.haussiere + ' de ' + P(A) + ' à ' + P(B) + ' (' + uniques(evts.map(function (e) { return e.type; })).join(', ') + ')' +
        (balA ? ', le point A a balayé ' + balA.niveaux.slice(0, 3).map(function (x) { return x.genre; }).join(' + ') : '') };
  }

  // b) AMD : range (accumulation), mèche qui liquide le bas du range dans une zone d'intérêt (manipulation),
  //    puis bougie de déplacement dans l'autre sens (distribution).
  function contexteAMD(c) {
    const bs = c.bs, n = bs.length, atr = c.atr;
    for (let j = n - 1; j >= Math.max(30, n - c.recul); j--) {
      const rg = rangeAvant(bs, j, atr); if (!rg) continue;
      const b = bs[j];
      if (!(b.l < rg.bas - 0.05 * atr)) continue;
      const iRet = b.c > rg.bas ? j : (j + 1 < n && bs[j + 1].c > rg.bas ? j + 1 : -1);
      if (iRet < 0) continue;
      const meche = Math.min(b.l, bs[iRet].l);
      const cm = moyenne(bs.slice(Math.max(0, j - 20), j).map(corps));
      let iDep = -1; for (let q = j; q <= Math.min(n - 1, j + 4); q++) if (bs[q].c > bs[q].o && corps(bs[q]) >= 1.5 * cm && bs[q].c > (rg.haut + rg.bas) / 2) { iDep = q; break; }
      if (iDep < 0) continue;
      let mort = false; for (let q = iRet; q < n; q++) if (bs[q].c < meche) { mort = true; break; }
      if (mort) continue;
      const zi = zonesSous(meche, 0.2 * atr, bs[rg.debut].t, c.zonesUT);
      if (!zi.length) continue; // la manipulation doit se faire dans une zone d'intérêt (formée avant le range)
      let B = -Infinity; for (let q = j; q < n; q++) B = Math.max(B, bs[q].h);
      return { type: 'AMD', ut: c.ut, A: meche, B: B, zoneBas: meche - 0.3 * atr, zoneHaut: Math.max(rg.haut, meche + 0.5 * (B - meche)), invalidation: meche,
        liquidite: ['bas de range ' + c.ut], conf: ['AMD ' + c.ut + ' dans ' + nomsZ(zi)], cle: c.ut + '|AMD|' + bs[j].t,
        recit: 'AMD ' + c.ut + ' : range ' + P(rg.bas) + ' - ' + P(rg.haut) + ', mèche qui liquide le bas du range à ' + P(meche) + ' dans ' + nomsZ(zi) + ', puis déplacement ' + mot.haussier };
    }
    return null;
  }

  // c) Cassure : bougie de déplacement qui casse un range horizontal ou diagonal et clôture dehors.
  //    Le diagonal est meilleur : toute la liquidité accumulée le long de la ligne est derrière.
  function contexteCassure(c) {
    const bs = c.bs, n = bs.length, atr = c.atr;
    for (let j = n - 1; j >= Math.max(30, n - c.recul); j--) {
      const b = bs[j];
      const cm = moyenne(bs.slice(Math.max(0, j - 20), j).map(corps));
      if (!(b.c > b.o && corps(b) >= 1.5 * cm)) continue;
      let niv = null, bas = null, genre = '';
      const rg = rangeAvant(bs, j, atr);
      if (rg && b.c > rg.haut + 0.1 * atr) { niv = rg.haut; bas = rg.bas; genre = 'range horizontal'; }
      else {
        const lg = ligneBaissiere(bs, j, atr);
        if (lg && b.c > lg.prix + 0.1 * atr) { niv = lg.prix; bas = lg.bas; genre = 'range diagonal (ligne ' + mot.baissiere + ', ' + lg.touches + ' touches)'; }
      }
      if (niv === null) continue;
      let mort = false; for (let q = j + 1; q < n; q++) if (bs[q].c < niv - 0.5 * atr) { mort = true; break; } // retour dans le range : fausse cassure
      if (mort) continue;
      let B = -Infinity; for (let q = j; q < n; q++) B = Math.max(B, bs[q].h);
      return { type: 'cassure', ut: c.ut, A: bas, B: B, zoneBas: niv - 0.5 * atr, zoneHaut: niv + 0.5 * (B - niv), invalidation: bas, diagonal: /diagonal/.test(genre),
        liquidite: ['liquidité au-dessus du ' + genre + ' ' + c.ut], conf: ['cassure ' + genre + ' ' + c.ut + ' par déplacement'], cle: c.ut + '|cassure|' + bs[j].t,
        recit: 'cassure ' + c.ut + ' du ' + genre + ' à ' + P(niv) + ' par une bougie de déplacement qui clôture dehors' };
    }
    return null;
  }

  // Direction du H4 : une jambe H4 valide (structure cassée, point A tenu) donne la direction,
  // même pendant son retracement ; sinon la lecture des sommets / creux.
  const contextes = [], echecs = [];
  let dirH4 = l4.tendance;
  for (const c of UTS) {
    if (c.ut === 'H1') {
      if (contextes.some(function (x) { return x.ut === 'H4' && x.type === 'tendance'; })) dirH4 = 'haussier';
      histoire.push('Direction H4 : ' + (dirH4 === 'range' ? 'pas de direction nette' : T(dirH4)) + '.');
      if (dirH4 === 'baissier') { echecs.push('H1 : contre la direction du H4, ignoré'); continue; }
    }
    const t = contexteTendance(c);
    if (t.echec) echecs.push('tendance ' + c.ut + ' : ' + t.echec); else contextes.push(t);
    const a = contexteAMD(c); if (a) contextes.push(a);
    const k = contexteCassure(c); if (k) contextes.push(k);
  }
  if (!contextes.length) { raisons.push('Aucun contexte H4 / H1 lisible (' + echecs.join(' ; ') + ').'); return res; }

  // ---------------- 3. RÉACTION M15 + ENTRÉE, pour chaque contexte ----------------
  // H1 en range juste avant l'instant t : bougies serrées et sans direction (efficacité faible)
  function rangeH1(t) {
    const g = R.rangeH1;
    let fin = -1; for (let i = n1 - 1; i >= 0; i--) if (H1[i].t + DUREE.H1 <= t) { fin = i; break; }
    if (fin < g.bougies) return null;
    let hi = -Infinity, lo = Infinity, chemin = 0;
    for (let i = fin - g.bougies + 1; i <= fin; i++) { hi = Math.max(hi, H1[i].h); lo = Math.min(lo, H1[i].l); if (i > fin - g.bougies + 1) chemin += Math.abs(H1[i].c - H1[i - 1].c); }
    const eff = chemin > 0 ? Math.abs(H1[fin].c - H1[fin - g.bougies + 1].c) / chemin : 0;
    return (hi - lo <= g.largeurAtr * atr1 && eff < g.efficacite) ? { haut: hi, bas: lo } : null;
  }
  function enKZ(t) { const h = ny(t).hm; return R.killzones.filter(function (k) { return h >= k.debut && h < k.fin; })[0] || null; }
  const rsi15 = rsiSerie(M15, 14), rsi1 = rsiSerie(H1, 14);
  function essayer(k) {
    const points = []; let note = 0;
    function pts(nb, quoi) { if (nb > 0) { note += nb; points.push('+' + nb + ' ' + quoi); } }
    const r = { ok: false, points: points, note: 0 };
    function stop(msg) { r.raison = k.recit + ' -> ' + msg; r.note = note; return r; }
    // clé d'un trade = contexte # réaction M15 : on ne retrade ni le même contexte, ni la même réaction M15
    const deja = ctx.legsDejaTradees.map(function (x) { return String(x).split('#'); });
    if (deja.some(function (x) { return x[0] === k.cle + '|' + res.sens; })) return stop('ce mouvement a déjà été tradé.');
    // le creux de réaction M15 : extrême des 40 bougies précédentes, dans la zone du contexte, jamais repris
    let iA = -1;
    for (let i = n15 - 1; i >= Math.max(41, n15 - R.fenetreBalayageM15); i--) {
      const lo = M15[i].l;
      if (lo < k.zoneBas || lo > k.zoneHaut || !estExtreme(M15, i, lo, 40, 0.1 * atr15)) continue;
      let repris = false; for (let q = i + 1; q < n15; q++) if (M15[q].l < lo) { repris = true; break; }
      if (!repris) iA = i;
      break;
    }
    if (iA < 0) return stop('pas encore de réaction M15 dans la zone (' + P(k.zoneBas) + ' - ' + P(k.zoneHaut) + ').');
    const A15 = M15[iA].l;
    if (deja.some(function (x) { return x[1] === 'M15|' + M15[iA].t + '|' + res.sens; })) return stop('cette réaction M15 a déjà été tradée.');
    const bal = grouperBalayages(balayagesBas(M15, niveaux, atr15, Math.max(1, iA - 3)))
      .filter(function (g) { return g.i >= iA - 3 && g.i <= iA && g.meche <= A15 + 1e-9; }).slice(-1)[0] || null;
    if (!bal && !k.liquidite.length) return stop('aucune prise de liquidité dans l\'histoire : la Smart Money ne s\'est pas montrée.');
    const i0 = bal ? bal.i : iA;
    const sommetsAvant = pivots(M15, R.mssPivot).filter(function (p) { return p.type === 'H' && p.i + R.mssPivot <= i0; });
    if (!sommetsAvant.length) return stop('pas de sommet M15 de référence pour le MSS.');
    const ref = sommetsAvant[sommetsAvant.length - 1];
    let iMSS = -1; for (let j = iA; j < n15; j++) if (M15[j].c > ref.p) { iMSS = j; break; }
    if (iMSS < 0) return stop('réaction M15 à ' + P(A15) + ', on attend le MSS (clôture au-delà de ' + P(ref.p) + ').');
    if (iMSS < n15 - R.fraicheurMSS) return stop('le MSS M15 date de plus de ' + (R.fraicheurMSS / 4) + ' h : signal périmé.');
    const corpsMoy15 = moyenne(M15.slice(Math.max(0, i0 - 20), i0).map(corps));
    let iDep = -1; for (let q = i0; q <= iMSS; q++) if (M15[q].c > M15[q].o && corps(M15[q]) >= 1.5 * corpsMoy15) iDep = q;
    if (iDep < 0) return stop('MSS M15 sans vrai déplacement (pas de grande bougie).');
    // Pas de trade dans un range : si le H1 était en range avant la réaction, le MSS doit faire sortir le prix du range.
    const boite = rangeH1(M15[i0].t);
    if (boite && M15[iMSS].c <= boite.haut) return stop('le marché est en range H1 (' + P(boite.bas) + ' - ' + P(boite.haut) + ') et le MSS n\'en est pas sorti : entrée prématurée, on attend.');
    const kz = enKZ(M15[iMSS].t);
    if (!ctx.crypto && (!kz || !enKZ(ctx.maintenant))) return stop('hors killzone (Londres 02h-05h, New York 07h-11h, heure de NY) : pas d\'ordre.');

    // Entrée : ordre limite au FVG (sinon BPR, sinon OB) du déplacement
    let B15 = -Infinity; for (let j = iMSS; j < n15; j++) B15 = Math.max(B15, M15[j].h);
    const dansJambe = function (z) { return z.role === 'achat' && z.i >= i0 && z.i <= Math.min(n15 - 1, iMSS + 2); };
    const fvgs = zM15.filter(function (z) { return z.type === 'FVG' && dansJambe(z); }).concat(zM15.filter(function (z) { return z.type === 'BPR' && dansJambe(z); }))
      .sort(function (a, b) { return (a.type === 'FVG' ? 0 : 1) - (b.type === 'FVG' ? 0 : 1) || Math.abs(a.i - iMSS) - Math.abs(b.i - iMSS); });
    const obs = zM15.filter(function (z) { return z.type === 'OB' && z.role === 'achat' && z.iOrigine >= i0 - 1 && z.i <= iMSS + 1; });
    let zoneEntree, typeEntree;
    if (fvgs.length) { zoneEntree = fvgs[0]; typeEntree = zoneEntree.type + ' M15 (50 %)'; }
    else if (obs.length) { zoneEntree = obs[obs.length - 1]; typeEntree = 'OB M15 (50 %)'; }
    else return stop('MSS sans FVG ni OB M15 pour placer l\'ordre limite.');
    const entree = (zoneEntree.bas + zoneEntree.haut) / 2;
    for (let j = zoneEntree.i + 1; j < n15; j++) if (M15[j].l <= entree) return stop('le prix est déjà revenu sur l\'entrée (' + P(entree) + ') : ordre manqué, on ne court pas après.');
    // stop derrière la réaction M15, et au moins à 1 ATR H1 de l'entrée (le bruit ne doit pas le toucher)
    const stopPx = Math.min(A15 - R.margeStopAtr * atr15, entree - R.stopMinAtrH1 * atr1);
    const risque = entree - stopPx;
    if (!(risque > 0.2 * atr15)) return stop('stop trop serré par rapport à l\'entrée.');
    if (risque > 3 * atr4) return stop('stop trop large (plus de 3 ATR H4).');
    const tps = cibles.map(function (nv) { return { p: prixNiveau(nv, ctx.maintenant), nom: nv.genre, poids: importance(nv) }; })
      .concat(k.B > entree ? [{ p: k.B, nom: 'point B ' + k.ut, poids: 3 }] : [])
      .filter(function (x) { return (x.p - entree) / risque >= R.rrMin; })
      .sort(function (a, b) { return a.p - b.p; });
    if (!tps.length) return stop('pas de liquidité en face à au moins ' + R.rrMin + 'R.');
    const tp1 = tps[0];
    const pDol = dol ? prixNiveau(dol, ctx.maintenant) : null;
    const tp2 = (pDol !== null && pDol > tp1.p + 0.5 * risque ? { p: pDol, nom: dol.genre + ' (point B HTF)' } : null) ||
      tps.filter(function (x) { return x.p > tp1.p + 0.5 * risque && x.poids >= 2; }).slice(k.diagonal ? -1 : 0)[0] || null;

    // ----- Confirmations (notées, jamais bloquantes) -----
    k.conf.forEach(function (x) { pts(1, x); });
    if (k.liquidite.length) pts(2, 'liquidité prise sur le contexte ' + k.ut + ' : ' + k.liquidite.slice(0, 3).join(' + '));
    const rHTF = retracement(k.A, k.B, A15);
    const oteHTF = k.type !== 'cassure' && rHTF >= 0.62 && rHTF <= 0.79;
    if (oteHTF) pts(2, 'réaction dans l\'OTE ' + k.ut + ' (' + rHTF.toFixed(2) + ')');
    const zR = zonesSous(A15, 0.2 * atr4, ctx.maintenant, ['H1', 'H4', 'D1', 'W1']);
    if (zR.length) pts(2, 'réaction dans une zone d\'intérêt : ' + nomsZ(zR));
    if (obEtFvgSuperposes(zR)) pts(1, 'OB + FVG superposés (' + obEtFvgSuperposes(zR) + ')');
    const b0 = M15[i0];
    if (bal) {
      pts(2, (bal.grab ? 'liquidity grab M15 (fausse cassure reprise) : ' : 'balayage M15 : ') + bal.niveaux.slice(0, 3).map(function (x) { return x.genre; }).join(' + '));
      if (bal.niveaux.length >= 2 || bal.niveaux.some(function (x) { return importance(x) >= 2; })) pts(1, 'liquidité cumulée / importante balayée');
      if (bal.niveaux.some(function (x) { return /session Asie/.test(x.genre); })) pts(1, 'Judas swing : liquidité de l\'Asie balayée');
      const idm = inducement(M15, bal.i, bal.meche, atr15);
      if (idm) pts(1, 'inducement pris avant le vrai balayage (' + P(idm.p) + ')');
    }
    if (Math.min(b0.o, b0.c) - b0.l >= 0.4 * (b0.h - b0.l)) pts(1, 'mèche de liquidation');
    if (ses.ouvertureMinuit !== null && ny(b0.t).jour === ses.jourMinuit && A15 < ses.ouvertureMinuit) pts(1, 'Power of 3 : manipulation ' + (S > 0 ? 'sous' : 'au-dessus de') + ' l\'ouverture de minuit');
    if (kz) pts(1, 'MSS en killzone ' + kz.nom);
    // confirmation H1 au même endroit : rejet, CHoCH ou FVG
    const tA = M15[iA].t;
    const i1 = H1.findIndex(function (b) { return b.t <= tA && tA < b.t + DUREE.H1; });
    if (i1 >= 0) {
      const b1 = H1[i1], confH1 = [];
      if (Math.min(b1.o, b1.c) - b1.l >= 0.4 * (b1.h - b1.l) && b1.c >= (b1.h + b1.l) / 2) confH1.push('rejet H1');
      const r1 = pivots(H1, 2).filter(function (p) { return p.type === 'H' && p.i + 2 <= i1; }).slice(-1)[0];
      if (r1) for (let j = i1; j < n1; j++) if (H1[j].c > r1.p) { confH1.push('CHoCH H1'); break; }
      if (zH1.some(function (z) { return z.type === 'FVG' && z.role === 'achat' && z.i >= i1; })) confH1.push('FVG H1 ' + mot.haussier);
      if (confH1.length) pts(1, 'confirmation H1 : ' + confH1.join(', '));
      if (divergence(H1, rsi1, 2, 60, i1 + 2) >= 1) pts(1, 'divergence RSI H1');
    }
    const vMoy = volumeMoyen(M15, i0, 20);
    if (vMoy > 0 && (M15[iDep].v >= 1.3 * vMoy || b0.v >= 1.3 * vMoy)) pts(2, 'volume fort sur le balayage / déplacement');
    if (dc && smt(M15, dc.M15, i0, 40)) pts(2, 'SMT : ' + ctx.correle + ' n\'a pas fait de ' + mot.bas);
    if (divergence(M15, rsi15, 2, 60, i0 + 2) >= 1) pts(1, 'divergence RSI M15');
    if (rsiSortieZoneNeutre(rsi15, n15, 12)) pts(1, 'RSI sort de sa zone neutre');
    const r15 = retracement(A15, B15, entree);
    if (r15 >= 0.5) pts(1, 'entrée dans l\'OTE M15 (' + r15.toFixed(2) + ')');
    if ((tp1.p - entree) / risque >= 3) pts(1, 'TP1 à 3R ou plus');
    if (biais === 'aligné') pts(1, 'dans le sens du Monthly / Weekly / Daily');

    // A+++ : tendance + retour dans l'OTE dans une zone d'intérêt + mèche de liquidation, et la même chose au M15
    const grade = (k.type === 'tendance' && oteHTF && zR.length && bal && r15 >= 0.5) ? 'A+++' : 'A++';
    r.ok = true; r.note = note; r.grade = grade; r.contexte = k;
    r.entree = entree; r.stopPx = stopPx; r.risque = risque; r.typeEntree = typeEntree; r.tp1 = tp1; r.tp2 = tp2; r.kz = kz;
    r.bal = bal; r.A15 = A15; r.iA = iA; r.zR = zR; r.rHTF = rHTF; r.ref = ref;
    return r;
  }

  const essais = contextes.map(essayer);
  const bons = essais.filter(function (x) { return x.ok; })
    .sort(function (a, b) { return (b.grade === 'A+++' ? 1 : 0) - (a.grade === 'A+++' ? 1 : 0) || b.note - a.note; });
  if (!bons.length) {
    essais.forEach(function (x) { raisons.push(x.raison); });
    res.note = Math.max.apply(null, essais.map(function (x) { return x.note; }));
    return res;
  }
  const t = bons[0], k = t.contexte;
  histoire.push('Contexte : ' + k.recit + '.');
  histoire.push('M15 : ' + (t.bal ? 'balayage de ' + t.bal.niveaux.slice(0, 3).map(function (x) { return x.genre; }).join(' + ') + ' (mèche ' + P(t.bal.meche) + ')' : 'réaction à ' + P(t.A15)) +
    ', MSS ' + (t.kz ? 'en killzone ' + t.kz.nom + ' ' : '') + 'avec déplacement au-delà de ' + P(t.ref.p) + '.');
  res.ok = true; res.note = t.note; res.points = t.points; res.grade = t.grade;
  res.entree = P(t.entree); res.stop = P(t.stopPx); res.typeEntree = t.typeEntree;
  res.tp1 = P(t.tp1.p); res.tp1Nom = t.tp1.nom; res.rr1 = +((t.tp1.p - t.entree) / t.risque).toFixed(2);
  res.tp2 = t.tp2 ? P(t.tp2.p) : null; res.tp2Nom = t.tp2 ? t.tp2.nom : null; res.rr2 = t.tp2 ? +((t.tp2.p - t.entree) / t.risque).toFixed(2) : null;
  res.scenario = k.type + ' ' + k.ut; res.pointA = P(k.A); res.pointB = P(k.B); res.cleMouvement = k.cle + '|' + res.sens + '#M15|' + M15[t.iA].t + '|' + res.sens;
  res.killzone = t.kz ? t.kz.nom : 'hors killzone (crypto 24h/24)';
  // L'ordre limite expire à la fin de la killzone en cours (cryptos : au bout de quelques heures)
  let expire = ctx.maintenant + R.dureeOrdreCrypto * 3600000;
  if (!ctx.crypto && t.kz) { expire = ctx.maintenant; while (ny(expire).hm < t.kz.fin && expire < ctx.maintenant + 6 * 3600000) expire += 5 * 60000; }
  res.expireA = new Date(expire).toISOString();
  res.biais = biais;
  res.liquidite = (t.bal ? t.bal.niveaux.map(function (x) { return x.genre; }).join(' + ') + ' balayé à ' + P(t.bal.meche) : 'réaction M15 à ' + P(t.A15)) +
    (k.liquidite.length ? ' ; contexte ' + k.ut + ' : ' + k.liquidite.join(' + ') : '');
  res.zone = (t.zR.length ? nomsZ(t.zR) + ' ; ' : '') + (k.type !== 'cassure' ? 'retour ' + k.ut + ' ' + t.rHTF.toFixed(2) + ' ; ' : '') + 'entrée ' + t.typeEntree;
  res.confirmations = t.points.slice();
  histoire.push('Setup ' + t.grade + ' (' + res.scenario + ', ' + t.points.length + ' confirmations). Ordre limite ' + mot.achat + ' à ' + res.entree + ' (' + t.typeEntree + '), stop ' + res.stop +
    ' derrière la réaction M15, TP1 ' + t.tp1.nom + ' ' + res.tp1 + ' (' + res.rr1 + 'R)' + (t.tp2 ? ', TP2 ' + t.tp2.nom + ' ' + res.tp2 + ' (' + res.rr2 + 'R)' : '') + '.');
  return res;
}

function decimalesDe(bs) {
  let d = 0;
  for (const b of bs.slice(-50)) { const s = String(b.c); const k = s.indexOf('.'); if (k >= 0) d = Math.max(d, s.length - k - 1); }
  return Math.min(d, 6);
}

// ======================================================================================
// Point d'entrée : analyse complète d'un actif.
// brut     = { M15, H1, H4, D1, W1, MN } (réponses du bridge)
// correle  = { M15 } de l'actif corrélé (pour la SMT), ou null
// etat     = { legsDejaTradees: [] } ; options = { crypto, correle (nom), reglages }
// ======================================================================================
function analyserActif(symbole, brut, correle, maintenant, etat, options) {
  options = options || {};
  const R = Object.assign({}, REGLAGES, options.reglages || {});
  const d = { maintenant: maintenant };
  ['M15', 'H1', 'H4', 'D1', 'W1', 'MN'].forEach(function (u) { d[u] = preparerBougies(brut[u], u, maintenant); });
  const notes = [];
  // Secours : unités de temps reconstruites si le bridge ne les fournit pas
  if (d.H1.length < R.minBougies.H1 && d.M15.length) { d.H1 = regrouper(d.M15, function (t) { return Math.floor(t / DUREE.H1); }).filter(function (b) { return b.t + DUREE.H1 <= maintenant; }); notes.push('H1 reconstruit depuis le M15'); }
  if (d.D1.length < R.minBougies.D1 && d.H4.length) { d.D1 = regrouper(d.H4, cleJour).filter(function (b) { return b.t + DUREE.D1 <= maintenant; }); notes.push('Daily reconstruit depuis le H4'); }
  if (d.W1.length < R.minBougies.W1 && d.D1.length) { d.W1 = regrouper(d.D1, cleSemaine).filter(function (b) { return b.t + DUREE.W1 <= maintenant + 3 * 86400000; }); notes.push('Weekly reconstruit depuis le Daily'); }
  if (d.MN.length < R.minBougies.MN && d.D1.length) { d.MN = regrouper(d.D1, cleMois); notes.push('Monthly reconstruit depuis le Daily'); }
  const manque = Object.keys(R.minBougies).filter(function (k) { return d[k].length < R.minBougies[k]; });
  if (manque.length) return { symbole: symbole, action: 'attendre', raison: 'Données insuffisantes : ' + manque.map(function (k) { return k + ' (' + d[k].length + ')'; }).join(', '), notes: notes };
  const der = d.M15[d.M15.length - 1];
  if (maintenant - (der.t + DUREE.M15) > 20 * 60000) return { symbole: symbole, action: 'attendre', raison: 'Pas de bougie M15 récente (marché fermé ?).', notes: notes };

  let dc = null;
  if (correle && correle.M15) { const c15 = preparerBougies(correle.M15, 'M15', maintenant); if (c15.length >= 100) dc = { M15: c15 }; }
  const ctx = { maintenant: maintenant, decimales: decimalesDe(d.M15), legsDejaTradees: (etat && etat.legsDejaTradees) || [], crypto: !!options.crypto, correle: options.correle || '' };
  const dm = { maintenant: maintenant, inverse: true };
  ['M15', 'H1', 'H4', 'D1', 'W1', 'MN'].forEach(function (u) { dm[u] = miroir(d[u]); });
  const achat = analyserCote(d, dc, 1, ctx, R);
  const vente = analyserCote(dm, dc ? { M15: miroir(dc.M15) } : null, -1, ctx, R);
  const ok = [achat, vente].filter(function (x) { return x.ok; });
  if (!ok.length) return { symbole: symbole, action: 'attendre', notes: notes, noteAchat: achat.note, noteVente: vente.note,
    raison: 'Achat : ' + achat.raisons.join(' ') + ' | Vente : ' + vente.raisons.join(' '), histoireAchat: achat.histoire, histoireVente: vente.histoire };
  if (ok.length === 2) return { symbole: symbole, action: 'attendre', raison: 'Achat et vente A++ en même temps : lecture incohérente, on s\'abstient.', notes: notes };
  const t = ok[0];
  return Object.assign({ symbole: symbole, action: 'trader', notes: notes, lecture: t.histoire.join(' ') }, t);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyserActif, preparerBougies, structure, zones, pivots, rsiSerie, atrSerie, lireUT, balayagesBas, niveauxPivots, miroir, smt, sessions, ny, inducement, obEtFvgSuperposes, REGLAGES };
}
