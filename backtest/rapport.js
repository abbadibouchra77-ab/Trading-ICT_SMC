// Rapport du backtest : par actif, par année, compte complet (risque dégressif), en français.
const fs = require('fs');
const path = require('path');
const { simulerCompte, stats, annee } = require('./portefeuille.js');

function pc(x) { return (100 * x).toFixed(1) + ' %'; }
function r2(x) { return Number.isFinite(x) ? x.toFixed(2) : '∞'; }
function argent(x) { return Math.round(x).toLocaleString('fr-FR') + ' $'; }

function ligneStats(nom, s) {
  return '| ' + nom + ' | ' + s.remplis + ' | ' + s.expires + ' | ' + pc(s.tauxReussite) + ' | ' + r2(s.Rmoyen) + ' | ' + r2(s.Rtotal) + ' | ' + r2(s.profitFactor) + ' | ' + r2(s.drawdownR) + ' | ' + s.seriePertesMax + ' |';
}
const ENTETE = '| | Trades | Ordres expirés | Réussite | R moyen | R total | Profit factor | Baisse max (R) | Pertes d\'affilée |\n|---|---|---|---|---|---|---|---|---|';

function ecrire(resultats, capital, sortie, args) {
  const tous = [].concat.apply([], resultats.map(function (r) { return r.trades; }));
  const compte = simulerCompte(tous, capital);
  const lignes = [];
  lignes.push('# Backtest SMC Vision v2');
  lignes.push('');
  lignes.push('Période : ' + (args.depuis || 'début des données') + ' → ' + (args.jusqua || 'fin des données') + '. Capital de départ : ' + argent(capital) + '.');
  lignes.push('Bot rejoué bougie M15 par bougie M15, sans regarder le futur ; ordres limites, spread, stop compté en premier si stop et objectif');
  lignes.push('sont dans la même bougie ; break-even après TP1 puis stop suiveur M15 ; risque dégressif selon le solde ; 2 pertes par jour au plus ; 3 actifs engagés au plus.');
  lignes.push('');
  lignes.push('## Compte complet');
  lignes.push('');
  const sC = stats(compte.trades);
  lignes.push('- Solde final : **' + argent(compte.soldeFinal) + '** (' + (compte.soldeFinal >= capital ? '+' : '') + pc(compte.soldeFinal / capital - 1) + ')');
  lignes.push('- Plus grosse baisse du compte : **' + pc(compte.drawdownMax) + '**');
  lignes.push('- Trades : ' + sC.remplis + ' (réussite ' + pc(sC.tauxReussite) + ', R moyen ' + r2(sC.Rmoyen) + ', profit factor ' + r2(sC.profitFactor) + ', ' + sC.seriePertesMax + ' pertes d\'affilée au pire)');
  lignes.push('- Ordres limites non déclenchés (expirés) : ' + sC.expires);
  lignes.push('- Signaux non pris à cause des règles du compte : ' + compte.refuses.pertesDuJour + ' (2 pertes du jour atteintes), ' + compte.refuses.tropDActifs + ' (déjà 3 actifs engagés)');
  lignes.push('');
  // par année (compte)
  const annees = {};
  compte.trades.forEach(function (t) { const a = annee(t.tPlace); (annees[a] = annees[a] || []).push(t); });
  lignes.push('### Par année (compte)');
  lignes.push('');
  lignes.push('| Année | Trades | Réussite | R total | Gain | Solde en fin d\'année |');
  lignes.push('|---|---|---|---|---|---|');
  Object.keys(annees).sort().forEach(function (a) {
    const s = stats(annees[a]);
    const gain = annees[a].reduce(function (x, t) { return x + t.gain; }, 0);
    const fin = compte.courbe.filter(function (p) { return annee(p.t) <= +a; }).slice(-1)[0];
    lignes.push('| ' + a + ' | ' + s.remplis + ' | ' + pc(s.tauxReussite) + ' | ' + r2(s.Rtotal) + ' | ' + argent(gain) + ' | ' + (fin ? argent(fin.solde) : '') + ' |');
  });
  lignes.push('');
  // par actif (en R, sans les règles du compte)
  lignes.push('## Par actif (en R, chaque actif seul)');
  lignes.push('');
  lignes.push(ENTETE);
  resultats.slice().sort(function (a, b) { return a.symbole.localeCompare(b.symbole); }).forEach(function (r) { lignes.push(ligneStats(r.symbole, stats(r.trades))); });
  lignes.push(ligneStats('**Tous**', stats(tous)));
  lignes.push('');
  // par scénario reconnu (tendance / AMD / cassure, H4 ou H1) et par qualité
  lignes.push('## Par scénario (en R, tous actifs)');
  lignes.push('');
  lignes.push(ENTETE);
  const parSc = {};
  tous.forEach(function (t) { [t.scenario || '?', 'qualité ' + (t.grade || '?'), 'entrée ' + ({ rejet: 'sur rejet', MSS: 'après MSS', FVG: 'au retour (FVG / OTE de la jambe)' }[t.modeEntree] || '?')].forEach(function (k) { (parSc[k] = parSc[k] || []).push(t); }); });
  Object.keys(parSc).sort().forEach(function (k) { lignes.push(ligneStats(k, stats(parSc[k]))); });
  lignes.push('');
  lignes.push('## Par actif et par année (en R)');
  resultats.slice().sort(function (a, b) { return a.symbole.localeCompare(b.symbole); }).forEach(function (r) {
    const parAn = {};
    r.trades.forEach(function (t) { const a = annee(t.tPlace); (parAn[a] = parAn[a] || []).push(t); });
    lignes.push('');
    lignes.push('### ' + r.symbole + ' (' + r.analyses + ' lectures complètes, ' + r.secondes + ' s de calcul)');
    lignes.push('');
    lignes.push(ENTETE);
    Object.keys(parAn).sort().forEach(function (a) { lignes.push(ligneStats(a, stats(parAn[a]))); });
  });
  lignes.push('');
  lignes.push('## Ce que ce backtest ne montre pas');
  lignes.push('');
  lignes.push('- Le spread est une moyenne fixe par actif ; les commissions, le swap et le glissement ne sont pas comptés.');
  lignes.push('- Le volume est le volume des données fournies (tick volume) : il peut différer de celui du broker.');
  lignes.push('- Les signaux bloqués par les règles du compte ne libèrent pas l\'actif pour un autre signal (petite approximation).');
  fs.writeFileSync(path.join(sortie, 'rapport.md'), lignes.join('\n'));
  // trades.csv
  const col = ['symbole', 'sens', 'scenario', 'grade', 'note', 'killzone', 'statut', 'placé', 'rempli', 'fin', 'entree', 'stop', 'tp1', 'tp2', 'R', 'risquePct', 'gain'];
  const iso = function (t) { return t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : ''; };
  const csv = [col.join(';')].concat(compte.trades.map(function (t) {
    return [t.symbole, t.sens, t.scenario, t.grade, t.note, t.killzone, t.statut, iso(t.tPlace), iso(t.tRempli), iso(t.tFin), t.entree, t.stop, t.tp1, t.tp2, t.R, t.risquePct, Math.round(t.gain * 100) / 100].join(';');
  }));
  fs.writeFileSync(path.join(sortie, 'trades.csv'), csv.join('\n'));
  fs.writeFileSync(path.join(sortie, 'resultats.json'), JSON.stringify({ compte: { soldeFinal: compte.soldeFinal, drawdownMax: compte.drawdownMax, refuses: compte.refuses, stats: sC, courbe: compte.courbe },
    parActif: resultats.map(function (r) { return { symbole: r.symbole, stats: stats(r.trades), analyses: r.analyses, secondes: r.secondes }; }) }, null, 1));
  return compte;
}

module.exports = { ecrire };
