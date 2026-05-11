import os
import time
import json
import threading
import queue
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from models import db, Submission
from sqlalchemy import func


app = Flask(__name__)

# Configuration base de données
basedir = os.path.abspath(os.path.dirname(__file__))

# On cherche DATABASE_URL (interne) ou DATABASE_PUBLIC_URL (externe)
db_url = os.environ.get('DATABASE_URL') or os.environ.get('DATABASE_PUBLIC_URL')

if not db_url:
    db_url = f'sqlite:///{os.path.join(basedir, "data.db")}'
    print("⚠️ DATABASE_URL non trouvée, passage en mode SQLite (non persistant sur Railway)")
else:
    # Correction pour SQLAlchemy 2.x (doit être postgresql:// et non postgres://)
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    print("✅ Base de données DATABASE_URL détectée (PostgreSQL)")

app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024

db.init_app(app)

with app.app_context():
    try:
        db.create_all()
        print("🚀 Tables de la base de données initialisées avec succès")
    except Exception as e:
        print(f"❌ Erreur lors de l'initialisation de la base : {e}")


@app.route('/')
def index():
    """Page d'accueil avec le speedtest."""
    return render_template('speedtest.html')


@app.route('/dashboard')
def dashboard():
    """Page dashboard avec graphiques."""
    return render_template('dashboard.html')


@app.route('/history')
def history():
    """Page historique des soumissions."""
    return render_template('history.html')


@app.route('/ranking')
def ranking():
    """Page classement des opérateurs."""
    return render_template('ranking.html')


# ════════════════════════════════════════════════════════════════
#  SPEEDTEST — Endpoints cibles (le navigateur teste contre eux)
# ════════════════════════════════════════════════════════════════

# Chunk de données aléatoires pré-généré (64 KB) pour le download
_DOWNLOAD_CHUNK = os.urandom(65536)


@app.route('/st/ping', methods=['GET'])
def st_ping():
    """Endpoint léger pour mesure de latence.
    Le client envoie un timestamp, on le renvoie immédiatement.
    """
    return jsonify({'pong': True, 't': time.time()})


@app.route('/st/download', methods=['GET'])
def st_download():
    """Stream ~100 MB de données aléatoires en chunks de 64 KB.
    Le navigateur mesure le débit en lisant ce flux.
    """
    size_mb = request.args.get('size', 100, type=int)
    size_mb = min(size_mb, 200)  # Cap à 200 MB
    total_chunks = (size_mb * 1024 * 1024) // len(_DOWNLOAD_CHUNK)

    def generate():
        for _ in range(total_chunks):
            yield _DOWNLOAD_CHUNK

    return Response(
        generate(),
        mimetype='application/octet-stream',
        headers={
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Content-Length': str(total_chunks * len(_DOWNLOAD_CHUNK)),
            'X-Accel-Buffering': 'no',
        }
    )


@app.route('/st/upload', methods=['POST'])
def st_upload():
    """Consomme le body uploadé et renvoie le nombre d'octets reçus.
    Le navigateur mesure le débit d'envoi.
    """
    total_bytes = 0
    try:
        while True:
            chunk = request.stream.read(1024 * 1024)  # Lire par blocs de 1 MB
            if not chunk:
                break
            total_bytes += len(chunk)
    except Exception:
        pass
    return jsonify({'bytes_received': total_bytes})


# ──────────────────────── Submissions API ──────────────────────────

@app.route('/api/submissions', methods=['POST'])
def create_submission():
    """Créer une nouvelle soumission."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'Données JSON requises'}), 400

    required = ['operator', 'quality', 'city']
    for field in required:
        if field not in data or not data[field].strip():
            return jsonify({'error': f'Le champ "{field}" est requis'}), 400

    valid_qualities = ['lent', 'moyen', 'rapide']
    if data['quality'] not in valid_qualities:
        return jsonify({'error': f'Qualité invalide. Valeurs acceptées : {valid_qualities}'}), 400

    neighborhood_val = data.get('neighborhood')
    submission = Submission(
        operator=data['operator'].strip(),
        quality=data['quality'].strip(),
        city=data['city'].strip(),
        neighborhood=neighborhood_val.strip() if neighborhood_val else None,
        speed_mbps=float(data['speed_mbps']) if data.get('speed_mbps') is not None else None,
        upload_mbps=float(data['upload_mbps']) if data.get('upload_mbps') is not None else None,
        ping_ms=float(data['ping_ms']) if data.get('ping_ms') is not None else None
    )

    db.session.add(submission)
    db.session.commit()

    return jsonify(submission.to_dict()), 201


@app.route('/api/submissions', methods=['GET'])
def get_submissions():
    """Récupérer les soumissions avec filtres et pagination."""
    query = Submission.query

    operator = request.args.get('operator')
    city = request.args.get('city')
    quality = request.args.get('quality')

    if operator:
        query = query.filter(Submission.operator == operator)
    if city:
        query = query.filter(Submission.city == city)
    if quality:
        query = query.filter(Submission.quality == quality)

    # Pagination
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 20, type=int)
    per_page = min(per_page, 100)

    total = query.count()
    submissions = (
        query.order_by(Submission.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    return jsonify({
        'data': [s.to_dict() for s in submissions],
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': (total + per_page - 1) // per_page
        }
    })


@app.route('/api/submissions/<int:submission_id>', methods=['DELETE'])
def delete_submission(submission_id):
    """Supprimer une soumission."""
    submission = Submission.query.get_or_404(submission_id)
    db.session.delete(submission)
    db.session.commit()
    return jsonify({'message': 'Soumission supprimée'}), 200


# ──────────────────────── Stats API ──────────────────────────

@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Statistiques agrégées pour le dashboard."""
    operator = request.args.get('operator')
    city = request.args.get('city')

    def apply_filters(query):
        if operator:
            query = query.filter(Submission.operator == operator)
        if city:
            query = query.filter(Submission.city == city)
        return query

    total = apply_filters(Submission.query).count()

    # ── Qualité par opérateur ──
    quality_map = {'lent': 1, 'moyen': 2, 'rapide': 3}
    quality_by_operator = {}
    q_quality = db.session.query(Submission.operator, Submission.quality, func.count())
    rows = (
        apply_filters(q_quality)
        .group_by(Submission.operator, Submission.quality)
        .all()
    )
    operator_counts = {}
    for op, qual, cnt in rows:
        if op not in quality_by_operator:
            quality_by_operator[op] = 0
            operator_counts[op] = 0
        quality_by_operator[op] += quality_map.get(qual, 0) * cnt
        operator_counts[op] += cnt

    avg_quality_by_operator = {}
    for op in quality_by_operator:
        raw = quality_by_operator[op] / operator_counts[op] if operator_counts[op] else 0
        avg_quality_by_operator[op] = round(raw, 2)

    # ── Distribution des qualités (%) ──
    quality_distribution = {}
    for op, qual, cnt in rows:
        quality_distribution[qual] = quality_distribution.get(qual, 0) + cnt

    if total > 0:
        quality_distribution = {k: round(v / total * 100, 1) for k, v in quality_distribution.items()}

    # ── Soumissions par zone ──
    q_zones = db.session.query(Submission.city, func.count())
    zone_rows = apply_filters(q_zones).group_by(Submission.city).all()
    submissions_by_zone = {city_name: cnt for city_name, cnt in zone_rows}

    # ── Vitesse moyenne par opérateur ──
    q_speeds = db.session.query(Submission.operator, func.avg(Submission.speed_mbps))
    speed_rows = (
        apply_filters(q_speeds)
        .filter(Submission.speed_mbps.isnot(None))
        .group_by(Submission.operator)
        .all()
    )
    avg_speed_by_operator = {op: round(avg, 2) for op, avg in speed_rows if avg}

    # ── Listes uniques pour les filtres ──
    all_operators = [r[0] for r in db.session.query(Submission.operator).distinct().all()]
    all_cities = [r[0] for r in db.session.query(Submission.city).distinct().all()]

    return jsonify({
        'total': total,
        'avg_quality_by_operator': avg_quality_by_operator,
        'quality_distribution': quality_distribution,
        'submissions_by_zone': submissions_by_zone,
        'avg_speed_by_operator': avg_speed_by_operator,
        'operators': sorted(all_operators),
        'cities': sorted(all_cities)
    })


# ──────────────────────── Ranking API ──────────────────────────

@app.route('/api/ranking', methods=['GET'])
def get_ranking():
    """Classement des opérateurs avec scores détaillés et tri personnalisable."""
    sort_by = request.args.get('sort_by', 'quality')
    quality_map = {'lent': 1, 'moyen': 2, 'rapide': 3}

    operators = {}

    # Qualité et nombre de soumissions
    rows = (
        db.session.query(Submission.operator, Submission.quality, func.count())
        .group_by(Submission.operator, Submission.quality)
        .all()
    )
    for op, qual, cnt in rows:
        if op not in operators:
            operators[op] = {
                'operator': op,
                'total_submissions': 0,
                'quality_score': 0,
                'quality_counts': {'lent': 0, 'moyen': 0, 'rapide': 0},
                'avg_download': 0,
                'avg_upload': 0,
                'avg_ping': 0
            }
        operators[op]['total_submissions'] += cnt
        operators[op]['quality_score'] += quality_map.get(qual, 0) * cnt
        operators[op]['quality_counts'][qual] = cnt

    # Calculer score moyen qualité
    for op in operators:
        total = operators[op]['total_submissions']
        if total > 0:
            operators[op]['quality_score'] = round(operators[op]['quality_score'] / total, 2)

    # Vitesse moyennes (Download, Upload, Ping)
    metrics_rows = (
        db.session.query(
            Submission.operator,
            func.avg(Submission.speed_mbps),
            func.avg(Submission.upload_mbps),
            func.avg(Submission.ping_ms)
        )
        .group_by(Submission.operator)
        .all()
    )
    for op, avg_dl, avg_ul, avg_ping in metrics_rows:
        if op in operators:
            operators[op]['avg_download'] = round(avg_dl, 2) if avg_dl else 0
            operators[op]['avg_upload'] = round(avg_ul, 2) if avg_ul else 0
            operators[op]['avg_ping'] = round(avg_ping, 1) if avg_ping else 0

    # Trier selon le critère demandé
    if sort_by == 'download':
        ranking = sorted(operators.values(), key=lambda x: x['avg_download'], reverse=True)
    elif sort_by == 'upload':
        ranking = sorted(operators.values(), key=lambda x: x['avg_upload'], reverse=True)
    elif sort_by == 'ping':
        ranking = sorted(operators.values(), key=lambda x: x['avg_ping'] if x['avg_ping'] > 0 else float('inf'))
    else:
        ranking = sorted(operators.values(), key=lambda x: x['quality_score'], reverse=True)

    # Ajouter le rang
    for i, entry in enumerate(ranking):
        entry['rank'] = i + 1

    return jsonify(ranking)


# (Admin routes removed as part of feat: move deletion logic to history and remove admin page)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
