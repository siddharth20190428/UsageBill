import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.web import build_site


@pytest.fixture
def site_client(tmp_path, client):  # `client` already started the API (pool + schema) for the session
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>APP SHELL</html>")
    (tmp_path / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path.parent / "secret.txt").write_text("nope")
    return TestClient(build_site(app, tmp_path))  # no `with`: don't run (and then close) the pool again


def test_api_is_reachable_under_api_prefix(site_client):
    assert site_client.get("/api/health").json() == {"status": "ok"}
    assert site_client.get("/api/customers").status_code == 200


def test_post_through_prefix(site_client):
    r = site_client.post("/api/customers", json={"name": "Via Site"})
    assert r.status_code == 201 and r.json()["name"] == "Via Site"


def test_ui_routes_that_share_names_with_the_api_serve_the_app(site_client):
    for path in ("/", "/customers", "/plans", "/customers/123"):
        r = site_client.get(path)
        assert r.status_code == 200 and "APP SHELL" in r.text, path


def test_static_assets_are_served(site_client):
    assert site_client.get("/assets/app.js").text == "console.log(1)"


def test_missing_asset_is_404_not_the_app_shell(site_client):
    r = site_client.get("/assets/gone.js")
    assert r.status_code == 404 and "APP SHELL" not in r.text


def test_unknown_api_path_is_a_json_404(site_client):
    r = site_client.get("/api/nope")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")


def test_path_traversal_is_blocked(site_client):
    r = site_client.get("/..%2fsecret.txt")
    assert "nope" not in r.text


def test_unbuilt_frontend_says_so(tmp_path, client):
    r = TestClient(build_site(app, tmp_path / "missing")).get("/")
    assert r.status_code == 404 and r.json()["error"]["code"] == "frontend_not_built"
