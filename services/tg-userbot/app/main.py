"""FastAPI app entrypoint. Поднимает HTTP API + background worker."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import auth_router, health_router
from .worker import Worker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("tg-userbot")


worker: Worker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker
    settings = get_settings()
    log.info("Starting tg-userbot bridge env=%s url=%s", settings.ENV, settings.PUBLIC_URL)
    worker = Worker()
    try:
        await worker.start()
        yield
    finally:
        if worker:
            await worker.stop()
        log.info("tg-userbot bridge stopped")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="FinSalon tg-userbot bridge",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.is_dev else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.is_dev else None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health_router.router)
    app.include_router(auth_router.router)
    return app


app = create_app()
