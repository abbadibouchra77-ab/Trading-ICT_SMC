// Backtest de la stratégie « englobante avec prise de liquidité » (demande du 12/10/2026).
//
// Sur une unité de temps (H1 ou M15 pour commencer ; M45, M30, M20 ensuite) :
//  1. Signal d'ACHAT à la clôture de la bougie q : elle descend sous le plus bas de la bougie précédente
//     (prise de liquidité), puis clôture au-dessus de son plus haut (englobante), et elle est haussière.
//     Variante « corps » (--reglages '{"englobe":"corps"}') : la bougie précédente est baissière et q clôture
//     au-dessus de son ouverture.
//  2. La mèche de q touche une zone POI ACHETEUSE de la MÊME unité de temps, encore valable à la clôture de q-1 :
//     OB, FVG, Breaker (OB vendeur cassé), IFVG (FVG vendeur cassé), BPR. Mêmes définitions que src/moteur.js,
//     mais la vie de la zone n'est connue qu'avec les bougies déjà clôturées (pas de futur).
//  3. Direction : on n'achète que si la direction de l'unité supérieure est haussière
//     (H1 -> Daily, M15 -> H4) : dernière cassure en clôture du dernier sommet / creux (structure, pivots 2 bougies).
//  4. Entrée au marché à la clôture de q (achat à l'ask = clôture + spread), stop derrière la mèche (le plus bas
//     de q), objectif à 2R (réglage rr). Le trade est suivi sur le M15. Un seul trade à la fois par actif.
// La vente = l'achat sur le graphique retourné (miroir).
//
// Usage : node backtest/englobante.js --donnees <dossier CSV> [--ut 60,15] [--depuis 2019-03-01] [--jusqua 2026-12-31]
//         [--actifs XAUUSD,EURUSD] [--capital 10000] [--sortie dossier] [--reglages '{"rr":2}']
const fs = require('fs');
const path = require('path');
const moteur = require('../src/moteur.js');
const { lireCSV, unitesDeTemps, regrouper } = require('./donnees.js');
const { ACTIFS, trouverFichier } = require('./lancer.js');
const { simulerCompte, stats } = require('./portefeuille.js');

const DEFAUT = {
  rr: 2,               // objectif en R
  englobe: 'meche',    // 'meche' : clôture au-delà du plus haut de la bougie précédente ; 'corps' : au-delà de son ouverture
  pivotDirection: 2,   // pivots de la structure de l'unité supérieure
  ageMaxZone: 200,     // une zone POI n'est plus regardée après 200 bougies
  dureeMaxJours: 20,   // trade clôturé au marché après 20 jours
  spreadFacteur: 1,    // 0 = sans spread (diagnostic)
  // Filtre « range, pas de direction » (annotation de l'utilisatrice sur la perte XAUUSD H1 du 06/10/2026) :
  structureUt: false,  // la dernière cassure de structure de l'unité du signal doit aller dans le sens du trade
  pivotUt: 2,
  rangeFenetre: 0,     // > 0 : pas de trade si, sur ces N bougies avant le signal, le prix tourne en rond
  rangeEff: 0.3,       //       (déplacement net / chemin parcouru < rangeEff)
  // Règles du 12/10/2026 (« on englobe une vraie bougie, pas un doji, et pas une bougie qui va dans le même sens ;
  // pas d'englobante à contresens sur un support / une résistance ») :
  precOpposee: false,  // la bougie englobée va dans l'autre sens (baissière pour un achat)
  corpsPrecMin: 0,     // corps de la bougie englobée >= cette part de sa taille (pas de doji)
  corpsEnglMin: 0,     // corps de l'englobante >= cette part de sa taille
  espaceR: 0,          // > 0 : le sommet (creux pour une vente) non pris le plus proche est au moins à espaceR x le risque
  reculNiveaux: 100,   //       sommets / creux de swing (pivots 2 bougies) des 100 dernières bougies
  decote: 0            // > 0 : achat seulement en décote (clôture sous le milieu du plus haut / plus bas des N bougies), vente en prime
};
const SUPERIEURE = { 60: 'D1', 15: 'H4', 20: 'H4', 30: 'H4', 45: 'H4' };
const NOM_UT = { 15: 'M15', 20: 'M20', 30: 'M30', 45: 'M45', 60: 'H1' };

function versCourt(bs) { return bs.map(function (b) { return { t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume }; }); }

// Zones ACHETEUSES (support) de bs avec leur période de validité [de, a[ en indices de bougies :
// la zone existe dans l'état « après la clôture de k » pour de <= k < a.
// Comme moteur.zones : une clôture au-delà retourne un OB / FVG (Breaker / IFVG) et tue un BPR ou une zone déjà retournée.
function zonesAchat(bs, ageMax) {
  const atr = moteur.atrSerie(bs, 14), n = bs.length, brutes = [];
  for (let i = 2; i < n; i++) {
    const a = atr[i]; if (!Number.isFinite(a)) continue;
    if (bs[i].l > bs[i - 2].h && bs[i].l - bs[i - 2].h >= 0.1 * a) brutes.push({ type: 'FVG', role: 1, bas: bs[i - 2].h, haut: bs[i].l, i: i });
    if (bs[i].h < bs[i - 2].l && bs[i - 2].l - bs[i].h >= 0.1 * a) brutes.push({ type: 'FVG', role: -1, bas: bs[i].h, haut: bs[i - 2].l, i: i });
    const k = i - 1, ob = bs[k], s = bs[k + 1];
    if (k >= 1 && ob.c < ob.o && s.c > s.o) for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) if (bs[j].c > ob.h) {
      let mx = -Infinity; for (let q = k + 1; q <= j; q++) mx = Math.max(mx, bs[q].h);
      if (mx - ob.l >= 1.0 * atr[j]) brutes.push({ type: 'OB', role: 1, bas: ob.l, haut: ob.h, i: j });
      break;
    }
    if (k >= 1 && ob.c > ob.o && s.c < s.o) for (let j = k + 1; j <= Math.min(n - 1, k + 4); j++) if (bs[j].c < ob.l) {
      let mn = Infinity; for (let q = k + 1; q <= j; q++) mn = Math.min(mn, bs[q].l);
      if (ob.h - mn >= 1.0 * atr[j]) brutes.push({ type: 'OB', role: -1, bas: ob.l, haut: ob.h, i: j });
      break;
    }
  }
  // BPR : FVG haussier et FVG baissier qui se chevauchent (30 bougies au plus) ; rôle du plus récent
  const fvgs = brutes.filter(function (x) { return x.type === 'FVG'; });
  for (let a = 0; a < fvgs.length; a++) for (let b = a + 1; b < fvgs.length && fvgs[b].i - fvgs[a].i <= 30; b++) {
    const A = fvgs[a], B = fvgs[b];
    if (A.role === B.role) continue;
    const bas = Math.max(A.bas, B.bas), haut = Math.min(A.haut, B.haut);
    if (haut > bas) brutes.push({ type: 'BPR', role: B.role, bas: bas, haut: haut, i: B.i });
  }
  // Vie de chaque zone (bougies clôturées seulement), limitée à ageMax bougies ; on garde les périodes acheteuses
  const out = [];
  for (const z of brutes) {
    let role = z.role, type = z.type, de = z.i, retournable = z.type !== 'BPR';
    const fin = Math.min(n, z.i + ageMax + 1);
    let j = z.i + 1;
    for (; j < fin; j++) {
      const c = bs[j].c;
      const casse = role === 1 ? c < z.bas : c > z.haut;
      if (!casse) continue;
      if (role === 1) out.push({ type: type, bas: z.bas, haut: z.haut, iForme: z.i, de: de, a: j });
      if (!retournable) { de = -1; break; }
      type = type === 'FVG' ? 'IFVG' : 'Breaker'; role = -role; de = j; retournable = false;
    }
    if (de >= 0 && j >= fin && role === 1) out.push({ type: type, bas: z.bas, haut: z.haut, iForme: z.i, de: de, a: fin });
  }
  out.sort(function (x, y) { return x.de - y.de; });
  return out;
}

// Direction de l'unité supérieure après la clôture de chaque bougie (+1, -1 ou 0).
function directions(bs, L) {
  const st = moteur.structure(bs, L), out = new Array(bs.length).fill(0);
  let e = 0, d = 0;
  for (let i = 0; i < bs.length; i++) { while (e < st.evts.length && st.evts[e].i <= i) { d = st.evts[e].dir; e++; } out[i] = d; }
  return out;
}

// Range : sur les n bougies avant q, le prix a beaucoup bougé mais peu avancé (déplacement net / chemin < eff).
function enRange(bs, q, n, eff) {
  if (q - n < 1) return true;
  let chemin = 0; for (let i = q - n + 1; i < q; i++) chemin += Math.abs(bs[i].c - bs[i - 1].c);
  return chemin <= 0 || Math.abs(bs[q - 1].c - bs[q - n].c) / chemin < eff;
}

// Résistance au-dessus de la clôture de q : le plus bas des sommets de swing (pivots 2 bougies, confirmés avant q)
// des `recul` dernières bougies qui n'ont pas été dépassés depuis. Infinity s'il n'y en a pas.
function resistance(bs, q, sommets, recul) {
  let plusHaut = bs[q].h, niveau = Infinity;
  for (let i = q - 1; i >= Math.max(0, q - recul); i--) {
    if (i <= q - 2 && sommets[i] && bs[i].h > plusHaut && bs[i].h > bs[q].c) niveau = Math.min(niveau, bs[i].h);
    plusHaut = Math.max(plusHaut, bs[i].h);
  }
  return niveau;
}

// Signaux d'ACHAT sur bs (graphique éventuellement retourné). dirSup(k) = direction de l'unité supérieure
// connue à la clôture de la bougie k. Renvoie [{ q, zone }].
function signauxAchat(bs, dirSup, P) {
  const zs = zonesAchat(bs, P.ageMaxZone), out = [];
  const dirUt = P.structureUt ? directions(bs, P.pivotUt) : null;
  const sommets = new Uint8Array(bs.length);
  if (P.espaceR) for (const x of moteur.pivots(bs, 2)) if (x.type === 'H') sommets[x.i] = 1;
  let z = 0; const actives = [];
  for (let q = 20; q < bs.length; q++) {
    // zones valables après la clôture de q-1
    while (z < zs.length && zs[z].de <= q - 1) actives.push(zs[z++]);
    for (let k = actives.length - 1; k >= 0; k--) if (actives[k].a <= q - 1) actives.splice(k, 1);
    const b = bs[q], p = bs[q - 1];
    if (!(b.c > b.o) || !(b.l < p.l)) continue;
    if (P.englobe === 'corps' ? !(p.c < p.o && b.c > p.o) : !(b.c > p.h)) continue;
    if (dirSup(q) !== 1) continue;
    if (dirUt && dirUt[q] !== 1) continue;
    if (P.precOpposee && !(p.c < p.o)) continue;
    if (P.corpsPrecMin && !(p.h > p.l && Math.abs(p.c - p.o) >= P.corpsPrecMin * (p.h - p.l))) continue;
    if (P.corpsEnglMin && !(b.c - b.o >= P.corpsEnglMin * (b.h - b.l))) continue;
    if (P.espaceR && resistance(bs, q, sommets, P.reculNiveaux) - b.c < P.espaceR * (b.c - b.l)) continue;
    if (P.rangeFenetre && enRange(bs, q, P.rangeFenetre, P.rangeEff)) continue;
    if (P.decote) {
      let hi = -Infinity, lo = Infinity; for (let i = Math.max(0, q - P.decote); i <= q; i++) { hi = Math.max(hi, bs[i].h); lo = Math.min(lo, bs[i].l); }
      if (!(b.c < (hi + lo) / 2)) continue;
    }
    let zone = null;
    // la mèche entre dans la zone et la bougie clôture au-dessus de son bas ; on garde la zone la plus récente
    for (const x of actives) if (b.l <= x.haut && b.c >= x.bas && (!zone || x.iForme > zone.iForme)) zone = x;
    if (zone) out.push({ q: q, zone: zone });
  }
  return out;
}

// Suit une position ouverte au marché (bougies M15 à partir de k0). Prix des données = bid :
// un achat sort au bid, une vente sort à l'ask (bid + spread). Stop compté en premier.
function suivre(M15, k0, dir, E, sl, tp, spread, dureeMaxJours) {
  const R = Math.abs(E - sl), tLimite = M15[k0].time + dureeMaxJours * 86400000;
  for (let k = k0; k < M15.length; k++) {
    const b = M15[k];
    const bas = dir > 0 ? b.low : b.low + spread, haut = dir > 0 ? b.high : b.high + spread, ouv = dir > 0 ? b.open : b.open + spread;
    if (dir > 0 ? bas <= sl : haut >= sl) {
      const px = dir * (ouv - sl) < 0 ? ouv : sl; // gap au-delà du stop : sortie à l'ouverture
      return { statut: 'clôturé', issue: 'stop', R: dir * (px - E) / R, tFin: b.time };
    }
    if (dir > 0 ? haut >= tp : bas <= tp) return { statut: 'clôturé', issue: 'TP', R: dir * (tp - E) / R, tFin: b.time };
    if (b.time >= tLimite) { const px = dir > 0 ? b.close : b.close + spread; return { statut: 'clôturé', issue: 'durée max', R: dir * (px - E) / R, tFin: b.time }; }
  }
  return { statut: 'fin des données', R: 0, tFin: M15[M15.length - 1].time };
}

function backtesterActif(actif, M15, ut, P, depuis, jusqua) {
  actif = Object.assign({}, actif, { spread: actif.spread * P.spreadFacteur });
  const dureeUt = ut * 60000;
  const brutUt = ut === 15 ? M15 : regrouper(M15, ut);
  const tous = unitesDeTemps(M15), sup = tous[SUPERIEURE[ut]];
  const dureeSup = SUPERIEURE[ut] === 'D1' ? 86400000 : 4 * 3600000;
  const bs = versCourt(brutUt), bsSup = versCourt(sup);
  const signaux = [];
  for (const S of [1, -1]) {
    const g = S > 0 ? bs : moteur.miroir(bs), gs = S > 0 ? bsSup : moteur.miroir(bsSup);
    const dirs = directions(gs, P.pivotDirection);
    // dernière bougie supérieure clôturée à la clôture de la bougie q
    let j = -1;
    const dirSup = function (q) { const t = bs[q].t + dureeUt; while (j + 1 < gs.length && gs[j + 1].t + dureeSup <= t) j++; return j >= 0 ? dirs[j] : 0; };
    for (const s of signauxAchat(g, dirSup, P)) signaux.push({ S: S, q: s.q, zone: s.zone, g: g });
  }
  signaux.sort(function (a, b) { return a.q - b.q || b.S - a.S; });
  const trades = []; let libre = 0, k = 0;
  for (const s of signaux) {
    const b = s.g[s.q], tClot = bs[s.q].t + dureeUt;
    if (tClot < depuis || bs[s.q].t > jusqua || tClot < libre) continue;
    while (k < M15.length && M15[k].time < tClot) k++;
    if (k >= M15.length) break;
    // achat : entrée à l'ask (clôture + spread), stop au plus bas de la mèche (bid) ; vente : entrée au bid, stop au plus haut + spread
    const dir = s.S;
    const E = dir > 0 ? b.c + actif.spread : -b.c;
    const sl = dir > 0 ? b.l : -b.l + actif.spread;
    const risque = Math.abs(E - sl);
    if (!(risque > 0)) continue;
    const tp = E + dir * P.rr * risque;
    const r = suivre(M15, k, dir, E, sl, tp, actif.spread, P.dureeMaxJours);
    trades.push({ symbole: actif.symbol, ut: NOM_UT[ut], sens: dir > 0 ? 'buy' : 'sell', tPlace: tClot, tFin: r.tFin, statut: r.statut, issue: r.issue, R: +r.R.toFixed(3),
      entree: E, stop: sl, tp: tp, zone: s.zone.type, risqueSpread: +(actif.spread / risque).toFixed(3),
      // pour les images : bougie du signal, zone POI (prix réels) et direction de l'unité supérieure
      tSignal: bs[s.q].t, zoneBas: dir > 0 ? s.zone.bas : -s.zone.haut, zoneHaut: dir > 0 ? s.zone.haut : -s.zone.bas, tZone: bs[s.zone.iForme].t, issueDetail: r.issue });
    libre = r.tFin + 1;
  }
  return trades;
}

function grouper(trades, cle) {
  const g = {};
  for (const t of trades) { const k = cle(t); (g[k] = g[k] || []).push(t); }
  const out = {}; Object.keys(g).sort().forEach(function (k) { out[k] = stats(g[k]); });
  return out;
}

function ligne(nom, s) {
  return '| ' + nom + ' | ' + s.remplis + ' | ' + (100 * s.tauxReussite).toFixed(1) + ' % | ' + s.Rtotal.toFixed(1) + ' | ' + s.Rmoyen.toFixed(3) +
    ' | ' + (Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') + ' | ' + s.drawdownR.toFixed(1) + ' | ' + s.seriePertesMax + ' |';
}
const ENTETE = '| | Trades | Réussite | R total | R moyen | PF | DD (R) | Pertes de suite |\n|---|---|---|---|---|---|---|---|';

function rapport(parUt, capital, P, depuis, jusqua) {
  const L = ['# Backtest : englobante avec prise de liquidité dans une zone POI', '',
    'Période : ' + new Date(depuis).toISOString().slice(0, 10) + ' au ' + new Date(jusqua).toISOString().slice(0, 10) +
    '. Objectif ' + P.rr + 'R, stop derrière la mèche, entrée au marché à la clôture (spread compris).', ''];
  L.push('## Résumé (en R, tous actifs)', '', ENTETE);
  for (const ut of Object.keys(parUt)) L.push(ligne(ut, stats(parUt[ut])));
  for (const ut of Object.keys(parUt)) {
    const tr = parUt[ut], cpt = simulerCompte(tr, capital);
    L.push('', '## ' + ut, '', '**Compte de ' + capital + '** (risque dégressif, 2 pertes par jour, 3 actifs au plus) : solde final ' +
      Math.round(cpt.soldeFinal) + ', drawdown max ' + (100 * cpt.drawdownMax).toFixed(1) + ' %, ' + cpt.trades.length + ' trades pris (' +
      cpt.refuses.pertesDuJour + ' refusés pour 2 pertes du jour, ' + cpt.refuses.tropDActifs + ' pour 3 actifs engagés).', '');
    L.push('### Par actif', '', ENTETE);
    const pa = grouper(tr, function (t) { return t.symbole; }); for (const k of Object.keys(pa)) L.push(ligne(k, pa[k]));
    L.push('', '### Par année', '', ENTETE);
    const an = grouper(tr, function (t) { return String(new Date(t.tPlace).getUTCFullYear()); }); for (const k of Object.keys(an)) L.push(ligne(k, an[k]));
    L.push('', '### Par type de zone POI', '', ENTETE);
    const zo = grouper(tr, function (t) { return t.zone; }); for (const k of Object.keys(zo)) L.push(ligne(k, zo[k]));
    L.push('', '### Par sens', '', ENTETE);
    const se = grouper(tr, function (t) { return t.sens; }); for (const k of Object.keys(se)) L.push(ligne(k, se[k]));
  }
  return L.join('\n') + '\n';
}

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; } }
  if (!args.donnees) { console.error('Usage : node backtest/englobante.js --donnees <dossier CSV> [--ut 60,15] [--sortie dossier]'); process.exit(1); }
  const P = Object.assign({}, DEFAUT, args.reglages ? JSON.parse(args.reglages) : {});
  const uts = String(args.ut || '60,15').split(',').map(Number);
  const depuis = Date.parse(args.depuis || '2019-03-01'), jusqua = Date.parse(args.jusqua || '2026-12-31T23:59:59Z');
  const actifs = args.actifs ? String(args.actifs).split(',') : null;
  const capital = Number(args.capital || 10000);
  const parUt = {};
  for (const ut of uts) parUt[NOM_UT[ut]] = [];
  for (const a of ACTIFS) {
    if (actifs && actifs.indexOf(a.symbol) < 0) continue;
    const f = trouverFichier(args.donnees, a); if (!f) { console.log('  (pas de fichier pour ' + a.symbol + ')'); continue; }
    const M15 = unitesDeTemps(lireCSV(f)).M15;
    for (const ut of uts) {
      const tr = backtesterActif(a, M15, ut, P, depuis, jusqua);
      parUt[NOM_UT[ut]].push.apply(parUt[NOM_UT[ut]], tr);
      const s = stats(tr);
      console.log('  ' + a.symbol.padEnd(12) + NOM_UT[ut].padEnd(4) + ' ' + String(s.remplis).padStart(5) + ' trades, ' + (100 * s.tauxReussite).toFixed(1) + ' %, ' + s.Rtotal.toFixed(1) + ' R');
    }
  }
  const texte = rapport(parUt, capital, P, depuis, jusqua);
  console.log('\n' + texte);
  if (args.sortie) {
    fs.mkdirSync(args.sortie, { recursive: true });
    fs.writeFileSync(path.join(args.sortie, 'rapport.md'), texte);
    fs.writeFileSync(path.join(args.sortie, 'trades.json'), JSON.stringify({ reglages: P, trades: parUt }, null, 1));
  }
}

module.exports = { DEFAUT, zonesAchat, directions, enRange, resistance, signauxAchat, suivre, backtesterActif };
