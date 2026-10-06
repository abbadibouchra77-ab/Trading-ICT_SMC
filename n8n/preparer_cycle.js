// Prépare le cycle : règles de risque du compte, puis liste des actifs à analyser.
const cfg = $('Configuration').first().json;
const solde = nombre($('Solde du compte').first().json.balance);
// Risque dégressif : on prend le premier palier dont la limite est au-dessus du solde.
// Sécurité : jamais plus de 5 %, et 1 % si le solde est illisible.
function risqueSelonSolde(s) {
  if (!(s > 0)) return 1;
  const p = (cfg.paliersRisque || []).find(function (x) { return s < x.jusqu_a; });
  return Math.min(p ? p.risque : (Number(cfg.risqueAuDela) || 1), 5);
}
const risquePct = risqueSelonSolde(solde);
// Un ordre / une position / un deal du bot : étiquette ou commentaire SMCV / SMC-Vision.
function estDuBot(x) { const t = texteEtiquette(x) + ' ' + String(x.comment || ''); return t.indexOf(cfg.label) >= 0 || t.indexOf(cfg.commentaire) >= 0; }

// 1) Pertes du jour (jour de Paris), comptées sur les trades du bot.
//    Si le bridge ne donne pas l'étiquette des deals, on compte toutes les pertes du compte (plus prudent).
const deals = liste('Deals du jour').filter(estCloture);
const avecEtiquette = deals.some(function (d) { return texteEtiquette(d) !== ''; });
const dealsBot = avecEtiquette ? deals.filter(estDuBot) : deals;
const seuil = -0.25 * solde * risquePct / 100; // une vraie perte, pas un petit résultat négatif
const pertes = dealsBot.filter(function (d) { return netDeal(d) < seuil; }).length;
if (pertes >= cfg.maxPertesJour) return [];

// 2) Ce qui est déjà engagé : positions ouvertes et ordres en attente.
const positions = liste('Positions ouvertes');
const ordres = liste('Ordres en attente');
const engages = positions.concat(ordres).map(function (p) { return p.symbol; });
const ordresBot = ordres.filter(estDuBot);
const posEtiquette = positions.some(function (p) { return texteEtiquette(p) !== ''; });
const posBot = posEtiquette ? positions.filter(estDuBot) : positions;
// un trade = une position ou un ordre limite (deux demi-ordres comptent pour un trade par actif)
const actifsBot = uniquesSymboles(posBot.concat(ordresBot));
if (actifsBot >= cfg.maxPositionsBot) return [];
function uniquesSymboles(l) { const v = {}; l.forEach(function (x) { v[x.symbol] = 1; }); return Object.keys(v).length; }

// 3) Mémoire : les mouvements déjà tradés (pas de nouveau trade dans un mouvement déjà joué).
const il_y_a_30j = Date.now() - 30 * 86400000;
const legs = liste('Journal SMC Vision')
  .filter(function (r) { return r.statut === 'execute' && r.cle_mouvement && !/^expiré/.test(String(r.resultat || '')) && Date.parse(r.horodatage) >= il_y_a_30j; })
  .map(function (r) { return r.cle_mouvement; });

return cfg.actifs
  .filter(function (a) { return engages.indexOf(a.symbol) < 0; })
  .map(function (a) { return { json: Object.assign({}, a, { legsDejaTradees: legs, pertesDuJour: pertes, solde: solde, risquePct: risquePct }) }; });
