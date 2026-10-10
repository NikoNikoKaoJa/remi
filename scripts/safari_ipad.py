#!/usr/bin/env python3
"""
safari-ipad: open Safari resized to an iPad's CSS viewport (macOS only).

Usage:
    safari_ipad.py                        iPad (9th gen), portrait (default)
    safari_ipad.py ipad9 landscape        specific model + orientation
    safari_ipad.py air5                   defaults to portrait
    safari_ipad.py -i                     interactive menu (family, model, orientation)
    safari_ipad.py --list                 show all model keys
"""

import argparse
import subprocess
import sys
from collections import OrderedDict

# (family, key, name, year, screen inches, width pts, height pts), portrait
DATA = [
    # iPad
    ("iPad", "ipad1",  "iPad (1st gen)",          2010, 9.7,  768, 1024),
    ("iPad", "ipad2",  "iPad 2",                  2011, 9.7,  768, 1024),
    ("iPad", "ipad3",  "iPad (3rd gen)",          2012, 9.7,  768, 1024),
    ("iPad", "ipad4",  "iPad (4th gen)",          2012, 9.7,  768, 1024),
    ("iPad", "ipad5",  "iPad (5th gen)",          2017, 9.7,  768, 1024),
    ("iPad", "ipad6",  "iPad (6th gen)",          2018, 9.7,  768, 1024),
    ("iPad", "ipad7",  "iPad (7th gen)",          2019, 10.2, 810, 1080),
    ("iPad", "ipad8",  "iPad (8th gen)",          2020, 10.2, 810, 1080),
    ("iPad", "ipad9",  "iPad (9th gen)",          2021, 10.2, 810, 1080),
    ("iPad", "ipad10", "iPad (10th gen)",         2022, 10.9, 820, 1180),
    ("iPad", "ipad11", "iPad (11th gen, A16)",    2025, 10.9, 820, 1180),
    # iPad Air
    ("iPad Air", "air1",     "iPad Air (1st gen)",     2013, 9.7,  768, 1024),
    ("iPad Air", "air2",     "iPad Air 2",             2014, 9.7,  768, 1024),
    ("iPad Air", "air3",     "iPad Air (3rd gen)",     2019, 10.5, 834, 1112),
    ("iPad Air", "air4",     "iPad Air (4th gen)",     2020, 10.9, 820, 1180),
    ("iPad Air", "air5",     "iPad Air (5th gen)",     2022, 10.9, 820, 1180),
    ("iPad Air", "air11-m2", "iPad Air 11\" (M2)",     2024, 11.0, 820, 1180),
    ("iPad Air", "air13-m2", "iPad Air 13\" (M2)",     2024, 13.0, 1024, 1366),
    ("iPad Air", "air11-m3", "iPad Air 11\" (M3)",     2025, 11.0, 820, 1180),
    ("iPad Air", "air13-m3", "iPad Air 13\" (M3)",     2025, 13.0, 1024, 1366),
    ("iPad Air", "air11-m4", "iPad Air 11\" (M4)",     2026, 11.0, 820, 1180),
    ("iPad Air", "air13-m4", "iPad Air 13\" (M4)",     2026, 13.0, 1024, 1366),
    # iPad mini
    ("iPad mini", "mini1", "iPad mini (1st gen)",     2012, 7.9, 768, 1024),
    ("iPad mini", "mini2", "iPad mini 2",             2013, 7.9, 768, 1024),
    ("iPad mini", "mini3", "iPad mini 3",             2014, 7.9, 768, 1024),
    ("iPad mini", "mini4", "iPad mini 4",             2015, 7.9, 768, 1024),
    ("iPad mini", "mini5", "iPad mini (5th gen)",     2019, 7.9, 768, 1024),
    ("iPad mini", "mini6", "iPad mini (6th gen)",     2021, 8.3, 744, 1133),
    ("iPad mini", "mini7", "iPad mini (7th gen)",     2024, 8.3, 744, 1133),
    # iPad Pro
    ("iPad Pro", "pro129-1", "iPad Pro 12.9\" (1st gen)", 2015, 12.9, 1024, 1366),
    ("iPad Pro", "pro9",     "iPad Pro 9.7\"",            2016, 9.7,  768, 1024),
    ("iPad Pro", "pro129-2", "iPad Pro 12.9\" (2nd gen)", 2017, 12.9, 1024, 1366),
    ("iPad Pro", "pro10",    "iPad Pro 10.5\"",           2017, 10.5, 834, 1112),
    ("iPad Pro", "pro11-1",  "iPad Pro 11\" (1st gen)",   2018, 11.0, 834, 1194),
    ("iPad Pro", "pro129-3", "iPad Pro 12.9\" (3rd gen)", 2018, 12.9, 1024, 1366),
    ("iPad Pro", "pro11-2",  "iPad Pro 11\" (2nd gen)",   2020, 11.0, 834, 1194),
    ("iPad Pro", "pro129-4", "iPad Pro 12.9\" (4th gen)", 2020, 12.9, 1024, 1366),
    ("iPad Pro", "pro11-3",  "iPad Pro 11\" (3rd gen)",   2021, 11.0, 834, 1194),
    ("iPad Pro", "pro129-5", "iPad Pro 12.9\" (5th gen)", 2021, 12.9, 1024, 1366),
    ("iPad Pro", "pro11-4",  "iPad Pro 11\" (4th gen)",   2022, 11.0, 834, 1194),
    ("iPad Pro", "pro129-6", "iPad Pro 12.9\" (6th gen)", 2022, 12.9, 1024, 1366),
    ("iPad Pro", "pro11-m4", "iPad Pro 11\" (M4)",        2024, 11.0, 834, 1210),
    ("iPad Pro", "pro13-m4", "iPad Pro 13\" (M4)",        2024, 13.0, 1032, 1376),
    ("iPad Pro", "pro11-m5", "iPad Pro 11\" (M5)",        2025, 11.0, 834, 1210),
    ("iPad Pro", "pro13-m5", "iPad Pro 13\" (M5)",        2025, 13.0, 1032, 1376),
]

MODELS = OrderedDict((k, dict(family=f, name=n, year=y, inches=i, size=(w, h)))
                     for f, k, n, y, i, w, h in DATA)
FAMILIES = list(OrderedDict.fromkeys(f for f, *_ in DATA))
ORIENTATIONS = ["portrait", "landscape"]
DEFAULT_MODEL = "ipad9"


def describe(key):
    m = MODELS[key]
    w, h = m["size"]
    return f"{m['name']} ({m['year']}, {m['inches']:g}\") {w}x{h}"


def pick(title, options, labels=None):
    print(title)
    for i, opt in enumerate(options, 1):
        print(f"  {i:2d}) {labels[i - 1] if labels else opt}")
    while True:
        raw = input(f"1-{len(options)}: ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1]
        print("Invalid choice.")


def choose_model():
    family = pick("Family:", FAMILIES)
    keys = [k for k, m in MODELS.items() if m["family"] == family]
    return pick(f"{family} model:", keys, [describe(k) for k in keys])


def open_safari(w, h, x=100, y=100):
    script = f'''
    tell application "Safari"
        activate
        if (count of windows) = 0 then make new document
        set bounds of front window to {{{x}, {y}, {x + w}, {y + h}}}
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True)


def main():
    p = argparse.ArgumentParser(description="Open Safari sized to an iPad viewport.")
    p.add_argument("model", nargs="?", choices=list(MODELS), metavar="model",
                   help="model key, e.g. ipad9, air5, mini6, pro11-m4 (see --list)")
    p.add_argument("orientation", nargs="?", choices=ORIENTATIONS,
                   help="portrait or landscape (default: portrait)")
    p.add_argument("-i", "--interactive", action="store_true", help="pick model/orientation from a menu")
    p.add_argument("--list", action="store_true", help="list model keys and exit")
    args = p.parse_args()

    if args.list:
        for fam in FAMILIES:
            print(f"\n{fam}")
            for k, m in MODELS.items():
                if m["family"] == fam:
                    print(f"  {k:10s} {describe(k)}")
        return

    if sys.platform != "darwin":
        sys.exit("macOS only (uses AppleScript + Safari).")

    defaulted = args.model is None and not args.interactive
    if args.interactive:
        model = args.model or choose_model()
        orientation = args.orientation or pick("Orientation:", ORIENTATIONS)
    else:
        model = args.model or DEFAULT_MODEL
        orientation = args.orientation or "portrait"

    w, h = MODELS[model]["size"]
    if orientation == "landscape":
        w, h = h, w

    print(f"Running: {MODELS[model]['name']}, {orientation} ({w}x{h})")
    if defaulted:
        print("No arguments given, using the default. Other options:")
        print("  safari-ipad <model> [portrait|landscape]   e.g. safari-ipad air5 landscape")
        print("  safari-ipad -i                              pick from a menu")
        print("  safari-ipad --list                          show all model keys")
    open_safari(w, h)


if __name__ == "__main__":
    main()
