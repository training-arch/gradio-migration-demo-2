import os
import tempfile
import pandas as pd

from backend_app.engine import run_targets


def write_xlsx(df: pd.DataFrame) -> str:
    fd, path = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    df.to_excel(path, index=False)
    return path


def test_word_count_and_null_and_keyword_flag():
    df = pd.DataFrame({
        "Enquiry": [
            "Please help, this is urgent and we need assistance.",  # keyword hit
            "",  # NULL VALUE
            "two words",  # Too short for wc_min=3
            "A normal length sentence with no trigger keywords",
        ],
        "Category": ["A", "B", "C", "A"],
    })
    in_path = write_xlsx(df)
    cfg = {
        "Enquiry": {
            "wc": True,
            "wc_min": 3,
            "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]},
        }
    }
    kept, _ = run_targets(in_path, cfg, save_path=None)

    # Expect 3 rows kept: keyword hit, NULL VALUE, Too short
    assert len(kept) == 3
    mistakes = kept["Enquiry Mistakes"].tolist()
    # One message contains keyword flag
    assert any(m != "[]" and "Keyword flag: urgent, help" in m for m in mistakes)
    # One message is NULL VALUE
    assert any(m == "NULL VALUE" or m.startswith("NULL VALUE") for m in mistakes)
    # One message is Too short (<3 words)
    assert any("Too short (<3 words)" in m for m in mistakes)


def test_value_filters_gate_rows():
    df = pd.DataFrame({
        "Enquiry": [
            "short",  # would be too short without filter gate
            "another short",  # too short
            "this one should be counted as long enough",
        ],
        "Channel": ["Email", "Chat", "Chat"],
    })
    in_path = write_xlsx(df)
    cfg = {
        "Enquiry": {
            "wc": True,
            "wc_min": 3,
            "vf_on": True,
            "filters": {"Channel": ["Chat"]},  # allow only Chat rows
            "filter_mode": "AND",
        }
    }
    kept, _ = run_targets(in_path, cfg, save_path=None)

    # Channel == Email row is gated out entirely by value filter
    # Remaining rows: one short (Too short) and one long enough ([]) => kept should be 1
    assert len(kept) == 1
    assert kept.iloc[0]["Enquiry Mistakes"].startswith("Too short ("), kept


def test_text_filters_include_exclude_modes():
    df = pd.DataFrame({
        "Enquiry": [
            "contains abc and xyz",
            "contains abc only",
            "contains nothing",
        ],
        "Notes": [
            "xyz present",
            "no xyz here",
            "abc present",
        ],
    })
    in_path = write_xlsx(df)
    cfg = {
        "Enquiry": {
            "wc": True,
            "wc_min": 3,
            "tf_on": True,
            "text_filters": {
                # Include rows where Notes contains xyz (ANY over phrases default)
                "Notes": {"mode": "ANY", "phrases": ["xyz"], "include": True}
            },
            "filter_mode": "AND",
        }
    }
    kept, _ = run_targets(in_path, cfg, save_path=None)

    # Rows kept by text filter: indices 0 (xyz present) only; of those, wc_min=3 passes
    # Enquiry[0] has >= 3 words, so result depends only on wc/kw (no kw here) => []
    # Engine keeps only rows where mistakes != [], so with no kw and wc satisfied, nothing kept.
    # To assert gating, flip include to exclude and ensure different kept count.

    cfg_excl = {
        "Enquiry": {
            "wc": True,
            "wc_min": 5,
            "tf_on": True,
            "text_filters": {
                # Exclude rows where Notes contains abc
                "Notes": {"mode": "ANY", "phrases": ["abc"], "include": False}
            },
            "filter_mode": "AND",
        }
    }
    kept2, _ = run_targets(in_path, cfg_excl, save_path=None)

    # With wc_min=5, some rows become Too short, but rows with abc in Notes are excluded beforehand.
    # Expect at least one kept row (Too short) remaining.
    assert len(kept2) >= 1
    assert any("Too short (" in m for m in kept2["Enquiry Mistakes"].tolist())

