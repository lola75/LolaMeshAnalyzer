"""Protezione dei server locali (mesh 8000/8001, CBCT 8002) dalle pagine web del browser.

I server ascoltano solo su 127.0.0.1, ma una pagina internet aperta nel browser dello stesso PC
potrebbe comunque chiamarli (es. caricare una cartella DICOM e scaricarne il volume). Qui:
- Host: si accettano solo richieste rivolte a 127.0.0.1 / localhost (blocca il DNS rebinding);
- Origin: le richieste dal browser sono accettate solo dalle pagine servite dal PC stesso
  (http://localhost:<porta> o http://127.0.0.1:<porta>, cioe' l'app); da qualunque altro sito
  vengono rifiutate prima di essere eseguite, non solo nella lettura della risposta.
Le richieste senza Origin (script locali, test, avvio di prova dell'installazione) restano valide.
"""
import re

from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import PlainTextResponse

ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
ALLOWED_ORIGIN_REGEX = r"^http://(localhost|127\.0\.0\.1)(:\d{1,5})?$"
_allowed_origin = re.compile(ALLOWED_ORIGIN_REGEX)


def protect_local_server(app, allow_credentials: bool = False, expose_headers: list[str] | None = None) -> None:
    """Applica le regole al server FastAPI (al posto del CORS aperto a tutti)."""

    # Ultimo aggiunto = primo a ricevere la richiesta: Origin, poi Host, poi CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=ALLOWED_ORIGIN_REGEX,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=expose_headers or [],
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)

    @app.middleware("http")
    async def reject_foreign_origins(request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and not _allowed_origin.match(origin):
            return PlainTextResponse("Origine non consentita", status_code=403)
        return await call_next(request)
