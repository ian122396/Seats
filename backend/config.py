import json
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional


def _load_mapping(env_key: str, default: Dict[str, str]) -> Dict[str, str]:
    raw = os.getenv(env_key)
    if not raw:
        return default
    try:
        if raw.strip().startswith("{"):
            return json.loads(raw)
        mapped: Dict[str, str] = {}
        for part in raw.split(","):
            if not part.strip() or "=" not in part:
                continue
            key, value = part.split("=", 1)
            mapped[key.strip()] = value.strip()
        return mapped or default
    except json.JSONDecodeError:
        return default


@dataclass
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/seats.db")
    seats_json_path: Path = Path(os.getenv("SEATS_JSON_PATH", "data/seats.json"))
    hold_ttl_seconds: int = int(os.getenv("SEAT_HOLD_TTL_SECONDS", "120"))
    cleanup_interval_seconds: int = int(os.getenv("SEAT_CLEANUP_INTERVAL_SECONDS", "5"))
    redis_url: Optional[str] = os.getenv("REDIS_URL")
    allow_redis: bool = os.getenv("ENABLE_REDIS", "false").lower() in {"1", "true", "yes"}
    admin_token: Optional[str] = os.getenv("ADMIN_TOKEN", "1223")
    tier_prices: Dict[str, int] = field(default_factory=lambda: {
        "VIP": 1680,
        "A": 1280,
        "B": 880,
        "C": 580,
        "E": 380,
    })
    color_tiers: Dict[str, str] = field(default_factory=lambda: {
        "FFFF0000": "VIP",   # red
        "FFFFA500": "A",     # orange
        "FFFFFF00": "B",     # yellow
        "FF00B050": "C",     # green
        "FF0070C0": "E",     # blue
    })

    def tier_for_color(self, color: Optional[str]) -> Optional[str]:
        if not color:
            return None
        color_upper = color.upper()
        if color_upper in self.color_tiers:
            return self.color_tiers[color_upper]
        # Some Excel exports use ARGB with leading alpha "00"
        trimmed = color_upper[-6:]
        for key, tier in self.color_tiers.items():
            if key.endswith(trimmed):
                return tier
        return None

    def price_for_tier(self, tier: Optional[str]) -> int:
        if not tier:
            return 0
        return self.tier_prices.get(tier, 0)


@lru_cache()
def get_settings() -> Settings:
    settings = Settings()
    # Allow overriding mappings via env string/JSON
    settings.color_tiers = _load_mapping("COLOR_TIER_MAP", settings.color_tiers)
    tier_price_map = {k: str(v) for k, v in settings.tier_prices.items()}
    raw_prices = _load_mapping("TIER_PRICE_MAP", tier_price_map)
    # Ensure values are ints
    parsed_prices: Dict[str, int] = {}
    for key, value in raw_prices.items():
        try:
            parsed_prices[key] = int(value)
        except ValueError:
            continue
    if parsed_prices:
        settings.tier_prices = parsed_prices
    return settings
