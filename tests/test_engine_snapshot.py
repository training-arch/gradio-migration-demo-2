import pandas as pd
from backend_app.engine import run_targets


def test_engine_snapshot_small_fixture(tmp_path):
    # Build a deterministic small dataset
    df = pd.DataFrame(
        {
            "Enquiry": [
                "please help on this",  # 4 words; wc_min=3 => ok; keyword ANY hits 'help'
                "",  # NULL VALUE
                "two words",  # Too short when wc_min=3
                "normal sentence with enough words",  # ok, no keywords
            ],
            "Channel": ["Email", "Chat", "Chat", "Email"],
        }
    )
    in_path = tmp_path / "in.xlsx"
    df.to_excel(in_path, index=False)

    cfg = {
        "Enquiry": {
            "wc": True,
            "wc_min": 3,
            "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]},
            # filters off
        }
    }

    kept, _ = run_targets(str(in_path), cfg, save_path=None)

    # Expected: rows 0 (keyword flag), 1 (NULL VALUE), 2 (Too short)
    assert kept.shape[0] == 3
    msgs = kept["Enquiry Mistakes"].tolist()
    # Contains one keyword flag
    assert any("Keyword flag: urgent, help" in m for m in msgs)
    # Contains one NULL VALUE exactly
    assert any(m == "NULL VALUE" or m.startswith("NULL VALUE") for m in msgs)
    # Contains one Too short
    assert any("Too short (" in m for m in msgs)

