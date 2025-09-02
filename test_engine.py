"""
Minimal runnable example that exercises backend_app.engine.run_targets.

Run:
    python test_engine.py
Expected:
    Prints flagged rows and writes mistakes_only.xlsx in the working directory.
"""
import pandas as pd
from backend_app.engine import run_targets


def main():
    # Create a tiny sample dataset
    df = pd.DataFrame({
        "Enquiry": [
            "Please help, this is urgent and we need assistance.",  # >= 3 words + keyword hit
            "",                                                     # empty (NULL VALUE)
            "two words",                                            # < 3 words
            "Normal length sentence with no trigger keywords."      # ok
        ],
        "Category": ["A", "B", "C", "A"],
    })
    in_path = "sample.xlsx"
    df.to_excel(in_path, index=False)

    targets_config = {
        "Enquiry": {
            "wc": True,
            "wc_min": 3,
            "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]},
            # Filters OFF by default; leave as-is for the demo
        }
    }

    kept, out_path = run_targets(in_path, targets_config, save_path="mistakes_only.xlsx")
    print("Flagged rows:")
    print(kept[["Enquiry", "Category", "Enquiry Mistakes"]])
    print("\nOutput written to:", out_path or "(not saved)")


if __name__ == "__main__":
    main()