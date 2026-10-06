// Construit le code du workflow n8n (format « Workflow SDK ») à partir des fichiers du dépôt.
// Usage : node build/construire.js  ->  écrit n8n/workflow.sdk.js
const fs = require('fs');
const path = require('path');
const racine = path.join(__dirname, '..');
const lire = function (f) { return fs.readFileSync(path.join(racine, f), 'utf8'); };

// Le moteur sans la ligne d'export (inutile dans n8n)
const moteur = lire('src/moteur.js').split("if (typeof module !== 'undefined'")[0];
const outils = lire('n8n/outils.js');
const code = {
  config: lire('n8n/config.js'),
  preparer: outils + '\n' + lire('n8n/preparer_cycle.js'),
  lecture: moteur + '\n' + outils + '\n' + lire('n8n/lecture.js'),
  taille: outils + '\n' + lire('n8n/taille.js'),
  rassembler: lire('n8n/rassembler.js'),
  resultats: outils + '\n' + lire('n8n/resultats.js')
};
const J = JSON.stringify;
const TABLE = 'T1SH2vr9hn0f1Ahm';
const CRED = "{ httpCustomAuth: { id: 'GzHnBe6xw3Ftik1U', name: 'CtraderFusion-Demo' } }";
const BRIDGE = "{{ $('Configuration').first().json.bridgeUrl }}";
const SYMBOLE = "{{ encodeURIComponent($('Actif en cours').first().json.symbol) }}";

function http(nomVar, nom, url, extra) {
  return `const ${nomVar} = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: ${J(nom)},
    executeOnce: true,
    alwaysOutputData: true,
    ${extra || ''}
    parameters: { method: 'GET', url: expr(${J(url)}), authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', options: {} },
    credentials: ${CRED}
  }
});
`;
}
function bougies(nomVar, nom, tf, limite) {
  return `const ${nomVar} = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: ${J(nom)},
    executeOnce: true,
    alwaysOutputData: true,
    onError: 'continueRegularOutput',
    parameters: {
      method: 'GET',
      url: expr(${J(BRIDGE + '/symbols/' + SYMBOLE + '/candles')}),
      authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
      sendQuery: true,
      queryParameters: { parameters: [ { name: 'timeframe', value: ${J(tf)} }, { name: 'limit', value: ${J(String(limite))} } ] },
      options: {}
    },
    credentials: ${CRED}
  }
});
`;
}
function codeNode(nomVar, nom, src, extra) {
  return `const ${nomVar} = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: { name: ${J(nom)}, ${extra || ''} parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: ${J(src)} } }
});
`;
}
const colonnes = ['horodatage', 'symbole', 'sens', 'statut', 'lecture_topdown', 'zone', 'liquidite', 'confirmations', 'mode_entree',
  'entree', 'stop', 'tp1', 'tp2', 'rr1', 'rr2', 'volume', 'risque_montant', 'solde', 'ordres', 'cle_mouvement', 'resultat', 'resultat_montant'];
const nombres = ['entree', 'stop', 'tp1', 'tp2', 'rr1', 'rr2', 'volume', 'risque_montant', 'solde', 'resultat_montant'];
const valeurs = '{ ' + colonnes.map(function (c) { return c + ': expr(' + J('{{ $json.' + c + ' }}') + ')'; }).join(', ') + ' }';
const schema = '[' + colonnes.map(function (c) {
  return `{ id: '${c}', displayName: '${c}', required: false, defaultMatch: false, display: true, type: '${nombres.indexOf(c) >= 0 ? 'number' : 'string'}', canBeUsedToMatch: true }`;
}).join(', ') + ']';

const sdk = `import { workflow, node, trigger, sticky, ifElse, splitInBatches, nextBatch, expr } from '@n8n/workflow-sdk';

const declencheur = trigger({
  type: 'n8n-nodes-base.scheduleTrigger',
  version: 1.2,
  config: { name: 'A chaque clôture M15', parameters: { rule: { interval: [ { field: 'cronExpression', expression: '1,16,31,46 * * * *' } ] } } }
});
${codeNode('configuration', 'Configuration', code.config)}
${http('solde', 'Solde du compte', BRIDGE + '/account')}
${http('positions', 'Positions ouvertes', BRIDGE + '/positions')}
${http('ordres', 'Ordres en attente', BRIDGE + '/orders')}
${http('dealsJour', 'Deals du jour', BRIDGE + "/deals?from={{ $now.setZone('Europe/Paris').startOf('day').toUTC().toISO() }}&to={{ $now.toUTC().toISO() }}")}
${http('dealsRecents', 'Deals récents', BRIDGE + '/deals?from={{ $now.minus({ days: 14 }).toUTC().toISO() }}&to={{ $now.toUTC().toISO() }}')}
const journalLu = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Journal SMC Vision',
    executeOnce: true,
    alwaysOutputData: true,
    parameters: { resource: 'row', operation: 'get', dataTableId: { __rl: true, mode: 'id', value: '${TABLE}' }, returnAll: true }
  }
});
${codeNode('resultats', 'Résultats des trades fermés', code.resultats)}
const majJournal = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Mettre à jour le résultat',
    parameters: {
      resource: 'row', operation: 'update',
      dataTableId: { __rl: true, mode: 'id', value: '${TABLE}' },
      matchType: 'allConditions',
      filters: { conditions: [ { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.id }}') } ] },
      columns: { mappingMode: 'defineBelow', value: { resultat: expr('{{ $json.resultat }}'), resultat_montant: expr('{{ $json.resultat_montant }}') },
        schema: [ { id: 'resultat', displayName: 'resultat', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
                  { id: 'resultat_montant', displayName: 'resultat_montant', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: true } ] }
    }
  }
});
${codeNode('preparer', 'Préparer le cycle', code.preparer)}
const boucle = splitInBatches({ version: 3, config: { name: 'Un actif à la fois', parameters: { batchSize: 1, options: {} } } });
${codeNode('actifEnCours', 'Actif en cours', 'return $input.all();')}
${bougies('bMN', 'Bougies Monthly', '1M', 60)}
${bougies('bW1', 'Bougies Weekly', '1w', 120)}
${bougies('bD1', 'Bougies Daily', '1d', 400)}
${bougies('bH4', 'Bougies H4', '4h', 1000)}
${bougies('bM15', 'Bougies M15', '15m', 500)}
${codeNode('lecture', 'Lecture ICT/SMC', code.lecture)}
const siTrade = ifElse({
  version: 2.2,
  config: {
    name: 'Histoire complète ?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [ { leftValue: expr('{{ $json.action }}'), rightValue: 'trader', operator: { type: 'string', operation: 'equals' } } ],
        combinator: 'and'
      },
      options: {}
    }
  }
});
const spec = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Spécification du symbole',
    executeOnce: true,
    parameters: { method: 'GET', url: expr(${J(BRIDGE + '/symbols/' + SYMBOLE + '/specification')}), authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth', options: {} },
    credentials: ${CRED}
  }
});
${codeNode('taille', 'Taille de position', code.taille)}
const siVolume = ifElse({
  version: 2.2,
  config: {
    name: 'Volume valide ?',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [ { leftValue: expr('{{ $json.volumeValide }}'), rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } } ],
        combinator: 'and'
      },
      options: {}
    }
  }
});
const placer = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.2,
  config: {
    name: 'Placer l\\'ordre (démo)',
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: expr(${J(BRIDGE + '/order')}),
      authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth',
      sendBody: true, specifyBody: 'json',
      jsonBody: expr(${J("{{ JSON.stringify({ symbol: $json.symbole, direction: $json.sens, volume: $json.volume, stopLoss: $json.stop, takeProfit: $json.objectif, comment: $('Configuration').first().json.commentaire }) }}")}),
      options: {}
    },
    credentials: ${CRED}
  }
});
${codeNode('rassembler', 'Préparer la ligne du journal', code.rassembler)}
const journalEcrit = node({
  type: 'n8n-nodes-base.dataTable',
  version: 1.1,
  config: {
    name: 'Écrire dans le journal',
    parameters: {
      resource: 'row', operation: 'insert',
      dataTableId: { __rl: true, mode: 'id', value: '${TABLE}' },
      columns: { mappingMode: 'defineBelow', value: ${valeurs}, schema: ${schema} },
      options: {}
    }
  }
});

const note = sticky(${J(lire('n8n/note.md'))}, [declencheur, configuration], { color: 4, width: 520, height: 520 });

export default workflow('smc-vision', 'SMC Vision - Bot ICT/SMC autonome (DEMO Fusion cTrader)')
  .add(note)
  .add(declencheur)
  .to(configuration)
  .to(solde)
  .to(positions)
  .to(ordres)
  .to(dealsJour)
  .to(dealsRecents)
  .to(journalLu)
  .to(resultats)
  .to(majJournal)
  .add(journalLu)
  .to(preparer)
  .to(boucle.onEachBatch(
    actifEnCours
      .to(bMN).to(bW1).to(bD1).to(bH4).to(bM15)
      .to(lecture)
      .to(siTrade
        .onTrue(spec.to(taille).to(siVolume
          .onTrue(placer.to(rassembler.to(journalEcrit.to(nextBatch(boucle)))))
          .onFalse(rassembler)))
        .onFalse(nextBatch(boucle)))
  ));
`;
fs.writeFileSync(path.join(racine, 'n8n/workflow.sdk.js'), sdk);
console.log('n8n/workflow.sdk.js écrit (' + sdk.length + ' caractères)');
