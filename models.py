from flask_sqlalchemy import SQLAlchemy
from datetime import datetime, timezone

db = SQLAlchemy()


class Submission(db.Model):
    """Modèle pour stocker les soumissions de qualité internet."""
    __tablename__ = 'submissions'

    id = db.Column(db.Integer, primary_key=True)
    operator = db.Column(db.String(50), nullable=False)
    quality = db.Column(db.String(20), nullable=False)  # lent, moyen, rapide
    city = db.Column(db.String(100), nullable=False)
    neighborhood = db.Column(db.String(100), nullable=True)
    speed_mbps = db.Column(db.Float, nullable=True)  # Download
    upload_mbps = db.Column(db.Float, nullable=True)
    ping_ms = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self):
        return {
            'id': self.id,
            'operator': self.operator,
            'quality': self.quality,
            'city': self.city,
            'neighborhood': self.neighborhood,
            'speed_mbps': self.speed_mbps,
            'upload_mbps': self.upload_mbps,
            'ping_ms': self.ping_ms,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
