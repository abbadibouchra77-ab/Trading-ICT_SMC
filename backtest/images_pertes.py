# Une image par actif : tous les trades perdants du backtest, un petit graphique par trade.
# Usage : python3 backtest/images_pertes.py <dossier des CSV> <dossier du backtest> <dossier des images>
# Chaque graphique : bougies autour du trade (M15, ou H1 / H4 si le trade dure longtemps),
# entrée, stop, TP1, TP2, la zone grisée = de l'ordre placé à la sortie.
import sys, os, json, csv, math, glob
from datetime import datetime, timezone
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

HAUSSE, BAISSE = '#2a78d6', '#e34948'      # bougies : paire bleu / rouge
ENCRE, ENCRE2, DISCRET, GRILLE, FOND = '#0b0b0b', '#52514e', '#898781', '#e1e0d9', '#fcfcfb'
M15 = 15 * 60000

def lire_csv(chemin):
    t, o, h, l, c = [], [], [], [], []
    with open(chemin) as f:
        r = csv.reader(f); next(r)
        for x in r:
            t.append(int(datetime.strptime(x[0], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp() * 1000))
            o.append(float(x[1])); h.append(float(x[2])); l.append(float(x[3])); c.append(float(x[4]))
    return t, o, h, l, c

def regrouper(b, i0, i1, minutes):
    t, o, h, l, c = b
    out = []
    for i in range(i0, i1):
        k = t[i] // (minutes * 60000)
        if out and out[-1][0] == k:
            x = out[-1]; x[3] = max(x[3], h[i]); x[4] = min(x[4], l[i]); x[5] = c[i]
        else:
            out.append([k, t[i], o[i], h[i], l[i], c[i]])
    return [(x[1], x[2], x[3], x[4], x[5]) for x in out]

def bisect(t, v):
    lo, hi = 0, len(t)
    while lo < hi:
        m = (lo + hi) // 2
        if t[m] < v: lo = m + 1
        else: hi = m
    return lo

def dessiner(ax, b, tr):
    t = b[0]
    debut, fin = tr['tPlace'], tr['tFin']
    i0, i1 = bisect(t, debut), bisect(t, fin) + 1
    duree = i1 - i0
    minutes = 15 if duree <= 60 else (60 if duree <= 240 else 240)
    avant, apres = 50 * minutes // 15 * 1, 12 * minutes // 15
    bars = regrouper(b, max(0, i0 - avant), min(len(t), i1 + apres), minutes)
    for k, (bt, o, h, l, c) in enumerate(bars):
        col = HAUSSE if c >= o else BAISSE
        ax.plot([k, k], [l, h], color=col, linewidth=0.6, zorder=2)
        ax.add_patch(Rectangle((k - 0.35, min(o, c)), 0.7, max(abs(c - o), 1e-12), facecolor=col, edgecolor=col, linewidth=0, zorder=3))
    ts = [x[0] for x in bars]
    kd = bisect(ts, debut - minutes * 60000 + 1); kf = bisect(ts, fin - minutes * 60000 + 1)
    ax.axvspan(kd - 0.5, kf + 0.5, color=GRILLE, alpha=0.6, zorder=1, linewidth=0)
    n = len(bars)
    lignes = [('entrée', tr['entree'], ENCRE, '-'), ('stop', tr['stop'], ENCRE2, '--'), ('TP1', tr['tp1'], ENCRE2, ':')]
    lo = min(x[3] for x in bars); hi = max(x[2] for x in bars)
    for nom, p, col, st in lignes:
        if p is None: continue
        ax.axhline(p, color=col, linestyle=st, linewidth=0.9, zorder=4)
        ax.text(n - 0.5, p, ' ' + nom, color=ENCRE2, fontsize=6, va='center', ha='left', clip_on=False)
        lo, hi = min(lo, p), max(hi, p)
    marge = (hi - lo) * 0.06 or 1
    ax.set_ylim(lo - marge, hi + marge); ax.set_xlim(-1, n)
    jour = datetime.fromtimestamp(debut / 1000, timezone.utc).strftime('%d/%m/%Y %H:%M')
    sens = 'achat' if tr['sens'] == 'buy' else 'vente'
    ut = {15: 'M15', 60: 'H1', 240: 'H4'}[minutes]
    ax.set_title('%s UTC · %s · %s · %s\n%s · %.2fR · graphique %s' % (jour, sens, tr.get('scenario') or '?', tr.get('grade') or '', tr.get('killzone') or '', tr['R'], ut),
                 fontsize=6.5, color=ENCRE, loc='left', pad=3)
    ax.tick_params(labelsize=5, colors=DISCRET, length=2)
    ax.set_xticks([])
    for s in ax.spines.values(): s.set_color(GRILLE)
    ax.set_facecolor(FOND)

def main():
    donnees, dossier, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(sortie, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(dossier, 'trades_*.json'))):
        res = json.load(open(f))
        sym = res['symbole']
        pertes = sorted([x for x in res['trades'] if x.get('statut') != 'expiré' and x.get('R', 0) < 0], key=lambda x: x['tPlace'])
        if not pertes: continue
        b = lire_csv(os.path.join(donnees, sym + '.csv'))
        cols = 8; rows = math.ceil(len(pertes) / cols)
        fig, axes = plt.subplots(rows, cols, figsize=(cols * 3.2, rows * 2.5 + 0.8), squeeze=False)
        fig.patch.set_facecolor(FOND)
        for k, ax in enumerate(axes.flat):
            if k < len(pertes): dessiner(ax, b, pertes[k])
            else: ax.axis('off')
        total = sum(x['R'] for x in pertes)
        fig.suptitle('%s : %d trades perdants (%.1fR au total) — backtest %s' % (sym, len(pertes), total, os.path.basename(os.path.normpath(dossier))),
                     fontsize=13, color=ENCRE, x=0.01, ha='left', y=0.999)
        fig.tight_layout(rect=(0, 0, 1, 1 - 0.5 / (rows * 2.5 + 0.8)))
        nom = os.path.join(sortie, 'pertes_' + sym.replace(' ', '_') + '.png')
        fig.savefig(nom, dpi=90, facecolor=FOND)
        plt.close(fig)
        print(nom, len(pertes))

main()
