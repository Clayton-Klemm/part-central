from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator


ActiveShift = Literal["1", "2", "71"]
RecordedShift = Literal["1", "2", "3", "71"]


Nonempty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    partRevisionId: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    operationId: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    inspector: Nonempty
    jobNumber: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    lotNumber: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    sampleNumber: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class MeasurementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    featureId: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    value: Decimal = Field(max_digits=14, decimal_places=6, allow_inf_nan=False)
    notes: str = Field(default="", max_length=2000)
    expectedSequence: int | None = Field(default=None, ge=0)
    shift: ActiveShift

    @field_validator("value")
    @classmethod
    def finite_decimal(cls, value):
        if not value.is_finite():
            raise ValueError("Measurement must be finite")
        return value


class CompletionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expectedSequence: int | None = Field(default=None, ge=0)
    shift: ActiveShift


class FeatureResponse(BaseModel):
    id: str
    number: int
    label: str
    type: Literal["dimensional", "angular", "geometric"]
    nominal: float
    toleranceMinus: float
    tolerancePlus: float
    unit: Literal["mm", "deg"]
    method: str
    datum: str
    instruction: str
    sketchRef: str
    animationKey: str | None
    zone: str
    critical: bool
    limitType: Literal["bilateral", "minimum", "maximum"] = "bilateral"


class RevisionResponse(BaseModel):
    id: str
    code: str
    status: Literal["draft", "released", "obsolete"]
    releasedAt: str | None
    isActive: bool
    geometryFamily: str | None = None
    changeNote: str = ""


class OperationResponse(BaseModel):
    id: str
    code: str
    name: str
    setup: str
    sketchId: str | None


class PartSummaryResponse(BaseModel):
    id: str
    number: str
    name: str
    description: str
    material: str
    finish: str
    revision: RevisionResponse
    operation: OperationResponse
    references: dict | None = None
    geometryFamily: str | None = None


class PartResponse(PartSummaryResponse):
    features: list[FeatureResponse]


class MeasurementResponse(BaseModel):
    id: str
    sequence: int
    featureId: str
    value: float
    status: Literal["pass", "fail"]
    notes: str
    recordedAt: str
    employeeNumber: str | None = None
    shift: RecordedShift | None = None


class RunSummaryResponse(BaseModel):
    id: str
    partRevisionId: str
    operationId: str
    partNumber: str
    revisionCode: str
    jobId: str
    jobNumber: str
    inspector: str
    lotNumber: str
    sampleNumber: str
    status: Literal["draft", "completed"]
    createdAt: str
    completedAt: str | None
    overallStatus: Literal["pass", "fail"] | None
    measurementCount: int
    employeeNumber: str | None = None
    completedByEmployeeNumber: str | None = None
    completedShift: RecordedShift | None = None
    lastActivityAt: str
    lastRecordedByEmployeeNumber: str | None = None
    lastRecordedShift: RecordedShift | None = None


class RunResponse(RunSummaryResponse):
    references: dict
    measurements: list[MeasurementResponse]
