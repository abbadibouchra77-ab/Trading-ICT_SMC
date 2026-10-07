# Une image par actif, UN trade perdant en grand (le plus récent de la période), avec la lecture du bot.
# Usage : python3 backtest/images_trade.py <dossier des CSV> <dossier du backtest> <dossier des images> [rang]
#   rang = 1 pour le dernier trade perdant, 2 pour l'avant-dernier, etc.
# Graphique M15 (H1 si le trade dure longtemps) : entrée, stop, TP1, TP2, moment du remplissage et de la sortie,
# points A / B du contexte ; sous le graphique, l'histoire racontée par le bot au moment de placer l'ordre.
import sys, os, json, glob, subprocess, textwrap
from datetime import datetime, timezone
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

HAUSSE, BAISSE = '#2a78d6', '#e34948'
ENCRE, ENCRE2, DISCRET, GRILLE, FOND = '#0b0b0b', '#52514e', '#898781', '#e1e0d9', '#fcfcfb'
ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ICI)
from images_pertes import lire_csv, regrouper, bisect

def heure(t): return datetime.fromtimestamp(t / 1000, timezone.utc).strftime('%d/%m/%Y %H:%M')

def image(donnees, b, tr, lec, sym, nom, quoi='trade perdant'):
    t = b[0]
    i0, i1 = bisect(t, tr['tPlace']), bisect(t, tr['tFin']) + 1
    minutes = 15 if i1 - i0 <= 100 else 60
    pas = minutes // 15
    bars = regrouper(b, max(0, i0 - 140 * pas), min(len(t), i1 + 40 * pas), minutes)
    ts = [x[0] for x in bars]
    fig = plt.figure(figsize=(16, 11.5)); fig.patch.set_facecolor(FOND)
    ax = fig.add_axes((0.05, 0.36, 0.86, 0.56)); ax.set_facecolor(FOND)
    for k, (bt, o, h, l, c) in enumerate(bars):
        col = HAUSSE if c >= o else BAISSE
        ax.plot([k, k], [l, h], color=col, linewidth=0.9, zorder=2)
        ax.add_patch(Rectangle((k - 0.35, min(o, c)), 0.7, max(abs(c - o), 1e-12), facecolor=col, edgecolor=col, linewidth=0, zorder=3))
    def k_de(tm): return bisect(ts, tm - minutes * 60000 + 1)
    kp, kr, kf = k_de(tr['tPlace']), k_de(tr['tRempli']) if tr.get('tRempli') else None, k_de(tr['tFin'])
    ax.axvspan(kp - 0.5, kf + 0.5, color=GRILLE, alpha=0.55, zorder=1, linewidth=0)
    n = len(bars)
    lo = min(x[3] for x in bars); hi = max(x[2] for x in bars)
    lignes = [('entrée', tr['entree'], ENCRE, '-', 1.4), ('stop', tr['stop'], ENCRE2, '--', 1.2), ('TP1', tr['tp1'], ENCRE2, ':', 1.2), ('TP2', tr.get('tp2'), DISCRET, ':', 1.0)]
    for nom_l, p, col, st, lw in lignes:
        if p is None or not (lo - (hi - lo) * 0.6 <= p <= hi + (hi - lo) * 0.6): continue
        ax.axhline(p, color=col, linestyle=st, linewidth=lw, zorder=4)
        ax.text(n + 0.3, p, '%s  %s' % (nom_l, p), color=ENCRE, fontsize=9, va='center', ha='left', clip_on=False)
        lo, hi = min(lo, p), max(hi, p)
    for nom_l, p in (('point A contexte', lec.get('pointA')), ('point B contexte', lec.get('pointB'))):
        if p is not None and lo - (hi - lo) * 0.25 <= p <= hi + (hi - lo) * 0.25:
            ax.axhline(p, color=DISCRET, linestyle='-.', linewidth=0.8, zorder=1)
            ax.text(-1, p, nom_l + ' ', color=DISCRET, fontsize=8, va='bottom', ha='left')
            lo, hi = min(lo, p), max(hi, p)
    marge = (hi - lo) * 0.05 or 1
    ax.set_ylim(lo - marge, hi + marge * 4); ax.set_xlim(-1.5, n + 0.5)
    for j, (k, txt) in enumerate(((kp, 'ordre placé'), (kr, 'ordre rempli'), (kf, 'sortie'))):
        if k is None: continue
        ax.axvline(k, color=DISCRET, linewidth=0.7, linestyle='-', zorder=1)
        ax.text(k, hi + marge * (0.3 + 1.1 * j), ' ' + txt, color=ENCRE2, fontsize=8, ha='left', va='bottom')
    # axe du temps : quelques repères
    reps = list(range(0, n, max(1, n // 8)))
    ax.set_xticks(reps); ax.set_xticklabels([datetime.fromtimestamp(ts[k] / 1000, timezone.utc).strftime('%d/%m %H:%M') for k in reps], fontsize=8, color=DISCRET)
    ax.tick_params(axis='y', labelsize=8, colors=DISCRET)
    ax.grid(axis='y', color=GRILLE, linewidth=0.5)
    for s in ax.spines.values(): s.set_color(GRILLE)
    sens = 'achat' if tr['sens'] == 'buy' else 'vente'
    ut = 'M15' if minutes == 15 else 'H1'
    fig.text(0.05, 0.965, '%s : %s du %s UTC (%s, %s, %s)' % (sym, quoi, heure(tr['tPlace']), sens, tr.get('scenario') or '?', tr.get('grade') or ''),
             fontsize=15, color=ENCRE, ha='left', va='top')
    fig.text(0.05, 0.935, (('Ordre expiré sans être rempli, %.2fR' if tr.get('statut') == 'expiré' else 'Résultat %.2fR') + ' · %s · bougies %s, heure UTC · gris = de l\'ordre placé à la sortie') % (tr['R'], (tr.get('killzone') or '-') if str(tr.get('killzone')).startswith('hors') else 'killzone ' + str(tr.get('killzone')), ut),
             fontsize=10, color=ENCRE2, ha='left', va='top')
    # la lecture du bot
    texte = 'Lecture du bot au moment de placer l\'ordre :\n' + '\n'.join(textwrap.fill(x.strip() + ('.' if not x.strip().endswith('.') else ''), 175)
                                                                          for x in (lec.get('lecture') or '').split('. ') if x.strip())
    if lec.get('confirmations'):
        texte += '\n\nConfirmations : ' + textwrap.fill(' ; '.join(c.split(' ', 1)[1] if c.startswith('+') else c for c in lec['confirmations']), 175)
    fig.text(0.05, 0.30, texte, fontsize=8.6, color=ENCRE, ha='left', va='top', linespacing=1.45)
    fig.savefig(nom, dpi=100, facecolor=FOND)
    plt.close(fig)

def main():
    donnees, dossier, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
    rang = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    os.makedirs(sortie, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(dossier, 'trades_*.json'))):
        res = json.load(open(f)); sym = res['symbole']
        pertes = sorted([x for x in res['trades'] if x.get('statut') != 'expiré' and x.get('R', 0) < 0], key=lambda x: x['tPlace'])
        if len(pertes) < rang: continue
        tr = pertes[-rang]
        sortie_js = subprocess.run(['node', os.path.join(ICI, 'relire.js'), donnees, sym, str(tr['tPlace'])], capture_output=True, text=True).stdout.strip()
        lec = json.loads(sortie_js.splitlines()[-1]) if sortie_js else {}
        nom = os.path.join(sortie, 'trade_perdant_%s.png' % sym.replace(' ', '_'))
        image(donnees, lire_csv(os.path.join(donnees, sym + '.csv')), tr, lec, sym, nom)
        print(nom)

if __name__ == '__main__':
    main()
