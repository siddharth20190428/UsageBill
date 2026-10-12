"""Production entrypoint: one process serves the API (under /api) and the built React app (everything else).

The UI and the API share path names (/customers, /plans), so the API lives under /api, exactly like the Vite
dev proxy. Run with:  uvicorn app.web:site
"""
import os
from pathlib import Path

from starlette.responses import FileResponse, JSONResponse

DEFAULT_STATIC_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def build_site(api, static_dir: Path):
    """Wrap the API app: /api/* goes to it (prefix stripped), anything else is a static file or index.html."""
    static_dir = Path(static_dir)

    async def site(scope, receive, send):
        if scope["type"] in ("lifespan", "websocket"):
            await api(scope, receive, send)  # the API owns startup/shutdown (database pool)
            return

        path: str = scope["path"]
        if path == "/api" or path.startswith("/api/"):
            inner = path[len("/api"):] or "/"
            raw = scope.get("raw_path")
            new_scope = dict(scope, path=inner, root_path=scope.get("root_path", "") + "/api")  # so /api/docs finds /api/openapi.json
            if raw:
                new_scope["raw_path"] = raw[len(b"/api"):] or b"/"
            await api(new_scope, receive, send)
            return

        response = _serve_static(static_dir, path)
        await response(scope, receive, send)

    return site


def _serve_static(static_dir: Path, path: str):
    index = static_dir / "index.html"
    if not index.is_file():
        return JSONResponse({"error": {"code": "frontend_not_built", "message": "Run `npm run build` in frontend/."}}, 404)
    candidate = (static_dir / path.lstrip("/")).resolve()
    # Never serve outside the build directory (path traversal), and never serve directories.
    if candidate.is_file() and static_dir.resolve() in candidate.parents:
        return FileResponse(candidate)
    if "." in path.rsplit("/", 1)[-1]:
        # A missing asset (e.g. /assets/old-hash.js) is a real 404, not the app shell.
        return JSONResponse({"error": {"code": "not_found", "message": "No such file."}}, 404)
    return FileResponse(index)  # client-side route such as /customers/<id>


def _make_site():
    from app.main import app

    return build_site(app, Path(os.environ.get("STATIC_DIR", DEFAULT_STATIC_DIR)))


site = _make_site()
