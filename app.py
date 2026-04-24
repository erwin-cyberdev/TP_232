import os
import time
import random
import json
import threading
import queue
import concurrent.futures
import requests
from flask import Flask, render_template, request, jsonify, Response, stream_with_context
from models import db, Submission
from sqlalchemy import func

app = Flask(__name__)

# Configuration base de données
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get(
    'DATABASE_URL',
    f'sqlite:///{os.path.join(basedir, "data.db")}'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()


# ──────────────────────────── Pages ────────────────────────────

@app.route('/')
def index():
    """Page formulaire de soumission."""
    return render_template('index.html')


@app.route('/speedtest')
def speedtest():
    """Page test de vitesse internet."""
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

SERVERS = [
    {
        "name": "Localhost Serveur (Fiable)",
        "ping": "http://127.0.0.1:5000/mock/ping",
        "dl": "http://127.0.0.1:5000/mock/download",
        "ul": "http://127.0.0.1:5000/mock/upload"
    },
    {
        "name": "Tele2 Frankfurt",
        "ping": "http://fra.speedtest.tele2.net/1MB.zip",
        "dl": "http://fra.speedtest.tele2.net/100MB.zip",
        "ul": "http://fra.speedtest.tele2.net/upload.php"
    },
    {
        "name": "Tele2 Amsterdam",
        "ping": "http://ams.speedtest.tele2.net/1MB.zip",
        "dl": "http://ams.speedtest.tele2.net/100MB.zip",
        "ul": "http://ams.speedtest.tele2.net/upload.php"
    }
]

def speedtest_engine(q):
    try:
        # 1. Sélection du serveur
        q.put({"step": "init", "message": "Sélection du serveur..."})
        best_server = None
        best_latency = float('inf')
        
        for s in SERVERS:
            try:
                start = time.time()
                requests.get(s["ping"], timeout=2, stream=True).close()
                latency = (time.time() - start) * 1000
                if latency < best_latency:
                    best_latency = latency
                    best_server = s
            except Exception:
                pass
                
        if not best_server:
            best_server = SERVERS[0]
            
        q.put({"step": "init", "message": f"Serveur sélectionné: {best_server['name']}"})
        time.sleep(0.5)
        
        # 2. Ping
        q.put({"step": "ping", "value": 0, "server_name": best_server['name']})
        latencies = []
        for _ in range(5):
            try:
                start = time.time()
                r = requests.get(best_server["ping"], stream=True, timeout=2)
                latencies.append((time.time() - start) * 1000)
                r.close()
            except:
                pass
        avg_ping = sum(latencies)/len(latencies) if latencies else 0
        q.put({"step": "ping", "value": round(avg_ping, 1), "server_name": best_server['name']})
        time.sleep(0.5)
        
        # 3. Download
        duration = 8.0
        start_time = time.time()
        downloaded_bytes = 0
        is_testing = True
        
        def download_worker():
            nonlocal downloaded_bytes, is_testing
            while is_testing and (time.time() - start_time) < duration:
                try:
                    with requests.get(best_server["dl"], stream=True, timeout=5) as r:
                        for chunk in r.iter_content(chunk_size=65536):
                            if not is_testing or (time.time() - start_time) > duration:
                                break
                            if chunk:
                                downloaded_bytes += len(chunk)
                except:
                    pass

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            for _ in range(4):
                executor.submit(download_worker)
            
            while (time.time() - start_time) < duration:
                time.sleep(0.2)
                elapsed = time.time() - start_time
                if elapsed > 0:
                    speed_mbps = (downloaded_bytes * 8) / (elapsed * 1_000_000)
                    q.put({"step": "download", "value": round(speed_mbps, 2), "progress": min(elapsed/duration, 1.0)})

            is_testing = False
            
        final_dl_mbps = (downloaded_bytes * 8) / (duration * 1_000_000)
        q.put({"step": "download", "value": round(final_dl_mbps, 2), "progress": 1.0})
        time.sleep(0.5)
        
        # 4. Upload
        duration = 8.0
        start_time = time.time()
        uploaded_bytes = 0
        is_testing = True
        
        chunk = os.urandom(65536)
        
        def upload_worker():
            nonlocal uploaded_bytes, is_testing
            def data_generator():
                while is_testing and (time.time() - start_time) < duration:
                    yield chunk
                    uploaded_bytes += len(chunk)
                    
            while is_testing and (time.time() - start_time) < duration:
                try:
                    requests.post(best_server["ul"], data=data_generator(), timeout=5)
                except:
                    pass
                    
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            for _ in range(4):
                executor.submit(upload_worker)
            
            while (time.time() - start_time) < duration:
                time.sleep(0.2)
                elapsed = time.time() - start_time
                if elapsed > 0:
                    speed_mbps = (uploaded_bytes * 8) / (elapsed * 1_000_000)
                    q.put({"step": "upload", "value": round(speed_mbps, 2), "progress": min(elapsed/duration, 1.0)})

            is_testing = False
            
        final_ul_mbps = (uploaded_bytes * 8) / (duration * 1_000_000)
        q.put({"step": "upload", "value": round(final_ul_mbps, 2), "progress": 1.0})
        
        q.put({
            "step": "done",
            "results": {
                "ping": round(avg_ping, 1),
                "download": round(final_dl_mbps, 2),
                "upload": round(final_ul_mbps, 2)
            }
        })
    except Exception as e:
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
    # Consume data stream entirely
    _ = request.get_data()
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
        speed_mbps=float(data['speed_mbps']) if data.get('speed_mbps') else None
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
    """Classement des opérateurs avec scores détaillés."""
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
                'avg_speed': None
            }
        operators[op]['total_submissions'] += cnt
        operators[op]['quality_score'] += quality_map.get(qual, 0) * cnt
        operators[op]['quality_counts'][qual] = cnt

    # Calculer score moyen
    for op in operators:
        total = operators[op]['total_submissions']
        if total > 0:
            operators[op]['quality_score'] = round(operators[op]['quality_score'] / total, 2)

    # Vitesse moyenne
    speed_rows = (
        db.session.query(Submission.operator, func.avg(Submission.speed_mbps))
        .filter(Submission.speed_mbps.isnot(None))
        .group_by(Submission.operator)
        .all()
    )
    for op, avg_speed in speed_rows:
        if op in operators and avg_speed:
            operators[op]['avg_speed'] = round(avg_speed, 2)

    # Trier par score qualité descendant
    ranking = sorted(operators.values(), key=lambda x: x['quality_score'], reverse=True)

    # Ajouter le rang
    for i, entry in enumerate(ranking):
        entry['rank'] = i + 1

    return jsonify(ranking)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
