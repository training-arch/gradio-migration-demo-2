import pytest
from fastapi.testclient import TestClient


def test_configs_crud_roundtrip(tmp_path, monkeypatch):
    # Force BASE_DIR to temp so we don't pollute repo
    import importlib
    api_mod = importlib.import_module('backend_app.api')
    monkeypatch.setattr(api_mod, 'BASE_DIR', tmp_path, raising=False)
    client = TestClient(api_mod.app)

    # Initially empty
    r = client.get('/configs')
    assert r.status_code == 200
    assert isinstance(r.json().get('items'), list)

    # Save one
    payload = {
        'name': 'Campaign A summary',
        'description': 'My first preset',
        'targets_config': {
            'Enquiry': { 'wc': True, 'wc_min': 3, 'kw_flag': { 'enabled': True, 'mode': 'ANY', 'phrases': ['urgent','help']}}
        }
    }
    rs = client.post('/configs', json=payload)
    assert rs.status_code == 200

    # Get it back
    rg = client.get('/configs/Campaign A summary')
    assert rg.status_code == 200
    body = rg.json()
    assert body['name'] == 'Campaign A summary'
    assert body['targets_config']['Enquiry']['wc'] is True

    # List should include it
    rl = client.get('/configs')
    assert any(i['name'] == 'Campaign A summary' for i in rl.json()['items'])

    # Delete
    rd = client.delete('/configs/Campaign A summary')
    assert rd.status_code == 200
    rn = client.get('/configs/Campaign A summary')
    assert rn.status_code == 404

