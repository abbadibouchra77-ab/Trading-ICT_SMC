// =====================================================================================
// Le « cerveau » : Claude contrôle le setup proposé par le moteur et décide.
// Le moteur repère un setup possible ; le bot dessine les graphiques H4, H1 et M15 (avec le RSI)
// et les envoie à Claude avec la stratégie de l'utilisatrice et la proposition du moteur.
// Claude regarde, raisonne comme une trader ICT / SMC et répond : prendre ou refuser, avec
// l'entrée, le stop et les objectifs. Le code applique ensuite des garde-fous que Claude ne
// peut pas contourner (2R minimum, côté du stop, compte démo, risque...).
// Ce fichier sert au backtest (Node) et au nœud n8n (appel HTTP à l'API Anthropic).
// =====================================================================================

const MODELE = 'claude-opus-5-5';

// La stratégie, telle que l'utilisatrice l'a décrite et corrigée sur ses graphiques annotés.
const STRATEGIE = `Tu es le cerveau d'un bot de trading ICT / SMC (compte DÉMO). Le moteur du bot a repéré un setup possible.
Tu regardes les graphiques comme une trader expérimentée, tu contrôles le setup et tu décides : le prendre ou le refuser.
Un refus coûte peu ; un mauvais trade coûte cher. Ne prends que les setups propres et lisibles.

LA STRATÉGIE
1. Vision du marché (Monthly / Weekly / Daily) : direction globale, dealing range (prime / décote), liquidité visée (DOL).
   Elle oriente, elle ne bloque pas.
2. Direction : la dernière cassure de structure faite avec DÉPLACEMENT (grande bougie), en structure EXTERNE.
   - Un BOS / CHoCH n'est valable que si le CORPS d'une bougie clôture au-delà du vrai extrême du swing.
     Casser un creux interne, ou dépasser le vrai creux seulement par une mèche, ne compte pas (faux BOS).
   - Un retracement lent en petites bougies ne change pas la direction ; un CHoCH avec déplacement, si.
   - On ne trade que dans le sens du H4, et le H1 doit aller dans le même sens.
   - Si le H4 / H1 est dans un range, sa direction ne compte pas : c'est l'AMD du range qui la donne.
3. Setup (H4) : jambe qui casse la structure (point A = origine, idéalement un balayage de liquidité ; point B = extrême),
   puis retour dans la décote (achat) ou la prime (vente) : OTE Fibonacci 62-79 % de la jambe, dans une zone d'intérêt
   (FVG, OB, breaker, IFVG, BPR), avec une mèche de liquidation.
4. AMD (toutes unités de temps) : range (accumulation) ; une ou plusieurs LONGUES mèches bien visibles sortent du range
   d'un côté et reviennent dedans (manipulation), la mèche va chercher un FVG formé avant le range ; puis la distribution
   part JUSTE APRÈS la mèche dans l'autre sens, avec déplacement et volume. Une cassure du range qui revient dedans
   n'est pas un BOS : c'est une manipulation. Sans mèche, une ou plusieurs bougies pleines qui clôturent hors du range
   annoncent une continuation.
5. Confirmations (utiles, jamais suffisantes seules) : divergence RSI, RSI qui casse la zone 50 dans le sens du trade,
   OTE Fibonacci, OB + FVG superposés, SMT, killzone (Londres 02h-05h, New York 07h-11h, heure de New York), volume.
6. Entrée : TOUJOURS en M15. Ordre limite au retour du prix, au 50 % du FVG de la jambe / de la distribution, dans la
   décote (achat) ou la prime (vente). Jamais après que le mouvement est fait ; on ne court pas après le prix.
7. Stop : au-delà du point A (l'origine du mouvement) ou de la mèche de manipulation. Jamais collé à l'entrée, jamais juste
   derrière une liquidité encore intacte (creux / sommets égaux) : c'est là que le marché va chercher les stops.
8. Objectifs : TP1 = la première vraie liquidité en face, à portée (pas un niveau très lointain), à au moins 2R ;
   TP2 = la liquidité suivante. S'il n'y a pas 2R jusqu'à une liquidité réaliste : pas de trade.

REFUSE LE SETUP SI :
- le prix est dans un range (il touche plusieurs fois le haut et le bas), quelle que soit la durée, et l'entrée serait dedans ;
- le graphique n'est pas propre : trop de bruit, grandes mèches dans tous les sens, bougies qui se chevauchent sans direction ;
- l'entrée arrive après le mouvement (le prix est déjà loin de la zone, en décote pour une vente / en prime pour un achat) ;
- le dernier BOS / CHoCH est faux (mèche, creux interne) ou va contre le trade, en H4, H1 ou M15 (après un CHoCH avec
  déplacement en M15 contre le trade, on attend) ;
- la « manipulation » n'a pas de vraie longue mèche, ou la distribution ne part pas juste après ;
- le stop est trop proche, ou l'objectif irréaliste ;
- tu as le moindre doute sérieux sur la lecture.

TU PEUX AJUSTER : si le setup est bon mais l'entrée, le stop ou l'objectif du moteur sont mal placés, donne les bons niveaux
(entrée au 50 % du bon FVG M15, stop au-delà du bon point A / de la mèche, TP sur la bonne liquidité). Garde le même sens
que le moteur ; si le bon trade est dans l'autre sens, refuse et explique-le.

LES GRAPHIQUES
Trois images : H4, H1 et M15. Bougies bleues = haussières, rouges = baissières. Panneau du bas = RSI 14 (lignes 30 / 50 / 70,
la ligne 50 en tirets). Trait vertical pointillé à droite = maintenant. Lignes : noire = entrée proposée, rouge en tirets = stop,
verte en pointillés = objectifs, violette = point A, orange = point B ; bande orange = zone d'entrée (FVG / OTE).
L'échelle de prix (haut / bas de chaque image) et les heures sont données en texte. Les prix exacts sont dans le texte ;
les images servent à lire la structure.

Réponds en français simple. Dans « controle », passe en revue les points ci-dessus (direction, range, propreté, structure,
zone et OTE, mèche / liquidité, RSI, entrée, stop, objectif), un point par ligne, avec ton constat.`;

// Réponse structurée imposée (sortie JSON validée par l'API)
const SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string', enum: ['prendre', 'refuser'] },
    qualite: { type: 'string', enum: ['A+++', 'A++', 'refus'] },
    entree: { type: 'number' },
    stop: { type: 'number' },
    tp1: { type: 'number' },
    tp2: { type: 'number' },
    controle: { type: 'array', items: { type: 'string' } },
    raison: { type: 'string' }
  },
  required: ['decision', 'qualite', 'entree', 'stop', 'tp1', 'tp2', 'controle', 'raison'],
  additionalProperties: false
};

function heure(t) { return t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '?'; }

// cas = { symbole, maintenant, lecture (r du moteur : sens, entree, stop, tp1, tp2, scenario, lecture, confirmations...),
//         images: { H4, H1, M15 } (résultats de graphique.dessiner) }
// Renvoie le corps de la requête POST /v1/messages (et les en-têtes à ajouter).
function demande(cas) {
  const r = cas.lecture;
  const contenu = [];
  ['H4', 'H1', 'M15'].forEach(function (ut) {
    const im = cas.images[ut];
    if (!im) return;
    contenu.push({ type: 'text', text: 'Graphique ' + ut + ' : ' + im.bougies + ' bougies du ' + heure(im.debut) + ' au ' + heure(im.fin) +
      ' ; haut de l\'image ' + +im.haut.toFixed(5) + ', bas de l\'image ' + +im.bas.toFixed(5) + '.' });
    contenu.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: im.base64 } });
  });
  contenu.push({ type: 'text', text: [
    'Actif : ' + cas.symbole + '. Maintenant : ' + heure(cas.maintenant) + '. Dernier prix : ' + cas.prix + '.',
    'Proposition du moteur : ' + (r.sens === 'buy' ? 'ACHAT' : 'VENTE') + ' (' + (r.scenario || '?') + ', ' + (r.grade || '') + ').',
    'Entrée ' + r.entree + ' (' + (r.typeEntree || '') + '), stop ' + r.stop + ', TP1 ' + r.tp1 + (r.tp1Nom ? ' (' + r.tp1Nom + ')' : '') +
      ', TP2 ' + (r.tp2 === null || r.tp2 === undefined ? 'aucun' : r.tp2 + (r.tp2Nom ? ' (' + r.tp2Nom + ')' : '')) + '.',
    'Point A ' + r.pointA + ', point B ' + r.pointB + '.',
    'Lecture du moteur : ' + (r.lecture || ''),
    'Confirmations relevées par le moteur : ' + (r.confirmations || []).join(' ; '),
    '',
    'Contrôle ce setup sur les graphiques et décide. Si tu le prends, donne tes niveaux (entrée, stop, TP1, TP2 ; TP2 = 0 s\'il n\'y en a pas). Si tu le refuses, mets 0 aux niveaux.'
  ].join('\n') });
  return {
    entetes: { 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    corps: {
      model: MODELE,
      max_tokens: 16000,
      fallbacks: 'default', // si le modèle refuse pour raison de sécurité, l'API relance sur le modèle de secours
      system: [{ type: 'text', text: STRATEGIE, cache_control: { type: 'ephemeral' } }], // la stratégie est mise en cache
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: contenu }]
    }
  };
}

// Lit la réponse de l'API (objet message). Renvoie { decision, ... } ou { decision: 'refuser', raison: erreur }.
function lireReponse(message) {
  if (!message || message.stop_reason === 'refusal') return { decision: 'refuser', qualite: 'refus', raison: 'Claude a refusé de répondre (sécurité).', controle: [] };
  if (message.stop_reason === 'max_tokens') return { decision: 'refuser', qualite: 'refus', raison: 'Réponse coupée (max_tokens).', controle: [] };
  const texte = (message.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  try { return JSON.parse(texte); } catch (e) { return { decision: 'refuser', qualite: 'refus', raison: 'Réponse illisible : ' + texte.slice(0, 200), controle: [] }; }
}

// Garde-fous : Claude décide, mais ne peut pas contourner ces règles.
function controler(decision, sens, prix, rrMin) {
  rrMin = rrMin || 2;
  if (decision.decision !== 'prendre') return { ok: false, raison: 'Claude refuse : ' + decision.raison };
  const S = sens === 'buy' ? 1 : -1;
  const e = decision.entree, st = decision.stop, t1 = decision.tp1;
  if (![e, st, t1].every(Number.isFinite)) return { ok: false, raison: 'Niveaux manquants dans la réponse de Claude.' };
  if (!(S * (e - st) > 0)) return { ok: false, raison: 'Stop du mauvais côté de l\'entrée.' };
  if (!(S * (t1 - e) > 0)) return { ok: false, raison: 'TP1 du mauvais côté de l\'entrée.' };
  const rr = S * (t1 - e) / (S * (e - st));
  if (rr < rrMin - 1e-9) return { ok: false, raison: 'TP1 à ' + rr.toFixed(2) + 'R seulement (minimum ' + rrMin + 'R).' };
  if (!(S * (prix - e) > 0)) return { ok: false, raison: 'Le prix a déjà passé l\'entrée : ordre limite impossible.' };
  return { ok: true, rr1: +rr.toFixed(2) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { MODELE, STRATEGIE, SCHEMA, demande, lireReponse, controler };
