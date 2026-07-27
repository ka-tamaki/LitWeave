from __future__ import annotations

import logging
from logging.handlers import TimedRotatingFileHandler

from .db import local_data_dir


def configure_logging() -> None:
    log_dir = local_data_dir() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = TimedRotatingFileHandler(
        log_dir / "litweave.log",
        when="midnight",
        interval=1,
        backupCount=30,
        encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger = logging.getLogger("litweave")
    logger.setLevel(logging.INFO)
    if not any(isinstance(value, TimedRotatingFileHandler) for value in logger.handlers):
        logger.addHandler(handler)
    logger.propagate = False
