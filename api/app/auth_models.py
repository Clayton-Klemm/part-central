"""Local employee identification and opaque, revocable server sessions.

An employee number identifies an operator on a trusted local pilot. It is not
a password. The reserved administrator account additionally requires the
server's administrator credential before a session can be created.
"""
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


def utcnow():
    return datetime.now(timezone.utc)


digits = "number"
for digit in "0123456789":
    digits = f"replace({digits}, '{digit}', '')"
EMPLOYEE_NUMBER_CHECK = f"length(number) = 4 AND {digits} = ''"


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (
        CheckConstraint(EMPLOYEE_NUMBER_CHECK, name="employee_number_format"),
        CheckConstraint("(number = '0000' AND role = 'admin') OR (number <> '0000' AND role = 'operator')", name="reserved_administrator"),
    )
    number: Mapped[str] = mapped_column(String(4), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EmployeeSession(Base):
    __tablename__ = "employee_sessions"
    __table_args__ = (
        CheckConstraint("length(token_hash) = 64", name="session_token_hash_length"),
        CheckConstraint("expires_at > created_at", name="session_expiry_after_creation"),
        Index("ix_employee_sessions_employee", "employee_number"),
        Index("ix_employee_sessions_expiry", "expires_at"),
    )
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    employee_number: Mapped[str] = mapped_column(ForeignKey("employees.number"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
