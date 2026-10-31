import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from test_catalog import catalog_admin, create, feature, release, save, start


@pytest.mark.parametrize("kind,mode,nominal,value,expected", [
    ("geometric", "maximum", .03, -.001, "fail"),
    ("geometric", "bilateral", 0, -.001, "fail"),
    ("geometric", "minimum", 0, -.001, "fail"),
    ("geometric", "maximum", .03, 0, "pass"),
    ("geometric", "maximum", .03, .02, "pass"),
    ("geometric", "maximum", .03, .030001, "fail"),
    ("dimensional", "bilateral", -1, -1, "pass"),
    ("angular", "bilateral", -5, -5, "pass"),
])
def test_geometric_magnitudes_reject_negative_readings_without_rejecting_signed_coordinates(catalog_admin, database, kind, mode, nominal, value, expected):
    client = catalog_admin
    requirement = feature(mode=mode, nominal=nominal)
    requirement.update(type=kind, unit="deg" if kind == "angular" else "mm", animationKey=None, label="Magnitude or signed-coordinate example")
    if mode == "bilateral":
        requirement.update(toleranceMinus=.1, tolerancePlus=.1)
    prepared = save(client, create(client), [requirement])
    assert prepared.status_code == 200, prepared.text
    part = release(client, prepared.json()).json()
    run = start(client, part).json()
    recorded = client.post(f"/api/runs/{run['id']}/measurements", json={"shift": "1", "featureId": part["features"][0]["id"], "value": value})
    assert recorded.status_code == 201, recorded.text
    assert recorded.json()["status"] == expected
    history = client.get(f"/api/runs/{run['id']}").json()["measurements"]
    assert len(history) == 1 and history[0]["value"] == value
    assert history[0]["status"] == expected
    if kind == "geometric" and value < 0:
        with pytest.raises(IntegrityError, match="status disagrees"), database.begin() as session:
            session.execute(text("""INSERT INTO measurements
              (id,sequence,run_id,feature_id,value,status,notes,recorded_at,employee_number,shift)
              VALUES ('invalid-negative-geometric',999,:run,:feature,:value,'pass','',CURRENT_TIMESTAMP,'0000','1')"""),
              {"run": run["id"], "feature": part["features"][0]["id"], "value": value})
