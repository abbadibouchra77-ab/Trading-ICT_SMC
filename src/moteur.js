// =====================================================================================
// SMC Vision v2 : moteur de lecture ICT / SMC
// -------------------------------------------------------------------------------------
// Le bot lit le graphique comme une trader, en 4 questions :
//   1. Où va le marché ?            -> Monthly / Weekly / Daily : biais, dealing range, point B (DOL)
//   2. Où la Smart Money entre ?    -> H4 : jambe A->B, balayage de liquidité, OTE, OB/BB/FVG/IFVG/BPR
//   3. Est-ce qu'elle entre ?       -> H1 : réaction dans la zone H4 (rejet, CHoCH, FVG)
//   4. Quand j'entre avec elle ?    -> M15 : en killzone, balayage, MSS avec déplacement et volume,
//                                      ordre LIMITE au FVG (ou à l'OB) du déplacement
// Chaque confluence rapporte des points. Le bot ne trade que les setups A++ (note minimale),
// avec quelques interdits absolus (jamais sans balayage, jamais sous 2R, etc.).
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
  noteMin: 20,             // note minimale pour un setup A++ (sur ~33 points possibles)
  rrMin: 2,                // TP1 à au moins 2R
  margeStopAtr: 0.15,      // marge derrière la mèche du balayage M15, en ATR M15
  fraicheurMSS: 8,         // le MSS M15 doit dater de 8 bougies (2 h) au plus
  fenetreBalayageM15: 48,  // balayage M15 cherché sur les 12 dernières heures
  fenetreLegH4: 60,        // point B H4 cherché sur les 60 dernières bougies H4
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
// Analyse d'un côté (achat sur le graphique normal ; vente = achat sur le miroir)
// ======================================================================================
function analyserCote(d, dc, S, ctx, R) {
  const mot = S > 0
    ? { achat: 'achat', haussier: 'haussier', baissier: 'baissier', haussiere: 'haussière', decote: 'décote', prime: 'prime', bas: 'plus bas' }
    : { achat: 'vente', haussier: 'baissier', baissier: 'haussier', haussiere: 'baissière', decote: 'prime', prime: 'décote', bas: 'plus haut' };
  function P(x) { return Number.isFinite(x) ? +(S * x).toFixed(ctx.decimales) : null; }
  function T(t) { return t === 'haussier' ? mot.haussier : t === 'baissier' ? mot.baissier : 'neutre'; }
  const histoire = [], raisons = [], points = [];
  let note = 0;
  function pts(n, quoi) { if (n > 0) { note += n; points.push('+' + n + ' ' + quoi); } }
  const res = { sens: S > 0 ? 'buy' : 'sell', ok: false, raisons: raisons, histoire: histoire, points: points, note: 0 };
  function stop(msg) { raisons.push(msg); res.note = note; return res; }

  const M15 = d.M15, H1 = d.H1, H4 = d.H4, D1 = d.D1, W1 = d.W1, MN = d.MN;
  const n15 = M15.length, n1 = H1.length, n4 = H4.length;
  const prix = M15[n15 - 1].c;
  const atr15 = dernier(atrSerie(M15, 14)), atr4 = dernier(atrSerie(H4, 14));

  // ---------------- 1. VISION HTF : Monthly, Weekly, Daily ----------------
  const lMN = lireUT(MN, 1, 12), lW1 = lireUT(W1, 2, 10), lD1 = lireUT(D1, 2, 20);
  function v(l) { return l.tendance === 'haussier' ? 1 : l.tendance === 'baissier' ? -1 : 0; }
  const scoreHTF = (1.5 * v(lMN) + 3 * v(lW1) + 3 * v(lD1)) / 7.5;
  const biais = scoreHTF >= 0.3 ? 'aligné' : scoreHTF <= -0.3 ? 'contraire' : 'neutre';
  // Dealing range Daily : du dernier creux majeur au dernier sommet majeur (pivots Daily L=3)
  const pivD = pivots(D1, 3);
  const hD = pivD.filter(function (p) { return p.type === 'H'; }).slice(-1)[0], lD = pivD.filter(function (p) { return p.type === 'L'; }).slice(-1)[0];
  const enDecote = hD && lD ? prix < (hD.p + lD.p) / 2 : null;
  histoire.push('Vision HTF : Monthly ' + T(lMN.tendance) + ', Weekly ' + T(lW1.tendance) + ', Daily ' + T(lD1.tendance) +
    ' ; pour un ' + mot.achat + ', le biais est ' + biais + (enDecote === null ? '' : ', le prix est en ' + (enDecote ? mot.decote : mot.prime) + ' du dealing range Daily') + '.');
  if (biais === 'aligné') pts(3, 'biais HTF aligné'); else if (biais === 'neutre') pts(1, 'biais HTF neutre');
  if (enDecote) pts(1, 'prix en ' + mot.decote + ' (dealing range Daily)');

  // Liquidité de toutes les unités de temps, et zones
  const ses = sessions(M15, ctx.maintenant, d.inverse);
  const niveaux = niveauxPeriodes(d).concat(ses.niveaux)
    .concat(niveauxPivots(D1, 2, 'D1', 120, d.inverse)).concat(niveauxPivots(W1, 2, 'W1', 60, d.inverse))
    .concat(niveauxPivots(H4, 2, 'H4', 150, d.inverse)).concat(niveauxPivots(H1, 2, 'H1', 200, d.inverse))
    .concat(niveauxPivots(M15, 2, 'M15', 200, d.inverse));
  const series = [D1, H4, M15];
  const zD1 = zones(D1, 'D1', Math.max(0, D1.length - 150)), zW1 = zones(W1, 'W1', 0);
  const zH4 = zones(H4, 'H4', Math.max(0, n4 - 200)), zH1 = zones(H1, 'H1', Math.max(0, n1 - 200)), zM15 = zones(M15, 'M15', Math.max(0, n15 - 300));

  // Point B (DOL) : liquidité HTF intacte au-dessus du prix
  const cibles = niveaux.filter(function (nv) { return nv.cote === 'H' && prixNiveau(nv, ctx.maintenant) > prix && !dejaPris(nv, series); });
  const dol = cibles.filter(function (nv) { return nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1'; })
    .sort(function (a, b) { return prixNiveau(a, ctx.maintenant) - prixNiveau(b, ctx.maintenant); })[0] || null;
  if (dol) histoire.push('Point B visé (DOL) : ' + dol.genre + ' à ' + P(prixNiveau(dol, ctx.maintenant)) + '.');

  // ---------------- 2. SETUP H4 ----------------
  const l4 = lireUT(H4, 2, 20);
  // Range H4 non balayé : c'est de la liquidité qui s'accumule, on attend.
  if (l4.enRange) {
    let balaye = false;
    for (let i = n4 - 10; i < n4; i++) if (i > 0) { let mn = Infinity; for (let q = Math.max(0, i - 20); q < i; q++) mn = Math.min(mn, H4[q].l); if (H4[i].l < mn && H4[i].c > mn) balaye = true; }
    if (!balaye) return stop('H4 en range (liquidité qui s\'accumule) : on attend le balayage d\'un bord.');
  }
  // Jambe A -> B : B = extrême atteint, A = mèche extrême d'où part le mouvement
  let iB = -1, B = -Infinity;
  for (let i = Math.max(0, n4 - R.fenetreLegH4); i < n4; i++) if (H4[i].h >= B) { B = H4[i].h; iB = i; }
  let iA = -1, A = Infinity;
  for (let i = Math.max(0, iB - 80); i < iB; i++) if (H4[i].l < A) { A = H4[i].l; iA = i; }
  if (iA < 0 || iB - iA < 3 || B - A < 2 * atr4) return stop('Pas de jambe H4 ' + mot.haussiere + ' nette (point A / point B).');
  const evts = l4.st.evts.filter(function (e) { return e.dir === 1 && e.i > iA && e.i <= iB + 1; });
  if (!evts.length) return stop('La jambe H4 n\'a cassé aucune structure (ni BOS ni CHoCH) : pas de vrai déplacement.');
  for (let i = iB + 1; i < n4; i++) if (H4[i].c < A) return stop('Clôture H4 au-delà du point A : setup annulé.');
  // Le point A a-t-il balayé de la liquidité (manipulation) ?
  const balA = grouperBalayages(balayagesBas(H4, niveaux.filter(function (nv) { return nv.t0 <= H4[iA].t; }), atr4, Math.max(1, iA - 1))
    .filter(function (s) { return s.i >= iA - 1 && s.i <= iA + 1; }))[0] || null;
  // Accumulation avant le point A : range H4 serré sur les 12 bougies précédentes
  let accumulation = false;
  if (iA >= 12) { let hi = -Infinity, lo = Infinity; for (let q = iA - 12; q < iA; q++) { hi = Math.max(hi, H4[q].h); lo = Math.min(lo, H4[q].l); } accumulation = hi - lo <= 4 * atr4; }
  // Déplacement H4 : grande bougie + FVG dans la jambe
  const corpsMoy4 = moyenne(H4.slice(Math.max(0, iA - 20), iA).map(corps));
  let deplacement4 = false; for (let q = iA; q <= iB; q++) if (H4[q].c > H4[q].o && corps(H4[q]) >= 1.5 * corpsMoy4) deplacement4 = true;
  const fvgJambe = zH4.some(function (z) { return z.i > iA && z.i <= iB; });
  histoire.push('H4 : jambe ' + mot.haussiere + ' de A = ' + P(A) + ' à B = ' + P(B) + ' (' + uniques(evts.map(function (e) { return e.type; })).join(', ') + ')' +
    (balA ? ', le point A a balayé ' + balA.niveaux.slice(0, 3).map(function (x) { return x.genre; }).join(' + ') : '') + (accumulation ? ', après une accumulation' : '') + '.');
  pts(1, 'structure H4 cassée (' + evts[evts.length - 1].type + ')');
  if (balA) { pts(2, 'point A H4 = balayage de liquidité'); if (balA.niveaux.length >= 2) pts(1, 'liquidité cumulée prise en A (' + balA.niveaux.length + ' niveaux)'); }
  if (accumulation && balA) pts(1, 'AMD H4 : accumulation, manipulation, distribution');
  if (deplacement4 && fvgJambe) pts(1, 'déplacement H4 avec FVG');

  // Point B déjà atteint ? (B a balayé une liquidité majeure en face et le prix est revenu) -> mouvement terminé
  const finMouvement = niveaux.filter(function (nv) {
    if (nv.cote !== 'H' || nv.t0 > H4[iB].t || !(nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1' || /égaux|résistance|range/.test(nv.genre))) return false;
    const p = prixNiveau(nv, H4[iB].t);
    return H4[iB].h > p && (H4[iB].c < p || (iB + 1 < n4 && H4[iB + 1].c < p));
  });
  if (finMouvement.length) return stop('Point B atteint : B a balayé ' + finMouvement[0].genre + ' puis le prix est revenu. Mouvement terminé.');
  const cleMouvement = String(H4[iA].t) + '|' + res.sens;
  if (ctx.legsDejaTradees.indexOf(cleMouvement) >= 0) return stop('Ce mouvement (même point A H4) a déjà été tradé.');

  // ---------------- 4. M15 : balayage, MSS, déplacement ----------------
  // (on cherche le déclencheur M15, puis on vérifie que le H1 confirme au même endroit)
  const bals = grouperBalayages(balayagesBas(M15, niveaux, atr15, Math.max(1, n15 - R.fenetreBalayageM15)))
    .filter(function (g) { return retracement(A, B, g.meche) >= 0.5 && g.meche >= A - 1.0 * atr4 && estExtreme(M15, g.i, g.meche, 40, 0.1 * atr15); });
  if (!bals.length) return stop('Pas encore de balayage de liquidité M15 dans la zone ' + mot.decote + ' H4 : la Smart Money n\'a pas encore pris la liquidité.');
  const bal = bals[bals.length - 1];
  const sommetsAvant = pivots(M15, 2).filter(function (p) { return p.type === 'H' && p.i + 2 <= bal.i; });
  if (!sommetsAvant.length) return stop('Pas de sommet M15 de référence pour le MSS.');
  const ref = sommetsAvant[sommetsAvant.length - 1];
  let iMSS = -1;
  for (let j = bal.iRetour; j < n15; j++) {
    if (M15[j].c < bal.meche) return stop('Après le balayage, clôture au-delà de la mèche : c\'était une acceptation, pas une manipulation.');
    if (M15[j].c > ref.p) { iMSS = j; break; }
  }
  if (iMSS < 0) return stop('Balayage M15 de ' + bal.niveaux[0].genre + ' vu, on attend le MSS (clôture au-delà de ' + P(ref.p) + ').');
  if (iMSS < n15 - R.fraicheurMSS) return stop('Le MSS M15 date de plus de ' + (R.fraicheurMSS / 4) + ' h : signal périmé.');
  // Déplacement : au moins une grande bougie (corps ≥ 1,5 x la moyenne) entre le balayage et le MSS
  const corpsMoy15 = moyenne(M15.slice(Math.max(0, bal.i - 20), bal.i).map(corps));
  let iDep = -1; for (let q = bal.i; q <= iMSS; q++) if (M15[q].c > M15[q].o && corps(M15[q]) >= 1.5 * corpsMoy15) iDep = q;
  if (iDep < 0) return stop('MSS M15 sans vrai déplacement (pas de grande bougie) : la Smart Money ne s\'est pas montrée.');
  // Fenêtre de temps : killzone (sauf cryptos 24h/24)
  function enKZ(t) { const h = ny(t).hm; return R.killzones.filter(function (k) { return h >= k.debut && h < k.fin; })[0] || null; }
  const kz = enKZ(M15[iMSS].t);
  if (!ctx.crypto && (!kz || !enKZ(ctx.maintenant))) return stop('Setup hors killzone (Londres 02h-05h, New York 07h-11h, heure de NY) : pas d\'ordre.');
  if (kz) pts(ctx.crypto ? 1 : 2, 'MSS en killzone ' + kz.nom);

  // ---------------- 3. CONFIRMATION H1 ----------------
  // Le H1 doit montrer la réaction au même endroit : rejet par grande mèche, CHoCH H1, ou FVG H1.
  const tBal = M15[bal.i].t;
  const i1 = H1.findIndex(function (b) { return b.t <= tBal && tBal < b.t + DUREE.H1; });
  const confH1 = [];
  if (i1 >= 0) {
    const b1 = H1[i1];
    if (Math.min(b1.o, b1.c) - b1.l >= 0.4 * (b1.h - b1.l) && b1.c >= (b1.h + b1.l) / 2) confH1.push('rejet H1 (grande mèche)');
    const r1 = pivots(H1, 2).filter(function (p) { return p.type === 'H' && p.i + 2 <= i1; }).slice(-1)[0];
    if (r1) for (let j = i1; j < n1; j++) if (H1[j].c > r1.p) { confH1.push('CHoCH H1'); break; }
    if (zH1.some(function (z) { return z.type === 'FVG' && z.role === 'achat' && z.i >= i1; })) confH1.push('FVG H1 ' + mot.haussier);
  }
  if (!confH1.length) return stop('Pas encore de confirmation H1 (ni rejet, ni CHoCH, ni FVG H1) : on attend.');
  pts(Math.min(3, confH1.length + (confH1.indexOf('CHoCH H1') >= 0 ? 1 : 0)), 'confirmation H1 : ' + confH1.join(', '));

  // Zone H4 au point du balayage : OTE et zones
  const r4 = retracement(A, B, bal.meche);
  if (r4 >= 0.62 && r4 <= 0.79) pts(2, 'balayage dans l\'OTE H4 (' + r4.toFixed(2) + ')');
  else pts(1, 'balayage en ' + mot.decote + ' H4 (' + r4.toFixed(2) + ')');
  const dansZ = function (z, tol) { return z.role === 'achat' && bal.meche <= z.haut + tol && bal.meche >= z.bas - tol; };
  const zonesH4 = zH4.filter(function (z) { return dansZ(z, 0.2 * atr4); });
  const zonesHTF = zD1.concat(zW1).filter(function (z) { return dansZ(z, 0.3 * atr4); });
  if (zonesH4.length) pts(2, 'zone H4 : ' + uniques(zonesH4.map(function (z) { return z.type; })).join(', '));
  if (zonesHTF.length) pts(1, 'zone HTF : ' + uniques(zonesHTF.map(function (z) { return z.type + ' ' + z.ut; })).join(', '));
  const superposes = obEtFvgSuperposes(zonesH4.concat(zH1.filter(function (z) { return dansZ(z, 0.2 * atr4); })));
  if (superposes) pts(1, 'OB + FVG superposés (' + superposes + ')');

  // Contre le biais HTF : seulement si la Smart Money a pris une liquidité HTF dans une zone HTF
  if (biais === 'contraire') {
    const liqHTF = bal.niveaux.concat(balA ? balA.niveaux : []).some(function (nv) { return nv.ut === 'D1' || nv.ut === 'W1' || nv.ut === 'MN'; });
    if (!(liqHTF && zonesHTF.length)) return stop('Contre le biais HTF sans balayage d\'une liquidité HTF dans une zone HTF : interdit.');
    histoire.push('Contre le biais HTF, mais liquidité HTF prise dans une zone HTF : retournement possible.');
  }

  // Qualité du balayage M15
  const b0 = M15[bal.i];
  const genres = bal.niveaux.map(function (x) { return x.genre; });
  pts(1, (bal.grab ? 'liquidity grab M15 (fausse cassure reprise) : ' : 'balayage M15 : ') + genres.slice(0, 3).join(' + '));
  const idm = inducement(M15, bal.i, bal.meche, atr15);
  if (idm) pts(1, 'inducement pris avant le vrai balayage (' + P(idm.p) + ')');
  if (bal.niveaux.length >= 2 || bal.niveaux.some(function (x) { return importance(x) >= 2; })) pts(1, 'liquidité cumulée / importante balayée');
  if (Math.min(b0.o, b0.c) - b0.l >= 0.4 * (b0.h - b0.l)) pts(1, 'grande mèche de balayage');
  // Power of 3 : manipulation sous l'ouverture de minuit (NY) ; Judas swing sur l'Asie
  if (ses.ouvertureMinuit !== null && ny(b0.t).jour === ses.jourMinuit && bal.meche < ses.ouvertureMinuit) pts(1, 'Power of 3 : manipulation ' + (S > 0 ? 'sous' : 'au-dessus de') + ' l\'ouverture de minuit');
  if (bal.niveaux.some(function (x) { return /session Asie/.test(x.genre); })) pts(1, 'Judas swing : liquidité de l\'Asie balayée');
  // Volume au balayage et au déplacement
  const vMoy = volumeMoyen(M15, bal.i, 20);
  if (vMoy > 0 && (M15[iDep].v >= 1.3 * vMoy || b0.v >= 1.3 * vMoy)) pts(2, 'volume fort sur le balayage / déplacement');
  // SMT avec l'actif corrélé
  if (dc && smt(M15, dc.M15, bal.i, 40)) pts(2, 'SMT : ' + ctx.correle + ' n\'a pas fait de ' + mot.bas);
  // RSI (bonus) : divergence au balayage, sortie de la zone neutre
  const rsi15 = rsiSerie(M15, 14);
  if (divergence(M15, rsi15, 2, 60, bal.i + 2) >= 1) pts(1, 'divergence RSI M15');
  if (i1 >= 0 && divergence(H1, rsiSerie(H1, 14), 2, 60, i1 + 2) >= 1) pts(1, 'divergence RSI H1');
  if (rsiSortieZoneNeutre(rsi15, n15, 12)) pts(1, 'RSI sort de sa zone neutre');

  // ---------------- 5. ENTRÉE : ordre limite au FVG (ou à l'OB) du déplacement ----------------
  let B15 = -Infinity; for (let j = iMSS; j < n15; j++) B15 = Math.max(B15, M15[j].h);
  let A15 = Infinity; for (let j = bal.i; j <= iMSS; j++) A15 = Math.min(A15, M15[j].l);
  // priorité au FVG laissé par le déplacement (le plus proche du MSS), sinon un BPR, sinon l'OB
  const dansJambe = function (z) { return z.role === 'achat' && z.i >= bal.i && z.i <= Math.min(n15 - 1, iMSS + 2); };
  const fvgs = zM15.filter(function (z) { return z.type === 'FVG' && dansJambe(z); }).concat(zM15.filter(function (z) { return z.type === 'BPR' && dansJambe(z); }))
    .sort(function (a, b) { return (a.type === 'FVG' ? 0 : 1) - (b.type === 'FVG' ? 0 : 1) || Math.abs(a.i - iMSS) - Math.abs(b.i - iMSS); });
  const obs = zM15.filter(function (z) { return z.type === 'OB' && z.role === 'achat' && z.iOrigine >= bal.i - 1 && z.i <= iMSS + 1; });
  let zoneEntree, typeEntree;
  if (fvgs.length) { zoneEntree = fvgs[0]; typeEntree = zoneEntree.type + ' M15 (50 %)'; pts(1, 'entrée sur le ' + zoneEntree.type + ' du déplacement'); }
  else if (obs.length) { zoneEntree = obs[obs.length - 1]; typeEntree = 'OB M15 (50 %)'; }
  else return stop('MSS sans FVG ni OB M15 pour placer l\'ordre limite.');
  const entree = (zoneEntree.bas + zoneEntree.haut) / 2;
  const r15 = retracement(A15, B15, entree);
  if (r15 >= 0.5) pts(1, 'entrée dans l\'OTE M15 (' + r15.toFixed(2) + ')');
  // L'entrée ne doit pas avoir déjà été touchée : on ne court pas après le prix
  for (let j = zoneEntree.i + 1; j < n15; j++) if (M15[j].l <= entree) return stop('Le prix est déjà revenu sur l\'entrée (' + P(entree) + ') : ordre manqué, on ne court pas après.');

  // ---------------- 6. Stop, objectifs, note ----------------
  const stopPx = A15 - R.margeStopAtr * atr15;
  const risque = entree - stopPx;
  if (!(risque > 0.2 * atr15)) return stop('Stop trop serré par rapport à l\'entrée.');
  if (risque > 3 * atr4) return stop('Stop trop large (plus de 3 ATR H4).');
  const tps = cibles.map(function (nv) { return { p: prixNiveau(nv, ctx.maintenant), nom: nv.genre, poids: importance(nv) }; })
    .concat(B > entree ? [{ p: B, nom: 'point B H4', poids: 3 }] : [])
    .filter(function (x) { return (x.p - entree) / risque >= R.rrMin; })
    .sort(function (a, b) { return a.p - b.p; });
  if (!tps.length) return stop('Pas de liquidité en face à au moins ' + R.rrMin + 'R.');
  const tp1 = tps[0];
  const pDol = dol ? prixNiveau(dol, ctx.maintenant) : null;
  const tp2 = (pDol !== null && pDol > tp1.p + 0.5 * risque ? { p: pDol, nom: dol.genre + ' (point B HTF)' } : null) ||
    tps.filter(function (x) { return x.p > tp1.p + 0.5 * risque && x.poids >= 2; })[0] || null;
  if ((tp1.p - entree) / risque >= 3) pts(1, 'TP1 à 3R ou plus');
  histoire.push('M15 : balayage de ' + genres.slice(0, 3).join(' + ') + ' (mèche ' + P(bal.meche) + '), MSS ' + (kz ? 'en killzone ' + kz.nom + ' ' : '') +
    'avec déplacement au-delà de ' + P(ref.p) + ' ; H1 : ' + confH1.join(', ') + '.');
  res.note = note;
  if (note < R.noteMin) return stop('Histoire cohérente mais note ' + note + ' < ' + R.noteMin + ' : pas un setup A++ (' + points.join(', ') + ').');

  res.ok = true;
  res.entree = P(entree); res.stop = P(stopPx); res.typeEntree = typeEntree;
  res.tp1 = P(tp1.p); res.tp1Nom = tp1.nom; res.rr1 = +((tp1.p - entree) / risque).toFixed(2);
  res.tp2 = tp2 ? P(tp2.p) : null; res.tp2Nom = tp2 ? tp2.nom : null; res.rr2 = tp2 ? +((tp2.p - entree) / risque).toFixed(2) : null;
  res.pointA_H4 = P(A); res.pointB_H4 = P(B); res.cleMouvement = cleMouvement;
  res.killzone = kz ? kz.nom : 'hors killzone (crypto 24h/24)';
  // L'ordre limite expire à la fin de la killzone en cours (cryptos : au bout de quelques heures)
  let expire = ctx.maintenant + R.dureeOrdreCrypto * 3600000;
  if (!ctx.crypto && kz) { expire = ctx.maintenant; while (ny(expire).hm < kz.fin && expire < ctx.maintenant + 6 * 3600000) expire += 5 * 60000; }
  res.expireA = new Date(expire).toISOString();
  res.biais = biais; res.grade = 'A++';
  res.liquidite = genres.join(' + ') + ' balayé à ' + P(bal.meche) + (balA ? ' ; point A H4 : ' + balA.niveaux.map(function (x) { return x.genre; }).join(' + ') : '');
  res.zone = uniques(zonesH4.map(function (z) { return z.type + ' H4'; }).concat(zonesHTF.map(function (z) { return z.type + ' ' + z.ut; }))).join(', ') + ' ; OTE H4 ' + r4.toFixed(2) + ' ; entrée ' + typeEntree;
  res.confirmations = points.slice();
  histoire.push('Setup A++ (' + note + ' points). Ordre limite ' + mot.achat + ' à ' + res.entree + ' (' + typeEntree + '), stop ' + res.stop +
    ' derrière la mèche du balayage, TP1 ' + tp1.nom + ' ' + res.tp1 + ' (' + res.rr1 + 'R)' + (tp2 ? ', TP2 ' + tp2.nom + ' ' + res.tp2 + ' (' + res.rr2 + 'R)' : '') + '.');
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
