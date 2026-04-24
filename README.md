# 📡 Internet Quality Analyzer

Application web pour collecter et analyser la qualité d'internet au Cameroun par opérateur et par zone géographique.

![Python](https://img.shields.io/badge/Python-3.9+-blue)
![Flask](https://img.shields.io/badge/Flask-3.1-green)
![Chart.js](https://img.shields.io/badge/Chart.js-4.4-orange)

## 🎯 Fonctionnalités

- **Formulaire de soumission** : Évaluez votre connexion (opérateur, qualité, ville, vitesse)
- **Dashboard interactif** : Graphiques Chart.js avec KPIs et filtres
- **API REST** : Endpoints JSON pour toutes les données
- **Filtrage** : Par opérateur et par ville

## 🏗️ Arborescence

```
TP_232/
├── app.py                 # Application Flask (routes + API)
├── models.py              # Modèle SQLAlchemy
├── requirements.txt       # Dépendances Python
├── Procfile               # Render deployment
├── render.yaml            # Render Blueprint
├── static/
│   ├── css/style.css      # Design dark theme
│   └── js/dashboard.js    # Graphiques Chart.js
└── templates/
    ├── base.html           # Layout commun
    ├── index.html          # Page formulaire
    └── dashboard.html      # Page dashboard
```

## 🚀 Exécution locale

### Prérequis
- Python 3.9 ou supérieur
- pip

### Étapes

```bash
# 1. Cloner ou se positionner dans le dossier
cd TP_232

# 2. Créer un environnement virtuel (recommandé)
python -m venv venv
source venv/bin/activate   # Linux/Mac
# venv\Scripts\activate    # Windows

# 3. Installer les dépendances
pip install -r requirements.txt

# 4. Lancer le serveur
python app.py
```

L'application sera accessible sur **http://localhost:5000**

- 📝 Formulaire : http://localhost:5000/
- 📊 Dashboard : http://localhost:5000/dashboard

## 📡 API REST

| Méthode | Endpoint             | Description                        |
|---------|----------------------|------------------------------------|
| POST    | `/api/submissions`   | Créer une soumission               |
| GET     | `/api/submissions`   | Lister (filtre: `?operator=&city=`)|
| GET     | `/api/stats`         | Statistiques agrégées              |

### Exemple POST

```bash
curl -X POST http://localhost:5000/api/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "operator": "MTN",
    "quality": "rapide",
    "city": "Douala",
    "neighborhood": "Bonanjo",
    "speed_mbps": 15.5
  }'
```

## ☁️ Déploiement sur Render

### Méthode 1 : Via le Dashboard Render

1. Créez un compte sur [render.com](https://render.com)
2. Cliquez sur **New → Web Service**
3. Connectez votre repo GitHub contenant ce projet
4. Configurez :
   - **Build Command** : `pip install -r requirements.txt`
   - **Start Command** : `gunicorn app:app`
   - **Runtime** : Python 3
5. Cliquez **Create Web Service**

### Méthode 2 : Via le render.yaml (Blueprint)

1. Poussez le code sur GitHub
2. Allez sur https://render.com/deploy
3. Sélectionnez votre repo → Render détecte automatiquement le `render.yaml`

> **Note** : SQLite fonctionne sur Render mais les données sont perdues à chaque redéploiement.
> Pour la persistance, utilisez PostgreSQL (gratuit sur Render) en configurant la variable `DATABASE_URL`.

## 🛠️ Stack technique

- **Backend** : Python / Flask / Flask-SQLAlchemy
- **Base de données** : SQLite (PostgreSQL compatible)
- **Frontend** : HTML5 / CSS3 / JavaScript
- **Graphiques** : Chart.js 4
- **Déploiement** : Gunicorn / Render
# TP_232
