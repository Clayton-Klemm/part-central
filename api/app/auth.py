"""Employee-number identification with server-verified administrator access."""
import hashlib
import hmac
import os
import secrets
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth_models import Employee, EmployeeSession, utcnow
from .database import get_db


router = APIRouter(prefix="/api/auth", tags=["Employee identification"])
SESSION_COOKIE = "pc_session"
SESSION_SECONDS = 8 * 60 * 60
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    employeeNumber: Annotated[str, StringConstraints(pattern=r"^[0-9]{4}$", min_length=4, max_length=4)]
    adminKey: str | None = Field(default=None, max_length=1024)


class EmployeeResponse(BaseModel):
    employeeNumber: str
    displayName: str
    role: str


def employee_dto(employee: Employee):
    return {"employeeNumber": employee.number, "displayName": employee.display_name, "role": employee.role}


def token_digest(token: str):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_origin(request: Request):
    """Reject browser mutations originating outside this exact application origin.

    Command-line clients do not send Origin. Browser session cookies are also
    SameSite=Strict; the explicit check covers login CSRF and same-site ports.
    """
    if request.method in SAFE_METHODS:
        return
    origin = request.headers.get("origin")
    if origin is None:
        return
    try:
        actual = urlsplit(origin)
        expected = urlsplit(str(request.base_url))
        def key(value):
            return (value.scheme.lower(), (value.hostname or "").lower(), value.port or (443 if value.scheme.lower() == "https" else 80))
        if actual.username or actual.password or actual.path not in ("", "/") or actual.query or actual.fragment or key(actual) != key(expected):
            raise ValueError("foreign origin")
    except ValueError:
        raise HTTPException(403, "Use this application from its own server address")


def administrator_key_matches(provided: str):
    expected = os.getenv("ADMIN_TOKEN", "")
    return bool(expected) and hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


def enroll_employee(session: Session, number: str):
    employee = session.get(Employee, number)
    if employee is not None:
        return employee
    try:
        with session.begin_nested():
            employee = Employee(number=number, display_name="Administrator" if number == "0000" else f"Employee {number}", role="admin" if number == "0000" else "operator")
            session.add(employee)
            session.flush()
    except IntegrityError:
        employee = session.get(Employee, number)
        if employee is None:
            raise
    return employee


def optional_employee(request: Request, session: Session = Depends(get_db)) -> Employee | None:
    validate_origin(request)
    authorization = request.headers.get("authorization")
    if authorization is not None:
        if authorization.startswith("Bearer ") and administrator_key_matches(authorization[7:]):
            return enroll_employee(session, "0000")
        raise HTTPException(401, "Employee sign-in or a valid administrator credential is required")
    token = request.cookies.get(SESSION_COOKIE)
    if not token or len(token) > 256:
        return None
    return session.scalar(select(Employee).join(EmployeeSession, EmployeeSession.employee_number == Employee.number).where(EmployeeSession.token_hash == token_digest(token), EmployeeSession.expires_at > utcnow()))


def get_current_employee(request: Request, session: Session = Depends(get_db)) -> Employee:
    employee = optional_employee(request, session)
    if employee is None:
        raise HTTPException(401, "Enter your employee number to continue")
    return employee


def require_admin(employee: Employee = Depends(get_current_employee)) -> Employee:
    if employee.number != "0000" or employee.role != "admin":
        raise HTTPException(403, "Administrator access is required")
    return employee


@router.post("/login", response_model=EmployeeResponse)
def login(body: LoginRequest, request: Request, response: Response, session: Session = Depends(get_db)):
    validate_origin(request)
    if body.employeeNumber == "0000":
        if not os.getenv("ADMIN_TOKEN", ""):
            raise HTTPException(503, "Administrator access is disabled until its server credential is configured")
        if not administrator_key_matches(body.adminKey or ""):
            raise HTTPException(401, "Administrator credential required for employee 0000")
    elif body.adminKey:
        raise HTTPException(422, "Administrator credentials are only used with employee 0000")
    employee = enroll_employee(session, body.employeeNumber)
    # Replacing an existing browser session invalidates its previous token.
    previous = request.cookies.get(SESSION_COOKIE)
    if previous and len(previous) <= 256:
        session.execute(delete(EmployeeSession).where(EmployeeSession.token_hash == token_digest(previous)))
    now = utcnow()
    session.execute(delete(EmployeeSession).where(EmployeeSession.expires_at <= now))
    raw_token = secrets.token_urlsafe(32)
    session.add(EmployeeSession(token_hash=token_digest(raw_token), employee_number=employee.number, created_at=now, expires_at=now + timedelta(seconds=SESSION_SECONDS)))
    session.flush()
    secure = os.getenv("SESSION_COOKIE_SECURE", "").lower() in {"1", "true", "yes"} or request.url.scheme == "https"
    response.set_cookie(SESSION_COOKIE, raw_token, max_age=SESSION_SECONDS, httponly=True, secure=secure, samesite="strict", path="/")
    response.headers["Cache-Control"] = "no-store"
    return employee_dto(employee)


@router.get("/me", response_model=EmployeeResponse)
def me(response: Response, employee: Employee = Depends(get_current_employee)):
    response.headers["Cache-Control"] = "no-store"
    return employee_dto(employee)


@router.post("/logout")
def logout(request: Request, response: Response, session: Session = Depends(get_db)):
    validate_origin(request)
    raw_token = request.cookies.get(SESSION_COOKIE)
    if raw_token and len(raw_token) <= 256:
        session.execute(delete(EmployeeSession).where(EmployeeSession.token_hash == token_digest(raw_token)))
    response.delete_cookie(SESSION_COOKIE, path="/", httponly=True, samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return {"signedOut": True}
