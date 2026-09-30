"""Application settings (plan Section 4).

Values come from environment variables, then ``backend/.env`` (resolved from this
file's location, not the current working directory), then the defaults below,
which are identical to ``backend/.env.example`` so a ``.env`` file is optional.

Usage::

    from app.config import get_settings
    settings = get_settings()
    settings.NOTIFY_MODE          # field names are the env var names (UPPER_CASE)
    settings.notify_mode          # lower-case read-only aliases also work
    settings.cors_origins_list    # ["http://localhost:5173"]
    settings.ses_recipients_list  # [] or ["a@x.com", "b@y.com"]

Overriding in tests:
  * ``monkeypatch.setattr(get_settings(), "NOTIFY_MODE", "sns")`` - the cached
    object is shared by everyone, and monkeypatch restores it afterwards; or
  * set environment variables, then call ``get_settings.cache_clear()``.
  (Assign the UPPER_CASE field names; the lower-case aliases are read-only.)
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.enums import RiskLevel

BACKEND_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BACKEND_DIR / ".env"
SAMPLE_DATA_DIR = BACKEND_DIR / "sample_data"
DEMO_CSV_PATH = SAMPLE_DATA_DIR / "demo_transactions.csv"


def _split_csv(value: str | None) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Database
    DATABASE_URL: str = "sqlite:///./fraud.db"

    # Security
    JWT_SECRET: str = "change-me-dev-secret"
    JWT_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: str = "http://localhost:5173"
    INGEST_API_KEY: str = "dev-ingest-key"
    CONSOLE_BASE_URL: str = "http://localhost:5173"

    # Seeded demo users
    SEED_ADMIN_PASSWORD: str = "admin123"
    SEED_REVIEWER_PASSWORD: str = "reviewer123"
    SEED_VIEWER_PASSWORD: str = "viewer123"

    # Risk thresholds
    FLAG_MIN_LEVEL: RiskLevel = RiskLevel.MEDIUM
    ALERT_MIN_LEVEL: RiskLevel = RiskLevel.HIGH
    HISTORY_LIMIT: int = 200

    # Event feed
    EVENT_FEED_SIZE: int = 200

    # Notifications: log | sns | ses
    NOTIFY_MODE: str = "log"
    AWS_REGION: str = "ap-south-1"
    SNS_TOPIC_ARN: str = ""
    SES_SENDER: str = ""
    SES_RECIPIENTS: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        """CORS_ORIGINS split on commas."""
        return _split_csv(self.CORS_ORIGINS)

    @property
    def ses_recipients_list(self) -> list[str]:
        """SES_RECIPIENTS split on commas (empty list when unset)."""
        return _split_csv(self.SES_RECIPIENTS)

    @property
    def notify_mode_normalized(self) -> str:
        """NOTIFY_MODE lower-cased and stripped ("log" | "sns" | "ses")."""
        return (self.NOTIFY_MODE or "log").strip().lower()


# Read-only lower-case aliases (settings.notify_mode == settings.NOTIFY_MODE, ...).
for _field in list(Settings.model_fields):
    if not hasattr(Settings, _field.lower()):
        setattr(Settings, _field.lower(), property(lambda self, _f=_field: getattr(self, _f)))
del _field


@lru_cache
def get_settings() -> Settings:
    """Process-wide cached Settings. Use ``get_settings.cache_clear()`` to reload."""
    return Settings()


settings = get_settings()
