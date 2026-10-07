// Passe des résultats en R (par actif) au compte réel : risque dégressif selon le solde,
// au plus 2 pertes par jour (jour de Paris), au plus 3 actifs engagés en même temps.
// Puis calcule les statistiques du rapport.

const PALIERS = [[7500, 5], [10000, 4], [15000, 3.5], [20000, 3], [30000, 2.5], [50000, 2], [100000, 1.5]];
function risqueSelonSolde(s) { for (const p of PALIERS) if (s < p[0]) return p[1]; return 1; }

const _fmtParis = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
function jourParis(t) { return _fmtParis.format(t); }
function annee(t) { return new Date(t).getUTCFullYear(); }

// trades : tous les trades de tous les actifs (sortie de simulation.js)
function simulerCompte(trades, capital, options) {
  options = options || {};
  const maxPertes = options.maxPertesJour || 2, maxActifs = options.maxActifs || 3;
  const candidats = trades.filter(function (t) { return t.statut === 'clôturé' || t.statut === 'expiré'; })
    .slice().sort(function (a, b) { return a.tPlace - b.tPlace; });
  let solde = capital, plusHaut = capital, ddMax = 0;
  const pris = [], refuses = { pertesDuJour: 0, tropDActifs: 0 };
  const clotures = []; // trades acceptés en attente de clôture (pour mettre le solde à jour dans l'ordre du temps)
  const courbe = [{ t: candidats.length ? candidats[0].tPlace : 0, solde: capital }];
  function solder(jusqua) {
    clotures.sort(function (a, b) { return a.tFin - b.tFin; });
    while (clotures.length && clotures[0].tFin <= jusqua) {
      const c = clotures.shift();
      solde += c.gain; plusHaut = Math.max(plusHaut, solde);
      ddMax = Math.max(ddMax, (plusHaut - solde) / plusHaut);
      courbe.push({ t: c.tFin, solde: solde });
    }
  }
  for (const t of candidats) {
    solder(t.tPlace);
    const engages = pris.filter(function (p) { return p.tPlace <= t.tPlace && p.tFin > t.tPlace && p.symbole !== t.symbole; });
    if (uniques(engages.map(function (p) { return p.symbole; })).length >= maxActifs) { refuses.tropDActifs++; continue; }
    const jour = jourParis(t.tPlace);
    const pertes = pris.filter(function (p) { return p.statut === 'clôturé' && p.tFin <= t.tPlace && jourParis(p.tFin) === jour && p.R < -0.25; }).length;
    if (pertes >= maxPertes) { refuses.pertesDuJour++; continue; }
    const pct = risqueSelonSolde(solde);
    const gain = t.statut === 'clôturé' ? t.R * solde * pct / 100 : 0;
    const x = Object.assign({}, t, { risquePct: pct, soldeAvant: solde, gain: gain });
    pris.push(x);
    if (t.statut === 'clôturé') clotures.push(x);
  }
  solder(Infinity);
  return { capital: capital, soldeFinal: solde, drawdownMax: ddMax, trades: pris, refuses: refuses, courbe: courbe };
}

function uniques(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

// Statistiques d'une liste de trades (en R) : uniquement les trades remplis et clôturés.
function stats(trades) {
  const t = trades.filter(function (x) { return x.statut === 'clôturé'; });
  const exp = trades.filter(function (x) { return x.statut === 'expiré'; }).length;
  const gagnants = t.filter(function (x) { return x.R > 0.05; }), perdants = t.filter(function (x) { return x.R < -0.05; });
  const somme = function (a) { return a.reduce(function (s, x) { return s + x.R; }, 0); };
  let cum = 0, haut = 0, dd = 0, serie = 0, serieMax = 0;
  for (const x of t.slice().sort(function (a, b) { return a.tFin - b.tFin; })) {
    cum += x.R; haut = Math.max(haut, cum); dd = Math.max(dd, haut - cum);
    if (x.R < -0.05) { serie++; serieMax = Math.max(serieMax, serie); } else if (x.R > 0.05) serie = 0;
  }
  const gP = somme(gagnants), gN = -somme(perdants);
  return {
    ordres: trades.length, remplis: t.length, expires: exp,
    gagnants: gagnants.length, perdants: perdants.length, neutres: t.length - gagnants.length - perdants.length,
    tauxReussite: t.length ? gagnants.length / t.length : 0,
    Rtotal: somme(t), Rmoyen: t.length ? somme(t) / t.length : 0,
    profitFactor: gN > 0 ? gP / gN : (gP > 0 ? Infinity : 0),
    drawdownR: dd, seriePertesMax: serieMax
  };
}

module.exports = { simulerCompte, stats, risqueSelonSolde, jourParis, annee };
