from pathlib import Path
import pandas as pd

from backend_app.engine import run_targets


def test_engine_snapshot_fixture_file(tmp_path: Path):
    # Load CSV fixtures and write input as Excel (engine expects .xlsx)
    fixtures = Path('tests/fixtures')
    input_csv = fixtures / 'engine_input.csv'
    expected_csv = fixtures / 'expected_output.csv'

    df_in = pd.read_csv(input_csv)
    in_xlsx = tmp_path / 'input.xlsx'
    df_in.to_excel(in_xlsx, index=False)

    cfg = {
        'Enquiry': {
            'wc': True,
            'wc_min': 3,
            'kw_flag': { 'enabled': True, 'mode': 'ANY', 'phrases': ['urgent','help'] },
        }
    }

    kept, _ = run_targets(str(in_xlsx), cfg, save_path=None)

    # Compare to expected CSV snapshot (order and values)
    expected = pd.read_csv(expected_csv)
    # The engine returns more columns; compare only a stable subset
    subset_cols = ['Enquiry','Channel','Enquiry Mistakes']
    kept_subset = kept[subset_cols].reset_index(drop=True)
    pd.testing.assert_frame_equal(kept_subset, expected[subset_cols].reset_index(drop=True))

