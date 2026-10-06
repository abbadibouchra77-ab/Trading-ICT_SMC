import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const declencheur = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'Toutes les 5 minutes', parameters: { rule: { interval: [ { field: 'cronExpression', expression: '2-59/5 * * * *' } ] } } }
});
const configuration = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: "Configuration gestion",  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Réglages de la gestion des trades SMC Vision. COMPTE DÉMO UNIQUEMENT.\n// Règle (validée par Bouchra le 06/10/2026) : quand TP1 est atteint, le stop des positions restantes\n// passe à l'entrée (break-even), puis il suit la structure M15 (sous chaque nouveau creux pour un achat,\n// au-dessus de chaque nouveau sommet pour une vente). Le stop ne recule jamais.\nreturn [{ json: {\n  bridgeUrl: 'http://ctrader-bridge:8080',\n  commentaire: 'SMC-Vision',\n  label: 'SMCV',\n  margeBeR: 0.05,      // break-even : entrée + 0,05R (couvre le spread)\n  margeStopAtr: 0.1,   // stop suiveur : 0,1 ATR M15 derrière le creux / sommet\n  pasMinR: 0.1         // on ne déplace le stop que s'il avance d'au moins 0,1R\n} }];\n" } }
});

const positions = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: "Positions ouvertes",
    executeOnce: true,
    alwaysOutputData: true,
    
    parameters: { method: 'GET', url: expr("{{ $('Configuration gestion').first().json.bridgeUrl }}/positions"), authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', options: {} },
    credentials: { httpCustomAuth: { id: 'GzHnBe6xw3Ftik1U', name: 'CtraderFusion-Demo' } }
  }
});

const journalLu = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Journal SMC Vision',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'id', value: 'T1SH2vr9hn0f1Ahm' }, returnAll: true }
  }
});
const aGerer = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: "Positions à gérer",  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Petits outils communs : lire la réponse d'un nœud du bridge sous forme de liste.\nfunction liste(nom) {\n  let a = [];\n  try { a = $(nom).all().map(function (i) { return i.json; }); } catch (e) { return []; }\n  // le bridge peut renvoyer soit une liste, soit un objet qui contient la liste\n  if (a.length === 1 && a[0] && typeof a[0] === 'object') {\n    const cles = Object.keys(a[0]);\n    const k = cles.find(function (c) { return Array.isArray(a[0][c]); });\n    if (k && cles.length <= 3) a = a[0][k];\n  }\n  return a.filter(function (x) { return x && typeof x === 'object' && !x.error && Object.keys(x).length > 0; });\n}\nfunction nombre(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }\n// Résultat net d'un deal de clôture (mêmes champs que le bot principal)\nfunction netDeal(d) {\n  const c = d.closePositionDetail;\n  if (d.netProfit !== undefined && d.netProfit !== null) return nombre(d.netProfit);\n  if (c) return (nombre(c.grossProfit) || 0) + (nombre(c.swap) || 0) + (nombre(c.commission) || 0);\n  if (d.grossProfit !== undefined) return (nombre(d.grossProfit) || 0) + (nombre(d.swap) || 0) + (nombre(d.commission) || 0);\n  if (d.profit !== undefined) return nombre(d.profit);\n  return NaN;\n}\nfunction estCloture(d) { return d.type === 'close' || !!d.closePositionDetail; }\nfunction texteEtiquette(x) { return String(x.label || x.comment || ''); }\n\n// Positions à gérer : les positions ouvertes du bot SMC Vision, reliées à leur ligne du journal.\nconst cfg = $('Configuration gestion').first().json;\nfunction estDuBot(x) { const t = texteEtiquette(x) + ' ' + String(x.comment || ''); return t.indexOf(cfg.label) >= 0 || t.indexOf(cfg.commentaire) >= 0; }\nconst lignes = liste('Journal SMC Vision').filter(function (r) { return r.statut === 'execute' && r.resultat === 'ouvert'; });\nconst sorties = [];\nfor (const p of liste('Positions ouvertes')) {\n  if (!p.positionId || !p.symbol) continue;\n  const side = String(p.side || p.direction || p.tradeSide || '').toLowerCase().indexOf('sell') >= 0 ? 'sell' : 'buy';\n  const open = nombre(p.openPrice);\n  // la ligne du journal : même actif, même sens, prix d'ouverture proche de l'entrée prévue\n  const l = lignes.filter(function (r) {\n    if (r.symbole !== p.symbol || r.sens !== side) return false;\n    const R = Math.abs(nombre(r.entree) - nombre(r.stop));\n    return Number.isFinite(open) && Math.abs(open - nombre(r.entree)) <= 0.5 * R;\n  }).sort(function (a, b) { return String(b.horodatage).localeCompare(String(a.horodatage)); })[0];\n  if (!l) continue;                         // pas un trade SMC Vision connu : on n'y touche pas\n  if (texteEtiquette(p) && !estDuBot(p)) continue; // étiquette d'un autre bot : on n'y touche pas\n  sorties.push({ json: { positionId: p.positionId, symbol: p.symbol, side: side, openPrice: open, stopLoss: nombre(p.stopLoss), takeProfit: nombre(p.takeProfit),\n    ligne: { id: l.id, entree: nombre(l.entree), stop: nombre(l.stop), tp1: nombre(l.tp1), horodatage: l.horodatage, gestion: l.gestion || '' } } });\n}\nreturn sorties;\n" } }
});

const boucle = splitInBatches({ version: 3, config: { name: 'Une position à la fois', parameters: { batchSize: 1, options: {} } } });
const posEnCours = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: "Position en cours",  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "return $input.all();" } }
});

const bM15 = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Bougies M15 gestion',
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr("{{ $('Configuration gestion').first().json.bridgeUrl }}/symbols/{{ encodeURIComponent($('Position en cours').first().json.symbol) }}/candles"),
      authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
      sendQuery: true,
      queryParameters: { parameters: [ { name: 'timeframe', value: '15m' }, { name: 'limit', value: '400' } ] },
      options: {}
    },
    credentials: { httpCustomAuth: { id: 'GzHnBe6xw3Ftik1U', name: 'CtraderFusion-Demo' } }
  }
});
const decider = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: "Décider le stop",  parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: "// Petits outils communs : lire la réponse d'un nœud du bridge sous forme de liste.\nfunction liste(nom) {\n  let a = [];\n  try { a = $(nom).all().map(function (i) { return i.json; }); } catch (e) { return []; }\n  // le bridge peut renvoyer soit une liste, soit un objet qui contient la liste\n  if (a.length === 1 && a[0] && typeof a[0] === 'object') {\n    const cles = Object.keys(a[0]);\n    const k = cles.find(function (c) { return Array.isArray(a[0][c]); });\n    if (k && cles.length <= 3) a = a[0][k];\n  }\n  return a.filter(function (x) { return x && typeof x === 'object' && !x.error && Object.keys(x).length > 0; });\n}\nfunction nombre(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }\n// Résultat net d'un deal de clôture (mêmes champs que le bot principal)\nfunction netDeal(d) {\n  const c = d.closePositionDetail;\n  if (d.netProfit !== undefined && d.netProfit !== null) return nombre(d.netProfit);\n  if (c) return (nombre(c.grossProfit) || 0) + (nombre(c.swap) || 0) + (nombre(c.commission) || 0);\n  if (d.grossProfit !== undefined) return (nombre(d.grossProfit) || 0) + (nombre(d.swap) || 0) + (nombre(d.commission) || 0);\n  if (d.profit !== undefined) return nombre(d.profit);\n  return NaN;\n}\nfunction estCloture(d) { return d.type === 'close' || !!d.closePositionDetail; }\nfunction texteEtiquette(x) { return String(x.label || x.comment || ''); }\n\n// Décide s'il faut déplacer le stop d'une position.\n//  1) TP1 pas encore atteint : on ne touche à rien.\n//  2) TP1 atteint et stop encore côté perte : break-even (entrée + petite marge).\n//  3) Break-even fait : le stop suit la structure M15 (dernier creux confirmé pour un achat,\n//     dernier sommet confirmé pour une vente), sans jamais reculer.\nconst cfg = $('Configuration gestion').first().json;\nconst pos = $('Position en cours').first().json;\nconst bs = liste('Bougies M15 gestion').map(function (b) { return { t: Date.parse(b.time), o: +b.open, h: +b.high, l: +b.low, c: +b.close }; })\n  .filter(function (b) { return Number.isFinite(b.t) && Number.isFinite(b.c) && b.t + 15 * 60000 <= Date.now(); })\n  .sort(function (a, b) { return a.t - b.t; });\nconst dir = pos.side === 'sell' ? -1 : 1;\nconst l = pos.ligne;\nconst R = Math.abs(l.entree - l.stop);\nconst sl = pos.stopLoss, open = pos.openPrice;\nconst depuis = Date.parse(l.horodatage);\nconst apres = bs.filter(function (b) { return b.t >= depuis; });\nconst rien = function (raison) { return [{ json: { changer: false, positionId: pos.positionId, symbol: pos.symbol, raison: raison } }]; };\nif (!(R > 0) || !apres.length) return rien('pas assez de données');\nconst prix = bs[bs.length - 1].c;\nconst tp1Atteint = apres.some(function (b) { return dir > 0 ? b.h >= l.tp1 : b.l <= l.tp1; });\nif (!tp1Atteint) return rien('TP1 pas encore atteint');\nconst beFait = Number.isFinite(sl) && dir * (sl - open) >= 0;\nlet nouveau = null, etape = '';\nif (!beFait) { nouveau = open + dir * cfg.margeBeR * R; etape = 'break-even (TP1 atteint)'; }\nelse {\n  // ATR M15 et pivots (2 bougies de chaque côté) depuis l'entrée\n  let s = 0, k = 0; for (let i = Math.max(1, bs.length - 14); i < bs.length; i++) { s += Math.max(bs[i].h - bs[i].l, Math.abs(bs[i].h - bs[i - 1].c), Math.abs(bs[i].l - bs[i - 1].c)); k++; }\n  const atr = k ? s / k : 0;\n  let pivot = null;\n  for (let i = bs.length - 3; i >= 2 && bs[i].t >= depuis; i--) {\n    const x = dir > 0 ? bs[i].l : bs[i].h;\n    let ok = true;\n    for (let q = 1; q <= 2; q++) {\n      const a = dir > 0 ? bs[i - q].l : bs[i - q].h, b = dir > 0 ? bs[i + q].l : bs[i + q].h;\n      if (dir > 0 ? (a <= x || b < x) : (a >= x || b > x)) ok = false;\n    }\n    if (ok) { pivot = x; break; }\n  }\n  if (pivot === null) return rien('break-even fait, pas encore de nouveau ' + (dir > 0 ? 'creux' : 'sommet') + ' M15');\n  nouveau = pivot - dir * cfg.margeStopAtr * atr; etape = 'stop suiveur (structure M15)';\n}\n// le stop doit avancer d'au moins pasMinR, rester du bon côté du prix et ne jamais reculer\nif (Number.isFinite(sl) && dir * (nouveau - sl) < cfg.pasMinR * R) return rien('stop déjà à jour (' + sl + ')');\nif (dir * (prix - nouveau) <= 0) return rien('nouveau stop au-delà du prix actuel');\nnouveau = +nouveau.toFixed(6);\nconst texte = new Date().toISOString().slice(0, 16) + ' ' + etape + ' : stop ' + sl + ' -> ' + nouveau + ' (' + (dir * (nouveau - open) / R).toFixed(2) + 'R verrouillé)';\nreturn [{ json: { changer: true, positionId: pos.positionId, symbol: pos.symbol, stopLoss: nouveau, takeProfit: Number.isFinite(pos.takeProfit) ? pos.takeProfit : null,\n  idJournal: l.id, gestion: (texte + (l.gestion ? ' | ' + l.gestion : '')).slice(0, 1000) } }];\n" } }
});

const siChanger = ifElse({
  version: 2.2,
  config: {
    name: 'Déplacer le stop ?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [ { leftValue: expr('{{ $json.changer }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } } ],
        combinator: 'and'
      },
      options: {}
    }
  }
});
const modifier = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Modifier le stop (démo)',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr("{{ $('Configuration gestion').first().json.bridgeUrl }}/position/sltp"),
      authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
      sendBody: true, specifyBody: 'json',
      jsonBody: expr("{{ JSON.stringify({ positionId: $json.positionId, symbol: $json.symbol, stopLoss: $json.stopLoss, takeProfit: $json.takeProfit }) }}"),
      options: {}
    },
    credentials: { httpCustomAuth: { id: 'GzHnBe6xw3Ftik1U', name: 'CtraderFusion-Demo' } }
  }
});
const noterGestion = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Noter dans le journal',
    parameters: {
      resource: 'row', operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: 'T1SH2vr9hn0f1Ahm' },
      matchType: 'allConditions',
      filters: { conditions: [ { keyName: 'id', condition: 'eq', keyValue: expr("{{ $('Décider le stop').first().json.idJournal }}") } ] },
      columns: { mappingMode: 'defineBelow', value: { gestion: expr("{{ $('Décider le stop').first().json.gestion + ($json.error ? ' (ÉCHEC bridge : ' + JSON.stringify($json.error).slice(0, 150) + ')' : '') }}") },
        schema: [ { id: 'gestion', displayName: 'gestion', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true } ] }
    }
  }
});
const note = sticky("## SMC Vision — gestion des trades (COMPTE DÉMO)\n\nToutes les 5 minutes, pour chaque position ouverte du bot SMC Vision :\n1. **TP1 pas encore atteint** : on ne touche à rien.\n2. **TP1 atteint** : le stop passe à l'entrée (break-even + 0,05R).\n3. **Ensuite** : le stop suit la structure M15 (sous chaque nouveau creux pour un achat, au-dessus de chaque nouveau sommet pour une vente). Il ne recule jamais.\n\nChaque déplacement est noté dans la colonne *gestion* du journal **SMC_Vision_Journal**.\nNe gère jamais les positions des autres bots ni les trades manuels.\n", [declencheur, configuration], { color: 5, width: 480, height: 360 });

export default workflow('smc-vision-gestion', 'SMC Vision - Gestion des trades (DEMO Fusion cTrader)')
  .add(note)
  .add(declencheur)
  .to(configuration)
  .to(positions)
  .to(journalLu)
  .to(aGerer)
  .to(boucle.onEachBatch(
    posEnCours
      .to(bM15)
      .to(decider)
      .to(siChanger
        .onTrue(modifier.to(noterGestion.to(nextBatch(boucle))))
        .onFalse(nextBatch(boucle)))
  ));
