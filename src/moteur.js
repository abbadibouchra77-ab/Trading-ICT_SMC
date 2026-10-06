// =====================================================================================
// SMC Vision : moteur de lecture ICT / SMC
// -------------------------------------------------------------------------------------
// Ce fichier lit le graphique comme une trader : Monthly, Weekly, Daily (le contexte),
// puis H4 (le setup), puis M15 (l'entrée). Il ne prend un trade que si toute l'histoire
// du graphique va dans le même sens.
//
// Astuce importante : on code seulement la logique « achat ». Pour la vente, on inverse
// le graphique (le prix devient négatif : un sommet devient un creux). Un setup de vente
// devient alors un setup d'achat sur le graphique miroir. Les mêmes règles s'appliquent
// donc exactement de la même façon dans les deux sens, sans risque d'oublier un cas.
//
// Ce code est collé tel quel dans un nœud Code de n8n. Il est aussi testé en local
// (voir tests/). Seules les bougies clôturées sont utilisées.
// =====================================================================================

// ------------------------------- Réglages par défaut --------------------------------
const REGLAGES = {
  rrMin: 2,               // objectif minimum : 2 fois le risque
  scoreConfirmMin: 2,     // points de confirmation minimum (RSI, divergence, volume...)
  margeStopAtr: 0.2,      // marge derrière la mèche du balayage, en ATR M15
  maxAgeToucheM15: 6,     // le retour en zone doit dater de 6 bougies M15 au plus
  fenetreBalayageM15: 64, // on cherche le balayage M15 sur les 16 dernières heures
  fenetreLegH4: 60,       // on cherche le point B H4 sur les 60 dernières bougies H4 (10 jours)
  minBougies: { M15: 150, H4: 80, D1: 30, W1: 10, MN: 3 }
};

const DUREE = { M15: 15 * 60000, H4: 240 * 60000, D1: 86400000, W1: 7 * 86400000 };

// ------------------------------- Outils de base --------------------------------------

// Transforme les bougies du bridge en {t, o, h, l, c, v}, triées, et garde seulement
// les bougies CLÔTURÉES (la bougie en cours est ignorée).
function preparerBougies(brutes, ut, maintenant) {
  let liste = brutes || [];
  if (liste.length === 1 && Array.isArray(liste[0].candles)) liste = liste[0].candles;
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
  // on enlève les doublons éventuels (même heure)
  return out.filter(function (b, i) { return i === 0 || b.t !== out[i - 1].t; });
}

function estCloturee(t, ut, maintenant) {
  if (ut === 'MN') {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) <= maintenant;
  }
  return t + DUREE[ut] <= maintenant;
}

// Construit des bougies d'une unité de temps plus grande à partir de plus petites
// (secours si le bridge ne fournit pas le Daily, le Weekly ou le Monthly).
function regrouper(bougies, cle) {
  const out = [];
  let cur = null, k = null;
  for (const b of bougies) {
    const kb = cle(b.t);
    if (kb !== k) { if (cur) out.push(cur); cur = { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }; k = kb; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  return out;
}
function cleJour(t) { return new Date(t).toISOString().slice(0, 10); }
function cleSemaine(t) { const d = new Date(t); const lundi = t - ((d.getUTCDay() + 6) % 7) * 86400000; return cleJour(lundi); }
function cleMois(t) { return new Date(t).toISOString().slice(0, 7); }

// Graphique miroir : utilisé pour analyser les ventes avec la logique des achats.
function miroir(bougies) {
  return bougies.map(function (b) { return { t: b.t, o: -b.o, h: -b.l, l: -b.h, c: -b.c, v: b.v }; });
}

// ATR (taille moyenne des bougies) sur n bougies, pour chaque bougie.
function atrSerie(bs, n) {
  n = n || 14;
  const out = new Array(bs.length).fill(NaN);
  let somme = 0;
  const tr = bs.map(function (b, i) {
    if (i === 0) return b.h - b.l;
    const pc = bs[i - 1].c;
    return Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  });
  for (let i = 0; i < bs.length; i++) {
    somme += tr[i];
    if (i >= n) somme -= tr[i - n];
    if (i >= n - 1) out[i] = somme / n;
  }
  return out;
}
function dernier(arr) { for (let i = arr.length - 1; i >= 0; i--) if (Number.isFinite(arr[i])) return arr[i]; return NaN; }

// RSI 14 (méthode de Wilder). Sur le graphique miroir, il vaut exactement 100 - RSI.
function rsiSerie(bs, n) {
  n = n || 14;
  const out = new Array(bs.length).fill(NaN);
  if (bs.length <= n) return out;
  let g = 0, p = 0;
  for (let i = 1; i <= n; i++) { const d = bs[i].c - bs[i - 1].c; if (d >= 0) g += d; else p -= d; }
  g /= n; p /= n;
  out[n] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  for (let i = n + 1; i < bs.length; i++) {
    const d = bs[i].c - bs[i - 1].c;
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    p = (p * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = p === 0 ? 100 : 100 - 100 / (1 + g / p);
  }
  return out;
}

// ------------------------------- Structure du marché ---------------------------------

// Sommets et creux (pivots) : une bougie plus haute (ou plus basse) que les L bougies
// de chaque côté. Un pivot n'est connu qu'une fois les L bougies suivantes clôturées.
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

// Cassures de structure, en CLÔTURE :
//  - clôture au-dessus du dernier sommet = cassure haussière ;
//  - si la tendance était baissière, c'est un CHoCH / MSS (changement de caractère),
//    sinon c'est un BOS (cassure dans le sens de la tendance).
// La « deuxième clôture qui confirme » est notée dans `confirmee`.
function structure(bs, L) {
  const piv = pivots(bs, L);
  const evts = [];
  let tendance = 0, sh = null, sl = null, k = 0;
  for (let i = 0; i < bs.length; i++) {
    while (k < piv.length && piv[k].i + L <= i) { if (piv[k].type === 'H') sh = piv[k]; else sl = piv[k]; k++; }
    const c = bs[i].c;
    if (sh && c > sh.p) {
      evts.push({ i: i, dir: 1, type: tendance === -1 ? 'CHoCH' : 'BOS', niveau: sh.p, iNiveau: sh.i,
        confirmee: i + 1 < bs.length ? bs[i + 1].c > sh.p : null });
      tendance = 1; sh = null;
    } else if (sl && c < sl.p) {
      evts.push({ i: i, dir: -1, type: tendance === 1 ? 'CHoCH' : 'BOS', niveau: sl.p, iNiveau: sl.i,
        confirmee: i + 1 < bs.length ? bs[i + 1].c < sl.p : null });
      tendance = -1; sl = null;
    }
  }
  return { pivots: piv, evts: evts, tendance: tendance };
}

// Lecture de la structure d'une unité de temps : tendance, range ou pas.
//  - plus hauts plus hauts + plus bas plus hauts = haussier ;
//  - plus hauts plus bas + plus bas plus bas = baissier ;
//  - sommets et creux qui se chevauchent = range (si le RSI tourne aussi autour de 50
//    ou si l'amplitude est faible).
function lireUT(bs, L, nRange) {
  const st = structure(bs, L);
  const n = bs.length;
  const atr = dernier(atrSerie(bs, 14));
  const rsi = rsiSerie(bs, 14);
  const tol = 0.15 * atr;
  const H = st.pivots.filter(function (p) { return p.type === 'H'; });
  const Lw = st.pivots.filter(function (p) { return p.type === 'L'; });
  let score = 0;
  if (H.length >= 2) { const a = H[H.length - 2].p, b = H[H.length - 1].p; if (b > a + tol) score++; else if (b < a - tol) score--; }
  if (Lw.length >= 2) { const a = Lw[Lw.length - 2].p, b = Lw[Lw.length - 1].p; if (b > a + tol) score++; else if (b < a - tol) score--; }
  const dernierEvt = st.evts.length ? st.evts[st.evts.length - 1] : null;
  const dirEvt = dernierEvt ? dernierEvt.dir : 0;
  let tendance = 'range';
  if ((dirEvt === 1 && score >= 0) || score >= 2) tendance = 'haussier';
  else if ((dirEvt === -1 && score <= 0) || score <= -2) tendance = 'baissier';
  // amplitude des nRange dernières bougies
  const deb = Math.max(0, n - nRange);
  let hi = -Infinity, lo = Infinity;
  for (let i = deb; i < n; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
  const chevauchement = score === 0 || (dirEvt === 0);
  const rsiPlat = rsiTourneAutourDe50(rsi, 16);
  const etroit = (hi - lo) <= 4.5 * atr;
  const enRange = chevauchement && (rsiPlat || etroit);
  return { st: st, atr: atr, rsi: rsi, tendance: tendance, scoreStructure: score, dernierEvt: dernierEvt,
    enRange: enRange, rangeHaut: hi, rangeBas: lo, rsiPlat: rsiPlat };
}

// Le RSI « tourne autour de 50 » : il reste entre 38 et 62 et croise 50 au moins 3 fois.
function rsiTourneAutourDe50(rsi, n) {
  const v = rsi.slice(-n).filter(Number.isFinite);
  if (v.length < n * 0.8) return false;
  let croisements = 0;
  for (let i = 1; i < v.length; i++) if ((v[i] - 50) * (v[i - 1] - 50) < 0) croisements++;
  return croisements >= 3 && Math.min.apply(null, v) > 38 && Math.max.apply(null, v) < 62;
}

// ------------------------------- Zones (OB, FVG, IFVG, breaker) ----------------------

// Toutes les zones d'une unité de temps. role = 'achat' (support) ou 'vente' (résistance).
//  - OB haussier : dernière bougie baissière avant un déplacement haussier qui clôture
//    au-dessus d'elle. Une mèche ne l'invalide pas : seule une CLÔTURE en dessous.
//  - Breaker : OB clôturé au-delà (en corps) : il change de rôle.
//  - FVG haussier : le plus bas de la bougie i est au-dessus du plus haut de la bougie i-2.
//  - IFVG : FVG clôturé au-delà : il change de rôle.
function zones(bs, ut, depuis) {
  const atrS = atrSerie(bs, 14);
  const n = bs.length;
  const z = [];
  const d0 = Math.max(2, depuis || 0);
  for (let i = d0; i < n; i++) {
    const a = atrS[i];
    if (!Number.isFinite(a)) continue;
    // FVG
    if (bs[i].l > bs[i - 2].h && bs[i].l - bs[i - 2].h >= 0.1 * a)
      z.push({ type: 'FVG', role: 'achat', bas: bs[i - 2].h, haut: bs[i].l, i: i, ut: ut });
    if (bs[i].h < bs[i - 2].l && bs[i - 2].l - bs[i].h >= 0.1 * a)
      z.push({ type: 'FVG', role: 'vente', bas: bs[i].h, haut: bs[i - 2].l, i: i, ut: ut });
    // OB (k = la bougie d'origine, i-1 ; on regarde jusqu'à 4 bougies après)
    const k = i - 1;
    if (k >= 1 && k + 1 < n) {
      const ob = bs[k], s = bs[k + 1];
      if (ob.c < ob.o && s.c > s.o) {
        for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) {
          if (bs[j].c > ob.h) {
            let mx = -Infinity; for (let q = k + 1; q <= j; q++) mx = Math.max(mx, bs[q].h);
            if (mx - ob.l >= 1.0 * a) z.push({ type: 'OB', role: 'achat', bas: ob.l, haut: ob.h, i: j, iOrigine: k, ut: ut });
            break;
          }
        }
      }
      if (ob.c > ob.o && s.c < s.o) {
        for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) {
          if (bs[j].c < ob.l) {
            let mn = Infinity; for (let q = k + 1; q <= j; q++) mn = Math.min(mn, bs[q].l);
            if (ob.h - mn >= 1.0 * a) z.push({ type: 'OB', role: 'vente', bas: ob.l, haut: ob.h, i: j, iOrigine: k, ut: ut });
            break;
          }
        }
      }
    }
  }
  // Vie de chaque zone : retournement (IFVG / breaker) ou mort, uniquement par CLÔTURE.
  for (const x of z) {
    x.touches = 0; x.mort = false;
    for (let j = x.i + 1; j < n; j++) {
      const b = bs[j];
      if (x.role === 'achat') {
        if (b.c < x.bas) {
          if (x.type === 'FVG' || x.type === 'OB') { x.type = x.type === 'FVG' ? 'IFVG' : 'Breaker'; x.role = 'vente'; x.iRetournement = j; }
          else { x.mort = true; break; }
        } else if (b.l <= x.haut) x.touches++;
      } else {
        if (b.c > x.haut) {
          if (x.type === 'FVG' || x.type === 'OB') { x.type = x.type === 'FVG' ? 'IFVG' : 'Breaker'; x.role = 'achat'; x.iRetournement = j; }
          else { x.mort = true; break; }
        } else if (b.h >= x.bas) x.touches++;
      }
    }
  }
  return z.filter(function (x) { return !x.mort; });
}

// ------------------------------- Liquidité -------------------------------------------

// Un niveau de liquidité : prix p (ou ligne en biais), côté 'H' (au-dessus : stops des
// vendeurs) ou 'L' (en dessous : stops des acheteurs). t0 = moment où il existe.
function niveau(p, cote, genre, ut, t0, touches, ligne) {
  return { p: p, cote: cote, genre: genre, ut: ut, t0: t0, touches: touches || 1, ligne: ligne || null };
}
// Prix du niveau à un instant donné (une ligne en biais avance avec le temps).
function prixNiveau(nv, t) {
  if (!nv.ligne) return nv.p;
  return nv.ligne.p0 + nv.ligne.pente * (t - nv.ligne.t0) / nv.ligne.pas;
}

// Plus hauts / plus bas précédents : jour, semaine, mois, sessions.
function niveauxPeriodes(d) {
  const out = [];
  function ajoute(bs, nomH, nomL, ut, duree) {
    if (!bs || !bs.length) return;
    const b = bs[bs.length - 1];
    if (d.inverse) { const x = nomH; nomH = nomL; nomL = x; } // graphique miroir : haut et bas sont échangés
    const t0 = ut === 'MN' ? (function () { const x = new Date(b.t); return Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 1); })() : b.t + duree;
    out.push(niveau(b.h, 'H', nomH, ut, t0, 1));
    out.push(niveau(b.l, 'L', nomL, ut, t0, 1));
  }
  ajoute(d.D1, 'plus haut de la veille (PDH)', 'plus bas de la veille (PDL)', 'D1', DUREE.D1);
  ajoute(d.W1, 'plus haut de la semaine passée (PWH)', 'plus bas de la semaine passée (PWL)', 'W1', DUREE.W1);
  ajoute(d.MN, 'plus haut du mois passé (PMH)', 'plus bas du mois passé (PML)', 'MN', 0);
  // Sessions (heures UTC) : Asie 00h-07h, Londres 07h-12h, New York 12h-20h.
  const sessions = {};
  for (const b of d.M15) {
    const h = new Date(b.t).getUTCHours();
    const nom = h < 7 ? 'Asie' : (h < 12 ? 'Londres' : (h < 20 ? 'New York' : null));
    if (!nom) continue;
    const jour = cleJour(b.t);
    const fin = Date.parse(jour + 'T00:00:00Z') + (nom === 'Asie' ? 7 : nom === 'Londres' ? 12 : 20) * 3600000;
    const cle = nom + '|' + jour;
    if (!sessions[cle]) sessions[cle] = { nom: nom, h: b.h, l: b.l, fin: fin };
    else { sessions[cle].h = Math.max(sessions[cle].h, b.h); sessions[cle].l = Math.min(sessions[cle].l, b.l); }
  }
  const derniere = {};
  for (const k in sessions) {
    const s = sessions[k];
    if (s.fin > d.maintenant) continue;
    if (!derniere[s.nom] || derniere[s.nom].fin < s.fin) derniere[s.nom] = s;
  }
  for (const nom in derniere) {
    const s = derniere[nom];
    out.push(niveau(s.h, 'H', (d.inverse ? 'plus bas session ' : 'plus haut session ') + nom, 'M15', s.fin, 1));
    out.push(niveau(s.l, 'L', (d.inverse ? 'plus haut session ' : 'plus bas session ') + nom, 'M15', s.fin, 1));
  }
  return out;
}

// Liquidité visible sur les pivots d'une unité de temps :
//  - sommets / creux égaux (EQH / EQL) ;
//  - supports / résistances droits (plusieurs touches au même niveau) ;
//  - lignes de tendance (supports / résistances en biais) ;
//  - chaque sommet / creux important.
// Plus il y a de touches, plus il y a de liquidité derrière.
function niveauxPivots(bs, L, ut, recul, inverse) {
  const out = [];
  const n = bs.length;
  if (n < 20) return out;
  const atr = dernier(atrSerie(bs, 14));
  const piv = pivots(bs, L).filter(function (p) { return p.i >= n - recul; });
  const pasMs = n > 1 ? bs[n - 1].t - bs[n - 2].t : 1;
  ['H', 'L'].forEach(function (cote) {
    const ps = piv.filter(function (p) { return p.type === cote; });
    // chaque pivot = un peu de liquidité
    const vraiHaut = (cote === 'H') !== !!inverse; // sur le graphique miroir, un « sommet » est un vrai creux
    for (const p of ps) out.push(niveau(p.p, cote, (vraiHaut ? 'sommet ' : 'creux ') + ut, ut, bs[Math.min(n - 1, p.i + L)].t, 1));
    // regroupements : égaux (tolérance serrée) et supports / résistances (plus large)
    [[0.1, 2, cote === 'H' ? 'sommets égaux (EQH) ' : 'creux égaux (EQL) '],
     [0.3, 3, cote === 'H' ? 'résistance droite ' : 'support droit ']].forEach(function (r) {
      const tol = r[0] * atr;
      const vus = {};
      for (let a = 0; a < ps.length; a++) {
        if (vus[a]) continue;
        const groupe = [ps[a]];
        for (let b = a + 1; b < ps.length; b++) if (!vus[b] && Math.abs(ps[b].p - ps[a].p) <= tol) { groupe.push(ps[b]); vus[b] = true; }
        if (groupe.length >= r[1]) {
          const prix = cote === 'H' ? Math.max.apply(null, groupe.map(function (g) { return g.p; })) : Math.min.apply(null, groupe.map(function (g) { return g.p; }));
          const iMax = Math.max.apply(null, groupe.map(function (g) { return g.i; }));
          out.push(niveau(prix, cote, r[2] + ut + ' (' + groupe.length + ' touches)', ut, bs[Math.min(n - 1, iMax + L)].t, groupe.length));
        }
      }
    });
    // lignes de tendance : 2 pivots + au moins 1 autre touche, sans clôture au-delà
    const derniers = ps.slice(-7);
    let meilleure = null;
    for (let a = 0; a < derniers.length; a++) for (let b = a + 1; b < derniers.length; b++) {
      const A = derniers[a], B = derniers[b];
      if (B.i - A.i < 3) continue;
      const pente = (B.p - A.p) / (B.i - A.i);
      if (Math.abs(pente) < 0.02 * atr) continue; // presque plat : déjà vu comme support / résistance droit
      let touches = 0, casse = false;
      for (const P of derniers) if (Math.abs(A.p + pente * (P.i - A.i) - P.p) <= 0.2 * atr) touches++;
      for (let j = A.i; j < n && !casse; j++) {
        const lj = A.p + pente * (j - A.i);
        if (cote === 'H' ? bs[j].c > lj + 0.2 * atr : bs[j].c < lj - 0.2 * atr) casse = true;
      }
      if (casse || touches < 3) continue;
      if (!meilleure || touches > meilleure.touches || (touches === meilleure.touches && B.i > meilleure.B.i))
        meilleure = { A: A, B: B, pente: pente, touches: touches };
    }
    if (meilleure) {
      const m = meilleure;
      out.push(niveau(m.A.p + m.pente * (n - m.A.i), cote,
        (vraiHaut ? 'résistance en biais ' : 'support en biais ') + ut + ' (' + m.touches + ' touches)', ut,
        bs[Math.min(n - 1, m.B.i + L)].t, m.touches, { p0: m.A.p, t0: bs[m.A.i].t, pente: m.pente, pas: pasMs }));
    }
  });
  return out;
}

// Un niveau a-t-il déjà été pris (le prix est passé au-delà) depuis sa création ?
function dejaPris(nv, series) {
  for (const bs of series) for (const b of bs) {
    if (b.t < nv.t0) continue;
    const p = prixNiveau(nv, b.t);
    if (nv.cote === 'H' ? b.h > p : b.l < p) return true;
  }
  return false;
}

// Balayages côté bas ('L') : une mèche sous le niveau, puis une clôture qui revient
// au-dessus (sur la même bougie ou la suivante). Ce n'est PAS une acceptation.
function balayagesBas(bs, niveaux, atr, depuis) {
  const out = [];
  for (let i = Math.max(1, depuis); i < bs.length; i++) {
    const b = bs[i];
    for (const nv of niveaux) {
      if (nv.cote !== 'L' || b.t < nv.t0) continue;
      const p = prixNiveau(nv, b.t);
      if (!(b.l < p - 0.02 * atr)) continue;
      // il ne faut pas que le niveau ait déjà été cassé avant (sinon ce n'est plus de la liquidité)
      let dejaCasse = false;
      for (let q = i - 1; q >= 0 && bs[q].t >= nv.t0; q--) if (bs[q].c < prixNiveau(nv, bs[q].t)) { dejaCasse = true; break; }
      if (dejaCasse) continue;
      let retour = null;
      if (b.c > p) retour = i;
      else if (i + 1 < bs.length && bs[i + 1].c > p && bs[i + 1].l >= b.l - 0.5 * atr) retour = i + 1;
      if (retour === null) continue;
      out.push({ i: i, iRetour: retour, meche: Math.min(b.l, bs[retour].l), niveau: nv, p: p });
    }
  }
  return out;
}

// Le VRAI balayage prend toute la liquidité : la mèche doit être l'extrême de toute la
// structure (le plus bas des N bougies précédentes), pas un petit creux à l'intérieur.
function estBalayageMajeur(bs, i, meche, N, tol) {
  let mn = Infinity;
  for (let q = Math.max(0, i - N); q < i; q++) mn = Math.min(mn, bs[q].l);
  return meche <= mn + tol;
}

// ------------------------------- Confirmations RSI / volume --------------------------

// Le RSI vient d'en bas et casse 50 avec une vraie direction : deux clôtures au-dessus,
// sans revenir tourner autour.
function rsiCasse50(rsi, n) {
  const a = rsi[n - 1], b = rsi[n - 2];
  if (!(a > 50 && b > 50)) return false;
  for (let j = n - 3; j >= Math.max(0, n - 10); j--) {
    if (rsi[j] <= 50) {
      for (let q = j + 1; q < n; q++) if (rsi[q] <= 50) return false; // retour sous 50 : pas propre
      return true;
    }
  }
  return false;
}
// Le RSI rebondit sur la zone 50 pendant que le prix rebondit sur sa zone.
function rsiRebond50(rsi, iTouche, n) {
  let mn = Infinity;
  for (let j = Math.max(0, iTouche - 2); j <= Math.min(n - 1, iTouche + 1); j++) mn = Math.min(mn, rsi[j]);
  return mn >= 43 && mn <= 57 && rsi[n - 1] > mn + 3 && rsi[n - 1] > 50;
}
// Divergences haussières : le prix fait des plus bas plus bas, le RSI des plus bas plus
// hauts. Plusieurs divergences, les premières sous 30 et la dernière au-dessus : très fort.
function divergences(bs, rsi, L, recul) {
  const n = bs.length;
  const creux = pivots(bs, L).filter(function (p) { return p.type === 'L' && p.i >= n - recul && Number.isFinite(rsi[p.i]); }).slice(-4);
  let chaine = 0, debut = null;
  for (let k = creux.length - 1; k >= 1; k--) {
    const b = creux[k], a = creux[k - 1];
    if (b.p < a.p && rsi[b.i] > rsi[a.i]) { chaine++; debut = a; } else break;
  }
  if (!chaine) return { nb: 0, forte: false };
  const derniere = creux[creux.length - 1];
  const forte = chaine >= 2 && rsi[debut.i] < 30 && rsi[derniere.i] >= 30;
  return { nb: chaine, forte: forte };
}
function volumeFort(bs, i) {
  if (i < 20 || !(bs[i].v > 0)) return false;
  let s = 0; for (let q = i - 20; q < i; q++) s += bs[q].v;
  return bs[i].v >= 1.5 * s / 20;
}

// ------------------------------- Fibonacci -------------------------------------------
// Achat : A = le plus bas (la mèche), B = le plus haut. Retracement r = (B - prix) / (B - A).
// La zone d'achat (OTE) commence à 0,5 : 0,5 / 0,618 / 0,705 / 0,786.
function retracement(A, B, prix) { return (B - prix) / (B - A); }

// ======================================================================================
// Analyse d'un côté (achat sur le graphique normal, ou achat sur le graphique miroir =
// vente sur le vrai graphique).
// ======================================================================================
function analyserCote(d, sens, contexte, reglages) {
  const R = reglages;
  const S = sens; // +1 achat, -1 vente (les prix affichés sont remis à l'endroit avec S)
  const mot = S > 0
    ? { achat: 'achat', haussier: 'haussier', baissier: 'baissier', haussiere: 'haussière', bas: 'bas', haut: 'haut', sous: 'sous', dessus: 'au-dessus' }
    : { achat: 'vente', haussier: 'baissier', baissier: 'haussier', haussiere: 'baissière', bas: 'haut', haut: 'bas', sous: 'au-dessus de', dessus: 'en dessous' };
  const dec = contexte.decimales;
  function P(x) { return Number.isFinite(x) ? +(S * x).toFixed(dec) : null; }
  function T(tend) { return tend === 'haussier' ? mot.haussier : tend === 'baissier' ? mot.baissier : 'range'; }
  const raisons = [];   // pourquoi on ne trade pas
  const histoire = [];  // la lecture du graphique, étape par étape
  const res = { sens: S > 0 ? 'buy' : 'sell', ok: false, raisons: raisons, histoire: histoire };
  function stop(msg) { raisons.push(msg); return res; }

  const M15 = d.M15, H4 = d.H4, D1 = d.D1, W1 = d.W1, MN = d.MN;
  const n15 = M15.length, n4 = H4.length;
  const prix = M15[n15 - 1].c;

  // ---------- 1. Lecture du haut : Monthly, Weekly, Daily ----------
  const lMN = lireUT(MN, 1, 12), lW1 = lireUT(W1, 2, 10), lD1 = lireUT(D1, 2, 20);
  const poids = { MN: 1.5, W1: 3, D1: 3 };
  function val(l) { return l.tendance === 'haussier' ? 1 : l.tendance === 'baissier' ? -1 : 0; }
  const scoreHaut = (poids.MN * val(lMN) + poids.W1 * val(lW1) + poids.D1 * val(lD1)) / (poids.MN + poids.W1 + poids.D1);
  const lecture = scoreHaut >= 0.3 ? 'alignée' : scoreHaut <= -0.3 ? 'contraire' : 'neutre';
  // Où est le prix dans le grand mouvement ? (prime / décote du range Daily des 20 jours)
  const milieuD1 = (lD1.rangeHaut + lD1.rangeBas) / 2;
  const positionD1 = prix < milieuD1 ? 'en décote (moitié ' + mot.bas + ' du range Daily)' : 'en prime (moitié ' + mot.haut + ' du range Daily)';
  histoire.push('Lecture du haut : Monthly ' + T(lMN.tendance) + ', Weekly ' + T(lW1.tendance) + ', Daily ' + T(lD1.tendance) +
    (lD1.dernierEvt ? ' (dernier ' + lD1.dernierEvt.type + ' Daily ' + (lD1.dernierEvt.dir > 0 ? mot.haussier : mot.baissier) + ')' : '') +
    ' ; le prix est ' + positionD1 + '. Pour un ' + mot.achat + ', la lecture du haut est ' + lecture + '.');

  // ---------- Liquidité de toutes les unités de temps ----------
  const niveaux = niveauxPeriodes(d)
    .concat(niveauxPivots(D1, 2, 'D1', 120, d.inverse))
    .concat(niveauxPivots(W1, 2, 'W1', 60, d.inverse))
    .concat(niveauxPivots(H4, 2, 'H4', 150, d.inverse))
    .concat(niveauxPivots(M15, 2, 'M15', 200, d.inverse));
  const series = [D1, H4, M15];

  // Zones d'intérêt
  const zH4 = zones(H4, 'H4', Math.max(0, n4 - 200));
  const zD1 = zones(D1, 'D1', Math.max(0, D1.length - 150));
  const zW1 = zones(W1, 'W1', 0);
  const zM15 = zones(M15, 'M15', Math.max(0, n15 - 300));
  const atr4 = dernier(atrSerie(H4, 14)), atr15 = dernier(atrSerie(M15, 14));

  // Ce que le prix va chercher (point B / DOL) : liquidité au-dessus, pas encore prise.
  const cibles = niveaux.filter(function (nv) { return nv.cote === 'H' && prixNiveau(nv, contexte.maintenant) > prix && !dejaPris(nv, series); });
  const dolHaut = cibles.filter(function (nv) { return nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1'; })
    .sort(function (a, b) { return prixNiveau(a, contexte.maintenant) - prixNiveau(b, contexte.maintenant); })[0];
  if (dolHaut) histoire.push('Liquidité visée en face : ' + dolHaut.genre + ' à ' + P(prixNiveau(dolHaut, contexte.maintenant)) + '.');

  // ---------- 2. H4 : direction et setup ----------
  const l4 = lireUT(H4, 2, 20);
  // Le range : c'est de la liquidité qui s'accumule. On n'y trade pas, sauf si un bord
  // vient d'être balayé (manipulation) : la vraie direction se montre alors.
  let rangeBalaye = false;
  if (l4.enRange) {
    for (let i = n4 - 10; i < n4; i++) if (i > 0 && H4[i].l < l4.rangeBas + 0.05 * atr4 && H4[i].c > l4.rangeBas) {
      // le bas du range a été balayé : mèche sous l'extrême, clôture dedans
      let mn = Infinity; for (let q = Math.max(0, i - 20); q < i; q++) mn = Math.min(mn, H4[q].l);
      if (H4[i].l < mn) rangeBalaye = true;
    }
    if (!rangeBalaye) return stop('H4 en range (sommets et creux qui se chevauchent' + (l4.rsiPlat ? ', RSI autour de 50' : '') + ') : on attend la prise de liquidité d\'un bord.');
    histoire.push('H4 était en range, mais le bord ' + mot.bas + ' vient d\'être balayé : manipulation possible (AMD).');
  }
  if (l4.rsiPlat && !rangeBalaye) return stop('RSI H4 qui tourne autour de 50 : pas de direction, pas de trade.');

  // La jambe H4 : B = l'extrême atteint, A = la mèche extrême d'où est parti le mouvement.
  let iB = -1, B = -Infinity;
  for (let i = Math.max(0, n4 - R.fenetreLegH4); i < n4; i++) if (H4[i].h >= B) { B = H4[i].h; iB = i; }
  let iA = -1, A = Infinity;
  for (let i = Math.max(0, iB - 80); i < iB; i++) if (H4[i].l < A) { A = H4[i].l; iA = i; }
  if (iA < 0 || iB - iA < 3) return stop('Pas de jambe H4 ' + mot.haussiere + ' exploitable (pas de point A / B clair).');
  const jambe = B - A;
  if (jambe < 2 * atr4) return stop('Jambe H4 trop petite (moins de 2 ATR) : pas un vrai mouvement.');
  const evtJambe = l4.st.evts.filter(function (e) { return e.dir === 1 && e.i > iA && e.i <= iB + 1; });
  if (!evtJambe.length) return stop('La jambe H4 n\'a cassé aucune structure (ni BOS ni CHoCH ' + mot.haussier + ') : mouvement non validé.');
  for (let i = iB + 1; i < n4; i++) if (H4[i].c < A) return stop('Le prix a clôturé au-delà du point A H4 : setup H4 annulé.');
  // le balayage qui a créé le point A (liquidité prise à l'origine du mouvement)
  const niveauxAvantA = niveaux.filter(function (nv) { return nv.t0 <= H4[iA].t; });
  const balA = balayagesBas(H4, niveauxAvantA, atr4, Math.max(1, iA - 1)).filter(function (s) { return s.i >= iA - 1 && s.i <= iA + 1; });
  histoire.push('H4 : jambe ' + mot.haussiere + ' de A = ' + P(A) + ' à B = ' + P(B) + ' (' + evtJambe.map(function (e) { return e.type; }).join(', ') + ')' +
    (balA.length ? ' ; A a balayé : ' + balA.map(function (s) { return s.niveau.genre; }).slice(0, 3).join(', ') : '') + '.');

  // Le mouvement a-t-il déjà atteint son point B ? (B a balayé une liquidité majeure en
  // face et le prix est revenu) -> mouvement terminé, pas de nouveau trade dedans.
  const niveauxFace = niveaux.filter(function (nv) { return nv.cote === 'H' && nv.t0 <= H4[iB].t && (nv.ut !== 'M15') && nv.touches >= 1; });
  const pointBAtteint = niveauxFace.filter(function (nv) {
    const p = prixNiveau(nv, H4[iB].t);
    return H4[iB].h > p && (H4[iB].c < p || (iB + 1 < n4 && H4[iB + 1].c < p)) && (nv.ut === 'W1' || nv.ut === 'MN' || nv.ut === 'D1' || /égaux|résistance/.test(nv.genre));
  });
  if (pointBAtteint.length) return stop('Le point B est atteint : B a balayé ' + pointBAtteint[0].genre + ' puis le prix est revenu. Mouvement terminé, pas de nouveau trade dedans.');
  if (contexte.legsDejaTradees.indexOf(String(H4[iA].t) + '|' + res.sens) >= 0)
    return stop('Ce mouvement (même point A H4) a déjà été tradé : on ne reprend pas de trade dedans.');

  // Interdit : acheter juste sous une résistance qui vient de rejeter le prix, tant que
  // la structure H4 ne s'est pas retournée.
  if (l4.tendance !== 'haussier') {
    // tValide = à partir de quand la résistance existe (formation, ou retournement pour IFVG / breaker)
    const tZone = function (z) { const bs = z.ut === 'H4' ? H4 : D1; return bs[z.iRetournement !== undefined ? z.iRetournement : z.i].t; };
    const resistances = zH4.concat(zD1).filter(function (z) { return z.role === 'vente'; }).map(function (z) { return { p: z.bas, nom: z.type + ' ' + z.ut + ' (résistance)', tValide: tZone(z) }; })
      .concat(niveaux.filter(function (nv) { return nv.cote === 'H' && nv.touches >= 2; }).map(function (nv) { return { p: prixNiveau(nv, contexte.maintenant), nom: nv.genre, tValide: nv.t0 }; }));
    for (const r of resistances) {
      if (!(r.p > prix && r.p - prix <= 1.0 * atr4)) continue;
      // un rejet = le prix arrive par en dessous, touche la résistance et reclôture nettement en dessous
      for (let i = n4 - 12; i < n4; i++) if (i >= 1 && H4[i].t > r.tValide && H4[i - 1].c < r.p && H4[i].o < r.p && H4[i].h >= r.p - 0.15 * atr4 && H4[i].c < r.p - 0.3 * atr4)
        return stop('Juste ' + (S > 0 ? 'sous' : 'au-dessus de') + ' ' + r.nom + ' (' + P(r.p) + ') qui vient de rejeter le prix, et la structure H4 ne s\'est pas retournée.');
    }
  }

  // ---------- 3. M15 : l'entrée ----------
  // 3a. Le vrai balayage : mèche M15 sous une liquidité, à l'extrême de toute la structure,
  //     dans la zone d'achat H4 (OTE : 0,5 et au-delà).
  const debutBal = Math.max(1, n15 - R.fenetreBalayageM15);
  const bals = balayagesBas(M15, niveaux, atr15, debutBal).filter(function (s) {
    const r = retracement(A, B, s.meche);
    return r >= 0.45 && s.meche >= A - 0.8 * atr4 && estBalayageMajeur(M15, s.i, s.meche, 60, 0.1 * atr15);
  });
  if (!bals.length) return stop('Pas encore de vraie prise de liquidité en M15 dans la zone H4 : on n\'entre pas avant (sinon c\'est nous la liquidité).');
  // le balayage le plus récent qui a pris la liquidité la plus importante
  bals.sort(function (a, b) { return b.i - a.i || importance(b.niveau) - importance(a.niveau); });
  const bal = bals[0];

  // 3b. MSS M15 : clôture claire au-dessus du dernier sommet M15 qui a produit la baisse.
  const piv15 = pivots(M15, 2);
  const sommetsAvant = piv15.filter(function (p) { return p.type === 'H' && p.i + 2 <= bal.i; });
  if (!sommetsAvant.length) return stop('Pas de sommet M15 de référence pour le MSS.');
  const sommetRef = sommetsAvant[sommetsAvant.length - 1];
  let iMSS = -1;
  for (let j = bal.iRetour; j < n15; j++) {
    if (M15[j].c < bal.meche) return stop('Après le balayage, le prix a clôturé sous la mèche : balayage raté (acceptation).');
    if (M15[j].c > sommetRef.p + 0.05 * atr15) { iMSS = j; break; }
  }
  if (iMSS < 0) return stop('Balayage M15 vu (' + bal.niveau.genre + '), mais pas encore de MSS (clôture au-dessus de ' + P(sommetRef.p) + ').');

  // 3c. Fibonacci M15 : A15 = la mèche du balayage, B15 = l'extrême après le MSS.
  let iB15 = iMSS, B15 = -Infinity;
  for (let j = iMSS; j < n15; j++) if (M15[j].h >= B15) { B15 = M15[j].h; iB15 = j; }
  let A15 = Infinity;
  for (let j = bal.i; j <= iB15; j++) A15 = Math.min(A15, M15[j].l);
  const jambe15 = B15 - A15;
  if (jambe15 < 1.2 * atr15) return stop('Déplacement M15 trop faible après le MSS.');
  if (iB15 >= n15 - 1) return stop('Le prix est encore à l\'extrême B M15 : on attend le retour à 0,5.');
  let iT = -1, touche = Infinity;
  for (let j = iB15 + 1; j < n15; j++) if (M15[j].l < touche) { touche = M15[j].l; iT = j; }
  if (touche <= A15) return stop('Le retour M15 est allé sous le point A : setup annulé.');
  const r15 = retracement(A15, B15, touche);
  if (r15 < 0.5) return stop('Le retour M15 n\'a pas encore atteint 0,5 (seulement ' + r15.toFixed(2) + ').');
  const r4 = retracement(A, B, touche);
  if (r4 < 0.5) return stop('Le prix n\'est pas dans la zone d\'achat H4 (OTE à partir de 0,5 ; ici ' + r4.toFixed(2) + ').');

  // 3d. Confluence au point de retour : OB / FVG / IFVG / breaker M15, ou zone H4.
  const tol = 0.1 * atr15;
  const dansZone = function (z) { return z.role === 'achat' && touche <= z.haut + tol && touche >= z.bas - 3 * tol; };
  const confM15 = zM15.filter(function (z) { return z.i >= bal.i - 3 && z.i <= iT && dansZone(z); });
  const confH4 = zH4.filter(dansZone);
  const supports = niveaux.filter(function (nv) { return nv.cote === 'L' && nv.touches >= 2 && Math.abs(prixNiveau(nv, M15[iT].t) - touche) <= 0.3 * atr4; });
  const confHTF = zD1.concat(zW1).filter(function (z) { return z.role === 'achat' && touche <= z.haut + 0.3 * atr4 && touche >= z.bas - 0.3 * atr4; });

  // 3e. Le rebond, puis l'entrée (sur la dernière bougie M15 clôturée uniquement).
  const der = M15[n15 - 1], avant = M15[n15 - 2];
  let mode = null;
  const rebond = der.c > der.o && (iT === n15 - 1 ? (der.c - der.l) >= 0.6 * (der.h - der.l) : der.c > avant.h) && iT >= n15 - R.maxAgeToucheM15;
  if (rebond && (confM15.length || confH4.length)) mode = 'OTE M15 (balayage, MSS, retour à 0,5 dans une confluence, rebond)';

  // Variante : balayage, MSS, retest de l'OB, BOS de confirmation, entrée au retest du FVG/IFVG.
  if (!mode) {
    const obs = zM15.filter(function (z) { return (z.type === 'OB' || z.type === 'Breaker') && z.role === 'achat' && z.i >= bal.i && z.i <= iMSS + 2; });
    for (const ob of obs) {
      let iRetest = -1;
      for (let j = iMSS + 1; j < n15; j++) if (M15[j].l <= ob.haut && M15[j].c >= ob.bas) { iRetest = j; break; }
      if (iRetest < 0) continue;
      let hautPostMSS = -Infinity; for (let j = iMSS; j <= iRetest; j++) hautPostMSS = Math.max(hautPostMSS, M15[j].h);
      let iBOS = -1; for (let j = iRetest + 1; j < n15; j++) if (M15[j].c > hautPostMSS + 0.05 * atr15) { iBOS = j; break; }
      if (iBOS < 0) continue;
      const fvgs = zM15.filter(function (z) { return (z.type === 'FVG' || z.type === 'IFVG') && z.role === 'achat' && z.i >= iRetest && z.i <= iBOS + 1; });
      for (const f of fvgs) {
        if (der.l <= f.haut && der.c >= f.bas && der.c > der.o && n15 - 1 > iBOS) {
          mode = 'Variante (balayage, MSS, retest OB, BOS, retest ' + f.type + ')';
          confM15.push(f); break;
        }
      }
      if (mode) break;
    }
  }
  if (!mode) {
    if (!confM15.length && !confH4.length) return stop('Retour à ' + r15.toFixed(2) + ' mais sans confluence (ni OB, FVG, IFVG, breaker M15, ni zone H4).');
    return stop('Retour dans la zone, mais pas encore de rebond clair sur la dernière bougie M15 clôturée.');
  }
  const conf = confM15.map(function (z) { return z.type + ' M15'; }).concat(confH4.map(function (z) { return z.type + ' H4'; }))
    .concat(supports.map(function (s) { return s.genre; })).concat(confHTF.map(function (z) { return z.type + ' ' + z.ut; }));
  histoire.push('M15 : balayage de ' + bal.niveau.genre + ' (mèche ' + P(bal.meche) + '), MSS au-dessus de ' + P(sommetRef.p) +
    ', retour à ' + r15.toFixed(2) + ' du Fibonacci M15 (et ' + r4.toFixed(2) + ' du Fibonacci H4), confluence : ' + uniques(conf).join(', ') + '.');

  // ---------- 4. Lecture du haut contre nous ? ----------
  // Autorisé seulement si la liquidité prise est une liquidité de grande unité de temps,
  // ou si le balayage s'est fait dans une zone d'intérêt Daily / Weekly.
  let contreTendance = false;
  if (lecture === 'contraire') {
    const balHTF = (bal.niveau.ut === 'D1' || bal.niveau.ut === 'W1' || bal.niveau.ut === 'MN') || confHTF.length > 0 || balA.some(function (s) { return s.niveau.ut !== 'M15' && s.niveau.ut !== 'H4'; });
    if (!balHTF) return stop('Lecture du haut contraire, sans balayage de liquidité dans une zone d\'intérêt de grande unité de temps.');
    contreTendance = true;
    histoire.push('Contre la lecture du haut, mais balayage d\'une liquidité / zone de grande unité de temps : retournement possible.');
  }

  // ---------- 5. Confirmations (fortes, mais jamais suffisantes seules) ----------
  const rsi15 = rsiSerie(M15, 14), rsi4 = l4.rsi;
  const confirmations = [];
  let pts = 0;
  function ajoute(nom, p) { confirmations.push(nom); pts += p; }
  if (rsiRebond50(rsi15, iT, n15)) ajoute('RSI M15 qui rebondit sur 50 en même temps que le prix sur sa zone (très fort)', 3);
  if (rsiCasse50(rsi15, n15)) ajoute('RSI M15 qui casse 50 avec deux clôtures', 1);
  if (rsiCasse50(rsi4, n4)) ajoute('RSI H4 qui casse 50 avec deux clôtures', 2);
  const div15 = divergences(M15, rsi15, 2, 120), div4 = divergences(H4, rsi4, 2, 80);
  if (div15.nb) ajoute('divergence RSI M15 x' + div15.nb + (div15.forte ? ' (premières hors 30, dernière dedans : très fort)' : ''), div15.forte ? 3 : 1);
  if (div4.nb) ajoute('divergence RSI H4 x' + div4.nb + (div4.forte ? ' (très fort)' : ''), div4.forte ? 3 : 2);
  let mnRsi = Infinity; for (let j = n15 - 20; j < n15; j++) if (j >= 0) mnRsi = Math.min(mnRsi, rsi15[j]);
  if (mnRsi <= 30) ajoute((S > 0 ? 'survente' : 'surachat') + ' RSI M15 récente', 1);
  if (volumeFort(M15, bal.i)) ajoute('volume fort sur la mèche du balayage', 1);
  if (volumeFort(M15, iMSS)) ajoute('volume fort sur la cassure (MSS)', 1);
  const minPts = R.scoreConfirmMin + (contreTendance ? 1 : 0);
  if (pts < minPts) return stop('Histoire ICT/SMC complète, mais confirmations insuffisantes (' + pts + ' points, il en faut ' + minPts + ') : ' + (confirmations.join(', ') || 'aucune') + '.');

  // ---------- 6. Gestion du trade : stop, objectifs ----------
  const entree = der.c;
  const stopPx = A15 - R.margeStopAtr * atr15;
  const risque = entree - stopPx;
  if (!(risque > 0)) return stop('Stop incohérent.');
  if (risque < 0.3 * atr15) return stop('Stop trop serré (moins de 0,3 ATR M15) : il serait pris par le bruit.');
  if (risque > 3 * atr4) return stop('Stop trop large (plus de 3 ATR H4).');
  // Objectifs = liquidité visible en face, encore intacte, à au moins 2R.
  const tps = cibles.map(function (nv) { return { p: prixNiveau(nv, contexte.maintenant), nom: nv.genre, poids: importance(nv) }; })
    .concat(B > entree ? [{ p: B, nom: 'point B H4', poids: 3 }] : [])
    .filter(function (x) { return (x.p - entree) / risque >= R.rrMin; })
    .sort(function (a, b) { return a.p - b.p; });
  if (!tps.length) return stop('Pas de liquidité visible en face à au moins ' + R.rrMin + 'R : objectif insuffisant.');
  const tp1 = tps[0];
  const tp2 = tps.filter(function (x) { return x.p > tp1.p + 0.5 * risque && x.poids >= 2; })[0] || null;
  const rr1 = (tp1.p - entree) / risque, rr2 = tp2 ? (tp2.p - entree) / risque : null;

  res.ok = true;
  res.entree = P(entree); res.stop = P(stopPx);
  res.tp1 = P(tp1.p); res.tp1Nom = tp1.nom; res.rr1 = +rr1.toFixed(2);
  res.tp2 = tp2 ? P(tp2.p) : null; res.tp2Nom = tp2 ? tp2.nom : null; res.rr2 = rr2 ? +rr2.toFixed(2) : null;
  res.pointA_H4 = P(A); res.pointB_H4 = P(B); res.cleMouvement = String(H4[iA].t) + '|' + res.sens;
  res.mode = mode;
  res.lectureHaut = lecture + (contreTendance ? ' (contre-tendance autorisée)' : '');
  res.zone = uniques(conf).join(', ') + ' ; OTE H4 ' + r4.toFixed(2) + ', OTE M15 ' + r15.toFixed(2);
  res.liquidite = bal.niveau.genre + ' balayé à ' + P(bal.meche) + (balA.length ? ' ; origine H4 : ' + balA[0].niveau.genre : '');
  res.confirmations = confirmations; res.pointsConfirmation = pts;
  histoire.push('Entrée ' + mot.achat + ' à ' + res.entree + ', stop ' + res.stop + ' (derrière la mèche du balayage), objectif 1 : ' + tp1.nom + ' ' + res.tp1 + ' (' + res.rr1 + 'R)' +
    (tp2 ? ', objectif 2 : ' + tp2.nom + ' ' + res.tp2 + ' (' + res.rr2 + 'R)' : '') + '.');
  return res;
}

function importance(nv) {
  if (nv.ut === 'MN' || nv.ut === 'W1') return 4;
  if (nv.ut === 'D1') return 3;
  if (nv.touches >= 2 || /session/.test(nv.genre)) return 2;
  return 1;
}
function uniques(arr) { return arr.filter(function (x, i) { return arr.indexOf(x) === i; }); }

function decimalesDe(bs) {
  let d = 0;
  for (const b of bs.slice(-50)) { const s = String(b.c); const k = s.indexOf('.'); if (k >= 0) d = Math.max(d, s.length - k - 1); }
  return Math.min(d, 6);
}

// ======================================================================================
// Point d'entrée : analyse complète d'un actif.
// brut = { M15, H4, D1, W1, MN } (réponses du bridge), etat = { legsDejaTradees: [] }
// ======================================================================================
function analyserActif(symbole, brut, maintenant, etat, reglagesPerso) {
  const R = Object.assign({}, REGLAGES, reglagesPerso || {});
  const d = {
    M15: preparerBougies(brut.M15, 'M15', maintenant),
    H4: preparerBougies(brut.H4, 'H4', maintenant),
    D1: preparerBougies(brut.D1, 'D1', maintenant),
    W1: preparerBougies(brut.W1, 'W1', maintenant),
    MN: preparerBougies(brut.MN, 'MN', maintenant),
    maintenant: maintenant
  };
  const notes = [];
  // Secours : si le bridge ne donne pas Daily / Weekly / Monthly, on les reconstruit.
  if (d.D1.length < R.minBougies.D1 && d.H4.length) { d.D1 = regrouper(d.H4, cleJour).filter(function (b) { return b.t + DUREE.D1 <= maintenant; }); notes.push('Daily reconstruit depuis le H4'); }
  if (d.W1.length < R.minBougies.W1 && d.D1.length) { d.W1 = regrouper(d.D1, cleSemaine); d.W1 = d.W1.filter(function (b) { return b.t + DUREE.W1 <= maintenant + 3 * 86400000; }); notes.push('Weekly reconstruit depuis le Daily'); }
  if (d.MN.length < R.minBougies.MN && d.D1.length) { d.MN = regrouper(d.D1, cleMois); notes.push('Monthly reconstruit depuis le Daily'); }
  const manque = Object.keys(R.minBougies).filter(function (k) { return d[k].length < R.minBougies[k]; });
  if (manque.length) return { symbole: symbole, action: 'attendre', raison: 'Données insuffisantes : ' + manque.map(function (k) { return k + ' (' + d[k].length + ')'; }).join(', '), notes: notes };
  // Le signal doit venir de la dernière bougie M15 clôturée (pas d'un vieux signal).
  const derM15 = d.M15[d.M15.length - 1];
  if (maintenant - (derM15.t + DUREE.M15) > 20 * 60000) return { symbole: symbole, action: 'attendre', raison: 'Pas de bougie M15 récente (marché fermé ?).', notes: notes };

  const contexte = { maintenant: maintenant, decimales: decimalesDe(d.M15), legsDejaTradees: (etat && etat.legsDejaTradees) || [] };
  const dm = { M15: miroir(d.M15), H4: miroir(d.H4), D1: miroir(d.D1), W1: miroir(d.W1), MN: miroir(d.MN), maintenant: maintenant, inverse: true };
  const achat = analyserCote(d, 1, contexte, R);
  const vente = analyserCote(dm, -1, contexte, R);
  const choix = [achat, vente].filter(function (x) { return x.ok; });
  if (!choix.length) {
    return { symbole: symbole, action: 'attendre', notes: notes,
      raison: 'Achat : ' + achat.raisons.join(' ') + ' | Vente : ' + vente.raisons.join(' '),
      histoireAchat: achat.histoire, histoireVente: vente.histoire };
  }
  if (choix.length === 2) return { symbole: symbole, action: 'attendre', raison: 'Achat et vente valides en même temps : histoire incohérente, on s\'abstient.', notes: notes };
  const t = choix[0];
  return Object.assign({ symbole: symbole, action: 'trader', notes: notes, lecture: t.histoire.join(' ') }, t);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyserActif, preparerBougies, structure, zones, pivots, rsiSerie, atrSerie, lireUT, balayagesBas, niveauxPivots, miroir, divergences, REGLAGES };
}
