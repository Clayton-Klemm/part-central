import hashlib
from datetime import timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.auth import SESSION_COOKIE
from app.auth_models import Employee, EmployeeSession, utcnow


def sign_out(client):
    response = client.post("/api/auth/logout")
    assert response.status_code == 200, response.text


def test_employee_number_creates_opaque_cookie_and_only_stores_its_hash(client, database):
    sign_out(client)
    response = client.post("/api/auth/login", json={"employeeNumber": "0421"})
    assert response.status_code == 200, response.text
    assert response.json() == {"employeeNumber": "0421", "displayName": "Employee 0421", "role": "operator"}
    raw = client.cookies.get(SESSION_COOKIE)
    cookie = response.headers["set-cookie"].lower()
    assert raw and "httponly" in cookie and "samesite=strict" in cookie and "max-age=28800" in cookie
    assert "token" not in response.text.lower()
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/auth/me").json()["employeeNumber"] == "0421"
    with database() as session:
        record = session.get(EmployeeSession, hashlib.sha256(raw.encode()).hexdigest())
        assert record is not None and record.employee_number == "0421"
        assert record.token_hash != raw
        assert session.get(Employee, "0421").role == "operator"


@pytest.mark.parametrize("number", ["", "123", "12345", "abcd", "12a4", "１２３４", " 1234", 1234])
def test_employee_number_format_is_exactly_four_ascii_digits(client, number):
    sign_out(client)
    response = client.post("/api/auth/login", json={"employeeNumber": number})
    assert response.status_code == 422
    assert client.get("/api/auth/me").status_code == 401


def test_reserved_admin_number_requires_server_credential(client, monkeypatch):
    sign_out(client)
    monkeypatch.setenv("ADMIN_TOKEN", "test-only-administrator-credential")
    for body in [{"employeeNumber": "0000"}, {"employeeNumber": "0000", "adminKey": "wrong"}]:
        assert client.post("/api/auth/login", json=body).status_code == 401
        assert client.get("/api/auth/me").status_code == 401
    response = client.post("/api/auth/login", json={"employeeNumber": "0000", "adminKey": "test-only-administrator-credential"})
    assert response.status_code == 200
    assert response.json() == {"employeeNumber": "0000", "displayName": "Administrator", "role": "admin"}
    assert client.get("/api/auth/me").json()["role"] == "admin"
    assert client.get("/api/admin/operations/op-dg1042-030/references").status_code == 200


def test_admin_sign_in_is_disabled_without_a_configured_key(client, monkeypatch):
    sign_out(client)
    monkeypatch.delenv("ADMIN_TOKEN", raising=False)
    assert client.post("/api/auth/login", json={"employeeNumber": "0000", "adminKey": "anything"}).status_code == 503
    assert client.get("/api/auth/me").status_code == 401


def test_operators_cannot_choose_an_admin_role_or_use_admin_credential(client, monkeypatch):
    sign_out(client)
    monkeypatch.setenv("ADMIN_TOKEN", "test-only-administrator-credential")
    assert client.post("/api/auth/login", json={"employeeNumber": "1234", "role": "admin"}).status_code == 422
    assert client.post("/api/auth/login", json={"employeeNumber": "1234", "adminKey": "test-only-administrator-credential"}).status_code == 422
    assert client.post("/api/auth/login", json={"employeeNumber": "1234"}).status_code == 200
    assert client.get("/api/admin/operations/op-dg1042-030/references").status_code == 403


def test_logout_revokes_server_session_and_replaying_cookie_fails(client, database):
    sign_out(client)
    assert client.post("/api/auth/login", json={"employeeNumber": "0456"}).status_code == 200
    raw = client.cookies.get(SESSION_COOKIE)
    sign_out(client)
    assert client.get("/api/auth/me").status_code == 401
    client.cookies.set(SESSION_COOKIE, raw)
    assert client.get("/api/auth/me").status_code == 401
    with database() as session:
        assert session.get(EmployeeSession, hashlib.sha256(raw.encode()).hexdigest()) is None


def test_expired_session_is_rejected_and_rotated_login_revokes_previous_cookie(client, database):
    sign_out(client)
    assert client.post("/api/auth/login", json={"employeeNumber": "0456"}).status_code == 200
    first = client.cookies.get(SESSION_COOKIE)
    assert client.post("/api/auth/login", json={"employeeNumber": "0456"}).status_code == 200
    second = client.cookies.get(SESSION_COOKIE)
    assert second != first
    with database.begin() as session:
        assert session.get(EmployeeSession, hashlib.sha256(first.encode()).hexdigest()) is None
        record = session.get(EmployeeSession, hashlib.sha256(second.encode()).hexdigest())
        record.created_at = utcnow() - timedelta(hours=10)
        record.expires_at = utcnow() - timedelta(hours=2)
    assert client.get("/api/auth/me").status_code == 401


def test_mutating_browser_requests_must_use_the_application_origin(client):
    sign_out(client)
    assert client.post("/api/auth/login", json={"employeeNumber": "1234"}, headers={"Origin": "https://foreign.example"}).status_code == 403
    assert client.post("/api/auth/login", json={"employeeNumber": "1234"}, headers={"Origin": "null"}).status_code == 403
    assert client.post("/api/auth/login", json={"employeeNumber": "1234"}, headers={"Origin": "http://testserver:9000"}).status_code == 403
    assert client.post("/api/auth/login", json={"employeeNumber": "1234"}, headers={"Origin": "http://testserver"}).status_code == 200
    assert client.post("/api/auth/logout", headers={"Origin": "https://foreign.example"}).status_code == 403
    assert client.get("/api/auth/me").status_code == 200


def test_bearer_admin_credentials_remain_supported_for_local_service_clients(client, monkeypatch):
    sign_out(client)
    monkeypatch.setenv("ADMIN_TOKEN", "test-only-administrator-credential")
    response = client.get("/api/auth/me", headers={"Authorization": "Bearer test-only-administrator-credential"})
    assert response.status_code == 200
    assert response.json()["employeeNumber"] == "0000" and response.json()["role"] == "admin"
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer invalid"}).status_code == 401


def test_identity_roles_cannot_be_promoted_in_the_database(client, database):
    sign_out(client)
    assert client.post("/api/auth/login", json={"employeeNumber": "0456"}).status_code == 200
    with pytest.raises(DBAPIError, match="immutable|reserved_administrator"):
        with database.begin() as session:
            session.execute(text("UPDATE employees SET role='admin' WHERE number='0456'"))
    with pytest.raises(DBAPIError, match="employee_number_format"):
        with database.begin() as session:
            session.add(Employee(number="1abc", display_name="Invalid", role="operator"))
            session.flush()


def test_secure_cookie_can_be_required_for_https_deployment(client, monkeypatch):
    sign_out(client)
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    response = client.post("/api/auth/login", json={"employeeNumber": "0456"})
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()
