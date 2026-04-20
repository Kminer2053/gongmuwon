from pathlib import Path

from gongmu_sidecar.app import create_app


def test_health_bootstraps_runtime_workspace(tmp_path: Path) -> None:
    app = create_app(tmp_path)
    client = app.state.test_client_factory()

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert (tmp_path / "db" / "gongmu.db").exists()
    assert (tmp_path / "knowledge" / "raw").exists()
    assert (tmp_path / "knowledge" / "structured").exists()
    assert (tmp_path / "documents" / "content-bases").exists()
    assert payload["workspace_root"] == str(tmp_path)

