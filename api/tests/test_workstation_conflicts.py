import pytest

from test_inspection import measure, start


CONFLICT = "This sheet changed on another workstation. Reopen it from the job archive before saving or completing."


def test_expected_sequence_prevents_a_stale_workstation_overwriting_a_reading(client):
    run = start(client)
    path = f"/api/runs/{run['id']}/measurements"
    first = client.post(path, json={"shift": "1", "featureId": "f-dg1042-01", "value": "12.5", "expectedSequence": 0})
    assert first.status_code == 201 and first.json()["sequence"] == 1
    stale = client.post(path, json={"shift": "1", "featureId": "f-dg1042-01", "value": "13", "expectedSequence": 0})
    assert stale.status_code == 409 and stale.json()["detail"] == CONFLICT
    current = client.get(f"/api/runs/{run['id']}").json()
    assert len(current["measurements"]) == 1 and current["measurements"][0]["value"] == 12.5
    refreshed = client.post(path, json={"shift": "1", "featureId": "f-dg1042-01", "value": "12.51", "expectedSequence": 1})
    assert refreshed.status_code == 201 and refreshed.json()["sequence"] == 2


def test_stale_completion_cannot_lock_a_sheet_after_an_unseen_correction(client):
    run = start(client)
    path = f"/api/runs/{run['id']}"
    features = client.get("/api/parts/DG-1042").json()["features"]
    for feature in features:
        assert measure(client, run, str(feature["nominal"]), feature["id"]).status_code == 201
    # Another workstation changes a value after this operator last read the sheet.
    correction = client.post(path + "/measurements", json={"shift": "1", "featureId": features[0]["id"], "value": "13", "expectedSequence": 8})
    assert correction.status_code == 201 and correction.json()["sequence"] == 9
    stale = client.post(path + "/complete", json={"shift": "1", "expectedSequence": 8})
    assert stale.status_code == 409 and stale.json()["detail"] == CONFLICT
    assert client.get(path).json()["status"] == "draft"
    completed = client.post(path + "/complete", json={"shift": "1", "expectedSequence": 9})
    assert completed.status_code == 200 and completed.json()["overallStatus"] == "fail"
    # A completed result is immutable; retrying completion only returns that result.
    retry = client.post(path + "/complete", json={"shift": "1", "expectedSequence": 8})
    assert retry.status_code == 200 and retry.json()["completedAt"] == completed.json()["completedAt"]


def test_clients_without_sequence_remain_compatible(client):
    run = start(client)
    features = client.get("/api/parts/DG-1042").json()["features"]
    for feature in features:
        assert measure(client, run, str(feature["nominal"]), feature["id"]).status_code == 201
    assert client.post(f"/api/runs/{run['id']}/complete", json={"shift": "1"}).status_code == 200


@pytest.mark.parametrize("value", [-1, "invalid"])
def test_invalid_sequence_is_rejected_on_save_and_completion(client, value):
    run = start(client)
    path = f"/api/runs/{run['id']}"
    assert client.post(path + "/measurements", json={"shift": "1", "featureId": "f-dg1042-01", "value": "12.5", "expectedSequence": value}).status_code == 422
    assert client.post(path + "/complete", json={"shift": "1", "expectedSequence": value}).status_code == 422
