// Évaluation du cerveau (Claude) sur des setups passés.
// Pour chaque cas : le moteur lit le marché à l'heure donnée ; s'il propose un setup, le bot dessine les graphiques
// H4 / H1 / M15 (avec le RSI), Claude contrôle et décide ; on simule ensuite le trade de Claude et celui du moteur seul.
// Usage :
//   node backtest/cerveau.js --donnees <dossier des CSV> --cas <fichier JSON [{symbole, temps}]> [--sortie dossier] [--sec]
//   node backtest/cerveau.js --donnees <dossier> --trades <dossier d'un backtest> --nombre 100 [--graine 1] [--sortie dossier] [--sec]
//     (--trades : tire au hasard des trades remplis d'un backtest, moitié gagnants, moitié perdants)
//   --sec : n'appelle pas Claude ; écrit seulement les images et la demande (pour vérifier sans dépenser).
//   --preparer : écrit les demandes complètes dans <sortie>/demandes/ (+ index.json) pour qu'un workflow n8n les envoie
//                à Claude avec la clé enregistrée dans n8n ; --reponses <dossier> : relit ensuite les réponses
//                (<dossier>/<cas>.json = message renvoyé par l'API) au lieu d'appeler Claude.
// Il faut la variable ANTHROPIC_API_KEY (sauf avec --sec). Coût indicatif : quelques centimes par cas.
const fs = require('fs');
const path = require('path');
const moteur = require('../src/moteur.js');
const G = require('../src/graphique.js');
const cerveau = require('../src/cerveau.js');
const { lireCSV, unitesDeTemps } = require('./donnees.js');
const { ACTIFS, trouverFichier } = require('./lancer.js');
const { suivreTrade } = require('./simulation.js');

const LIMITES = { M15: 500, H1: 500, H4: 1000, D1: 400, W1: 120, MN: 60 };
function fenetre(ut, maintenant) {
  const out = {};
  for (const u of Object.keys(LIMITES)) {
    const arr = ut[u]; let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].time < maintenant) lo = m + 1; else hi = m; }
    out[u] = arr.slice(Math.max(0, lo - LIMITES[u]), lo);
  }
  return out;
}
const VUE = { H4: 120, H1: 160, M15: 160 }; // bougies montrées à Claude
function images(f, maintenant, r) {
  const out = {};
  const lignes = [{ prix: r.entree, couleur: 'entree' }, { prix: r.stop, couleur: 'stop', tirets: 8 }, { prix: r.tp1, couleur: 'objectif', tirets: 4 },
    { prix: r.tp2, couleur: 'objectif', tirets: 4, epaisseur: 1 }, { prix: r.pointA, couleur: 'pointA', tirets: 3, epaisseur: 1 }, { prix: r.pointB, couleur: 'pointB', tirets: 3, epaisseur: 1 }]
    .filter(function (x) { return Number.isFinite(x.prix); });
  for (const ut of ['H4', 'H1', 'M15']) {
    const dur = { H4: 4 * 3600000, H1: 3600000, M15: 900000 }[ut];
    const bs = f[ut].filter(function (b) { return b.time + dur <= maintenant; }).map(function (b) { return { t: b.time, o: b.open, h: b.high, l: b.low, c: b.close }; });
    const rsi = moteur.rsiSerie(bs, 14).slice(-VUE[ut]);
    const vue = bs.slice(-VUE[ut]);
    // les lignes très loin du graphique écraseraient l'échelle : on ne garde que celles proches de la zone affichée
    let hi = -Infinity, lo = Infinity; vue.forEach(function (b) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); });
    const marge = (hi - lo) * 0.6;
    out[ut] = G.dessiner(vue, { rsi: rsi, maintenant: maintenant, lignes: lignes.filter(function (x) { return x.prix <= hi + marge && x.prix >= lo - marge; }) });
  }
  return out;
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[a.slice(2)] = v; } }
  const sortie = args.sortie || 'resultats_cerveau';
  fs.mkdirSync(sortie, { recursive: true });
  // les cas à examiner
  let cas = [];
  if (args.cas) cas = JSON.parse(fs.readFileSync(args.cas, 'utf8')).map(function (c) { return { symbole: c.symbole, temps: typeof c.temps === 'number' ? c.temps : Date.parse(c.temps) }; });
  if (args.trades) {
    let graine = Number(args.graine || 1); const alea = function () { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
    const tous = [];
    fs.readdirSync(args.trades).filter(function (f) { return /^trades_.*\.json$/.test(f); }).forEach(function (f) {
      const r = JSON.parse(fs.readFileSync(path.join(args.trades, f), 'utf8'));
      r.trades.filter(function (t) { return t.statut === 'clôturé'; }).forEach(function (t) { tous.push({ symbole: r.symbole, temps: t.tPlace, R: t.R }); });
    });
    const melanger = function (a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(alea() * (i + 1)); const x = a[i]; a[i] = a[j]; a[j] = x; } return a; };
    const N = Number(args.nombre || 20);
    cas = cas.concat(melanger(tous.filter(function (t) { return t.R > 0; })).slice(0, Math.ceil(N / 2)), melanger(tous.filter(function (t) { return t.R <= 0; })).slice(0, Math.floor(N / 2)));
  }
  if (!cas.length) { console.error('Aucun cas : donner --cas ou --trades.'); process.exit(1); }
  let client = null;
  const index = [];
  if (args.preparer) fs.mkdirSync(path.join(sortie, 'demandes'), { recursive: true });
  if (!args.sec && !args.preparer && !args.reponses) {
    const mod = require('@anthropic-ai/sdk'); const Anthropic = mod.default || mod;
    client = new Anthropic();
  }
  const donnees = {}, resultats = [];
  for (const c of cas) {
    const actif = ACTIFS.find(function (a) { return a.symbol === c.symbole; });
    if (!donnees[c.symbole]) donnees[c.symbole] = unitesDeTemps(lireCSV(trouverFichier(args.donnees, actif)));
    const ut = donnees[c.symbole], maintenant = c.temps + 60000;
    const f = fenetre(ut, maintenant);
    const r = moteur.analyserActif(c.symbole, f, null, maintenant, { legsDejaTradees: [] }, { crypto: !!actif.crypto, correle: actif.correle || '' });
    const nom = c.symbole.replace(/ /g, '_') + '_' + new Date(c.temps).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    if (r.action !== 'trader') { resultats.push({ cas: nom, moteur: 'aucun setup' }); console.log(nom + ' : le moteur ne propose rien'); continue; }
    const prix = f.M15[f.M15.length - 1].close;
    const ims = images(f, maintenant, r);
    ['H4', 'H1', 'M15'].forEach(function (u) { fs.writeFileSync(path.join(sortie, nom + '_' + u + '.png'), ims[u].png); });
    const dem = cerveau.demande({ symbole: c.symbole, maintenant: maintenant, prix: prix, lecture: r, images: ims });
    let decision;
    if (args.preparer) {
      fs.writeFileSync(path.join(sortie, 'demandes', nom + '.json'), JSON.stringify(dem));
      index.push(nom); fs.writeFileSync(path.join(sortie, 'demandes', 'index.json'), JSON.stringify(index));
      console.log(nom + ' : demande préparée (' + r.sens + ', ' + r.scenario + ')');
      continue;
    }
    if (args.reponses) {
      const fr = path.join(args.reponses, nom + '.json');
      if (!fs.existsSync(fr)) { console.log(nom + ' : pas de réponse'); continue; }
      const message = JSON.parse(fs.readFileSync(fr, 'utf8'));
      decision = message.error ? { decision: 'refuser', qualite: 'refus', raison: 'Erreur API : ' + JSON.stringify(message.error).slice(0, 200), controle: [] } : cerveau.lireReponse(message);
      decision.usage = message.usage;
    } else if (args.sec) {
      const copie = JSON.parse(JSON.stringify(dem.corps)); copie.messages[0].content.forEach(function (b) { if (b.type === 'image') b.source.data = '(' + b.source.data.length + ' caractères)'; });
      fs.writeFileSync(path.join(sortie, nom + '_demande.json'), JSON.stringify(copie, null, 1));
      decision = { decision: 'refuser', qualite: 'refus', raison: '(mode --sec : Claude non appelé)', controle: [] };
    } else {
      const corps = Object.assign({ betas: ['server-side-fallback-2026-07-01'] }, dem.corps);
      let message;
      try { message = await client.beta.messages.create(corps); }
      catch (e) { console.error(nom + ' : erreur API ' + (e.status || '') + ' ' + e.message); resultats.push({ cas: nom, erreur: String(e.message) }); continue; }
      decision = cerveau.lireReponse(message);
      decision.usage = message.usage;
    }
    const ctrl = cerveau.controler(decision, r.sens, prix, 2);
    // simulation : le trade du moteur seul, et celui de Claude (s'il le prend)
    const bs = ut.M15, k = bs.findIndex(function (b) { return b.time >= c.temps; });
    const regl = { dureeMaxJours: 20, margeBeR: 0.05, margeStopAtr: 0.1, pasMinR: 0.1 };
    const seul = suivreTrade(bs, k, r, 0, regl);
    let avecClaude = null;
    if (ctrl.ok) avecClaude = suivreTrade(bs, k, { sens: r.sens, entree: decision.entree, stop: decision.stop, tp1: decision.tp1, tp2: decision.tp2 > 0 ? decision.tp2 : null, expireA: r.expireA }, 0, regl);
    const ligne = { cas: nom, sens: r.sens, scenario: r.scenario, moteur: { entree: r.entree, stop: r.stop, tp1: r.tp1, statut: seul.statut, R: seul.R },
      claude: { decision: decision.decision, qualite: decision.qualite, entree: decision.entree, stop: decision.stop, tp1: decision.tp1, tp2: decision.tp2, raison: decision.raison, controle: decision.controle, garde_fous: ctrl.ok ? 'ok' : ctrl.raison,
        statut: avecClaude ? avecClaude.statut : 'pas de trade', R: avecClaude ? avecClaude.R : 0 }, usage: decision.usage };
    resultats.push(ligne);
    fs.writeFileSync(path.join(sortie, 'resultats.json'), JSON.stringify(resultats, null, 1));
    console.log(nom + ' : moteur ' + seul.statut + ' ' + seul.R + 'R | Claude ' + decision.decision + (ctrl.ok ? ' -> ' + avecClaude.statut + ' ' + avecClaude.R + 'R' : ' (' + (ctrl.raison || '') + ')'));
  }
  // bilan
  const evalues = resultats.filter(function (x) { return x.claude; });
  const somme = function (a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); };
  const pris = evalues.filter(function (x) { return x.claude.decision === 'prendre'; });
  const bilan = [
    'Cas évalués : ' + evalues.length,
    'Moteur seul : ' + somme(evalues, function (x) { return x.moteur.R; }).toFixed(2) + 'R au total',
    'Avec Claude : ' + pris.length + ' setups pris, ' + somme(evalues, function (x) { return x.claude.R; }).toFixed(2) + 'R au total',
    'Perdants du moteur refusés par Claude : ' + evalues.filter(function (x) { return x.moteur.R < 0 && x.claude.decision !== 'prendre'; }).length + ' / ' + evalues.filter(function (x) { return x.moteur.R < 0; }).length,
    'Gagnants du moteur refusés par Claude : ' + evalues.filter(function (x) { return x.moteur.R > 0 && x.claude.decision !== 'prendre'; }).length + ' / ' + evalues.filter(function (x) { return x.moteur.R > 0; }).length
  ];
  fs.writeFileSync(path.join(sortie, 'bilan.txt'), bilan.join('\n') + '\n');
  console.log('\n' + bilan.join('\n'));
}

main().catch(function (e) { console.error(e); process.exit(1); });
