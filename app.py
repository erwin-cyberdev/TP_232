import os
import time
import json
import threading
import queue
import speedtest
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from models import db, Submission
from sqlalchemy import func




app = Flask(__name__)

# Configuration base de données
basedir = os.path.abspath(os.path.dirname(__file__))
db_url = os.environ.get('DATABASE_URL', f'sqlite:///{os.path.join(basedir, "data.db")}')
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config['SQLALCHEMY_DATABASE_URI'] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()


# ──────────────────────────── Pages ────────────────────────────

@app.route('/')
def index():
    """Page principale avec speedtest intégré."""
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


# ──────────────────────── Speed Test API ──────────────────────────



def speedtest_engine(q):
    try:
        # 1. Initialisation
        q.put({"step": "init", "message": "Initialisation du moteur Speedtest-cli..."})
        st = speedtest.Speedtest()
        
        # 2. Recherche du meilleur serveur
        q.put({"step": "init", "message": "Recherche du meilleur serveur..."})
        st.get_best_server()
        best_server = st.best
        server_name = f"{best_server['sponsor']} ({best_server['name']})"
        
        q.put({
            "step": "ping", 
            "value": round(best_server['latency'], 1), 
            "jitter": 0, # speedtest-cli doesn't provide jitter natively in results
            "server_name": server_name
        })
        time.sleep(1)

        # 3. Download
        q.put({"step": "download", "value": 0, "progress": 0})
        
        # Counter for progress
        download_finished = [0]
        def dl_callback(i, total, start=False, end=False):
            if end:
                download_finished[0] += 1
                progress = download_finished[0] / total
                # We don't have instant speed from the callback, so we just update progress
                q.put({"step": "download", "value": 0, "progress": progress})

        st.download(callback=dl_callback)
        final_dl_mbps = st.results.download / 1_000_000
        q.put({"step": "download", "value": round(final_dl_mbps, 2), "progress": 1.0})
        time.sleep(0.5)

        # 4. Upload
        q.put({"step": "upload", "value": 0, "progress": 0})
        
        upload_finished = [0]
        def ul_callback(i, total, start=False, end=False):
            if end:
                upload_finished[0] += 1
                progress = upload_finished[0] / total
                q.put({"step": "upload", "value": 0, "progress": progress})

        st.upload(callback=ul_callback)
        final_ul_mbps = st.results.upload / 1_000_000
        q.put({"step": "upload", "value": round(final_ul_mbps, 2), "progress": 1.0})

        # 5. Résultats finaux
        q.put({
            "step": "done",
            "results": {
                "ping": round(best_server['latency'], 1),
                "download": round(final_dl_mbps, 2),
                "upload": round(final_ul_mbps, 2)
            }
        })

    except Exception as e:
        print(f"Speedtest error: {e}")
        q.put({"step": "error", "message": str(e)})



@app.route('/api/ext_speedtest/run', methods=['GET'])
def ext_speedtest_run():
    def generate():
        q = queue.Queue()
        engine_thread = threading.Thread(target=speedtest_engine, args=(q,))
        engine_thread.start()
        
        while True:
            try:
                data = q.get(timeout=15)
                yield f"data: {json.dumps(data)}\n\n"
                if data.get("step") in ("done", "error"):
                    break
            except queue.Empty:
                yield "data: {\"step\": \"error\", \"message\": \"Timeout\"}\n\n"
                break
                
    return Response(stream_with_context(generate()), mimetype='text/event-stream')


# ──────────────────────── Local Mock Target ────────────────────────
@app.route('/mock/ping', methods=['GET'])
def mock_ping():
    return jsonify({'pong': True})

@app.route('/mock/download', methods=['GET'])
def mock_download():
    chunk = os.urandom(65536)
    def generate():
        for _ in range(8000): # 500 MB mock
            time.sleep(0.001) # Simulate network delay
            yield chunk
    response = Response(generate(), mimetype='application/octet-stream')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    return response

@app.route('/mock/upload', methods=['POST'])
def mock_upload():
    # Consume data stream efficiently without loading all into memory
    # Using request.input_stream to avoid triggering MAX_CONTENT_LENGTH or memory exhaustion
    try:
        while True:
            chunk = request.stream.read(1024 * 1024)
            if not chunk:
                break
    except:
        pass
    return jsonify({'status': 'OK'})




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

    submission = Submission(
        operator=data['operator'].strip(),
        quality=data['quality'].strip(),
        city=data['city'].strip(),
        neighborhood=data.get('neighborhood', '').strip() or None,
        speed_mbps=float(data['speed_mbps']) if data.get('speed_mbps') else None,
        upload_mbps=float(data['upload_mbps']) if data.get('upload_mbps') else None,
        ping_ms=float(data['ping_ms']) if data.get('ping_ms') else None
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

    base_query = Submission.query
    if operator:
        base_query = base_query.filter(Submission.operator == operator)
    if city:
        base_query = base_query.filter(Submission.city == city)

    total = base_query.count()

    # ── Qualité par opérateur ──
    quality_map = {'lent': 1, 'moyen': 2, 'rapide': 3}
    quality_by_operator = {}
    rows = (
        db.session.query(Submission.operator, Submission.quality, func.count())
        .filter(base_query.whereclause if base_query.whereclause is not None else True)
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
    zone_rows = (
        db.session.query(Submission.city, func.count())
        .filter(base_query.whereclause if base_query.whereclause is not None else True)
        .group_by(Submission.city)
        .all()
    )
    submissions_by_zone = {city_name: cnt for city_name, cnt in zone_rows}

    # ── Vitesse moyenne par opérateur ──
    speed_rows = (
        db.session.query(Submission.operator, func.avg(Submission.speed_mbps))
        .filter(base_query.whereclause if base_query.whereclause is not None else True)
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
    sort_by = request.args.get('sort_by', 'quality') # quality, download, upload, ping
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
        # Pour le ping, le plus bas est le mieux
        ranking = sorted(operators.values(), key=lambda x: x['avg_ping'] if x['avg_ping'] > 0 else float('inf'))
    else: # quality
        ranking = sorted(operators.values(), key=lambda x: x['quality_score'], reverse=True)

    # Ajouter le rang
    for i, entry in enumerate(ranking):
        entry['rank'] = i + 1

    return jsonify(ranking)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
