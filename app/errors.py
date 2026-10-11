"""Structured API errors.

Every error response has the same shape so a client (or a UI) can map it to a
useful message instead of showing "Something went wrong":

    {"error": {"code": "...", "message": "...", "field": "...", "details": [...]}}
"""
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, field: str | None = None):
        self.status = status
        self.code = code
        self.message = message
        self.field = field


def _body(code: str, message: str, field: str | None = None, details: list | None = None) -> dict:
    error: dict = {"code": code, "message": message}
    if field is not None:
        error["field"] = field
    if details is not None:
        error["details"] = details
    return {"error": error}


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def handle_api_error(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.status, content=_body(exc.code, exc.message, exc.field))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError):
        details = []
        for err in exc.errors():
            # loc looks like ("body", "quantity"); drop the leading "body"/"query"/"path".
            field = ".".join(str(part) for part in err["loc"][1:]) or None
            details.append({"field": field, "message": err["msg"]})
        first_field = details[0]["field"] if details else None
        return JSONResponse(
            status_code=422,
            content=_body("validation_error", "Request validation failed", first_field, details),
        )
