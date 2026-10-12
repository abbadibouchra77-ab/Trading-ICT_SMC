# Images des trades perdants de la stratégie « englobante avec prise de liquidité dans une zone POI ».
# Un trade par image : le plus récent trade perdant de chaque actif, pour chaque unité de temps.
# Usage : python3 backtest/images_englobante.py <dossier des CSV> <trades.json de englobante.js> <dossier des images> [rang]
#   rang = 1 pour le dernier trade perdant, 2 pour l'avant-dernier, etc.
# Le graphique est dans l'unité de temps du signal (H1 ou M15) : zone POI, bougie précédente et englobante
# encadrées, entrée, stop, TP, moment de la sortie.
import sys, os, json
from datetime import datetime, timezone
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from images_pertes import lire_csv, regrouper, bisect

HAUSSE, BAISSE = '#2a78d6', '#e34948'
ENCRE, ENCRE2, DISCRET, GRILLE, FOND = '#0b0b0b', '#52514e', '#898781', '#e1e0d9', '#fcfcfb'
ZONE = '#f2c14e'
MINUTES = {'M15': 15, 'M20': 20, 'M30': 30, 'M45': 45, 'H1': 60}
SUP = {'H1': 'Daily', 'M15': 'H4', 'M20': 'H4', 'M30': 'H4', 'M45': 'H4'}

def heure(t): return datetime.fromtimestamp(t / 1000, timezone.utc).strftime('%d/%m/%Y %H:%M')

def image(b, tr, nom):
    m = MINUTES[tr['ut']]; d = m * 60000
    t = b[0]
    debut = min(tr['tZone'], tr['tSignal'] - 50 * d) - 5 * d
    fin = tr['tFin'] + 12 * d
    bars = regrouper(b, bisect(t, debut), bisect(t, fin), m)
    ts = [x[0] for x in bars]
    def k_de(tm): return bisect(ts, tm - d + 1)  # bougie qui contient l'instant tm
    kq = bisect(ts, tr['tSignal']); kz = bisect(ts, tr['tZone']); kf = k_de(tr['tFin'])
    n = len(bars)
    fig = plt.figure(figsize=(15, 8.5)); fig.patch.set_facecolor(FOND)
    ax = fig.add_axes((0.05, 0.08, 0.82, 0.76)); ax.set_facecolor(FOND)
    lo = min(x[3] for x in bars); hi = max(x[2] for x in bars)
    # zone POI : de sa formation jusqu'au signal
    ax.add_patch(Rectangle((kz - 0.5, tr['zoneBas']), kq - kz + 1, tr['zoneHaut'] - tr['zoneBas'], facecolor=ZONE, alpha=0.35, edgecolor=ZONE, linewidth=1, zorder=1))
    ax.text(kz - 0.4, tr['zoneHaut'], ' POI %s %s' % (tr['ut'], tr['zone']), fontsize=9, color=ENCRE2, va='bottom', ha='left', zorder=6)
    for k, (bt, o, h, l, c) in enumerate(bars):
        col = HAUSSE if c >= o else BAISSE
        ax.plot([k, k], [l, h], color=col, linewidth=0.9, zorder=2)
        ax.add_patch(Rectangle((k - 0.35, min(o, c)), 0.7, max(abs(c - o), 1e-12), facecolor=col, edgecolor=col, linewidth=0, zorder=3))
    # bougie précédente + englobante encadrées
    pl, ph = min(bars[kq - 1][3], bars[kq][3]), max(bars[kq - 1][2], bars[kq][2])
    ax.add_patch(Rectangle((kq - 1.5, pl), 2, ph - pl, fill=False, edgecolor=ENCRE, linewidth=1.2, linestyle='-', zorder=5))
    ax.text(kq - 1.5, ph, 'précédente + englobante ', fontsize=8.5, color=ENCRE, ha='right', va='bottom')
    # niveaux du trade, à partir du signal
    for nom_l, p, col, st in (('entrée', tr['entree'], ENCRE, '-'), ('stop', tr['stop'], BAISSE, '--'), ('TP %dR' % round((tr['tp'] - tr['entree']) / (tr['entree'] - tr['stop'])), tr['tp'], HAUSSE, '--')):
        ax.plot([kq + 0.5, n - 0.5], [p, p], color=col, linestyle=st, linewidth=1.2, zorder=4)
        ax.text(n + 0.2, p, '%s  %.5g' % (nom_l, p), color=col, fontsize=9, va='center', ha='left', clip_on=False)
        lo, hi = min(lo, p), max(hi, p)
    ax.axvspan(kq + 0.5, kf + 0.5, color=GRILLE, alpha=0.45, zorder=0, linewidth=0)
    ax.axvline(kf, color=DISCRET, linewidth=0.8, zorder=1)
    marge = (hi - lo) * 0.05 or 1
    ax.text(kf, hi + marge * 0.5, ' sortie (%s)' % tr.get('issueDetail', tr.get('issue', '')), fontsize=8.5, color=ENCRE2, ha='left', va='bottom')
    ax.set_ylim(lo - marge, hi + marge * 2.5); ax.set_xlim(-1, n + 0.5)
    reps = list(range(0, n, max(1, n // 8)))
    ax.set_xticks(reps); ax.set_xticklabels([datetime.fromtimestamp(ts[k] / 1000, timezone.utc).strftime('%d/%m %H:%M') for k in reps], fontsize=8, color=DISCRET)
    ax.tick_params(axis='y', labelsize=8, colors=DISCRET)
    ax.grid(axis='y', color=GRILLE, linewidth=0.5)
    for s in ax.spines.values(): s.set_color(GRILLE)
    sens = 'achat' if tr['sens'] == 'buy' else 'vente'
    fig.text(0.05, 0.965, '%s %s : trade perdant du %s UTC (%s)' % (tr['symbole'], tr['ut'], heure(tr['tSignal']), sens), fontsize=15, color=ENCRE, ha='left', va='top')
    fig.text(0.05, 0.925, 'Résultat %.2fR · direction %s %s · zone POI %s %s · entrée à la clôture de l\'englobante (spread compris), stop derrière la mèche · heure UTC'
             % (tr['R'], SUP[tr['ut']], 'haussière' if tr['sens'] == 'buy' else 'baissière', tr['ut'], tr['zone']), fontsize=10, color=ENCRE2, ha='left', va='top')
    fig.savefig(nom, dpi=100, facecolor=FOND)
    plt.close(fig)

def main():
    donnees, fichier, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
    rang = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    os.makedirs(sortie, exist_ok=True)
    parUt = json.load(open(fichier))['trades']
    cache = {}
    for ut, trades in parUt.items():
        for sym in sorted(set(x['symbole'] for x in trades)):
            pertes = sorted([x for x in trades if x['symbole'] == sym and x['statut'] == 'clôturé' and x['R'] < 0], key=lambda x: x['tSignal'])
            if len(pertes) < rang: continue
            if sym not in cache: cache[sym] = lire_csv(os.path.join(donnees, sym + '.csv'))
            nom = os.path.join(sortie, 'perte_%s_%s.png' % (ut, sym.replace(' ', '_')))
            image(cache[sym], pertes[-rang], nom)
            print(nom)

if __name__ == '__main__':
    main()
