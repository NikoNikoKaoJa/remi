#!/usr/bin/env python3
"""
safari-ipad — open Safari resized to match an iPad's CSS viewport (macOS only).

Usage:
    safari_ipad.py                       interactive menu for model + orientation
    safari_ipad.py air landscape         non-interactive
    safari_ipad.py pro11                 defaults to portrait
    safari_ipad.py --list                show available models
"""

import argparse
import subprocess
import sys
from collections import OrderedDict

# viewport sizes in CSS points (width, height), portrait orientation
MODELS = OrderedDict([
    ("mini",   {"label": "iPad mini (744x1133)",          "size": (744, 1133)}),
    ("ipad",   {"label": "iPad 10th gen (810x1080)",       "size": (810, 1080)}),
    ("air",    {"label": "iPad Air 10.9\" (820x1180)",     "size": (820, 1180)}),
    ("pro11",  {"label": "iPad Pro 11\" (834x1194)",       "size": (834, 1194)}),
    ("pro129", {"label": "iPad Pro 12.9\" (1024x1366)",    "size": (1024, 1366)}),
])

ORIENTATIONS = ["portrait", "landscape"]


def prompt_choice(title, options, labels=None):
    """Show a numbered menu and return the chosen key/value from options."""
    print(title)
    for i, opt in enumerate(options, start=1):
        text = labels[i - 1] if labels else opt
        print(f"  {i}) {text}")
    while True:
        raw = input(f"Enter 1-{len(options)}: ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1]
        print("Invalid choice, try again.")


def choose_model():
    keys = list(MODELS.keys())
    labels = [MODELS[k]["label"] for k in keys]
    return prompt_choice("Choose an iPad model:", keys, labels)


def choose_orientation():
    return prompt_choice("Choose orientation:", ORIENTATIONS)


def open_safari(width, height, x=100, y=100):
    script = f'''
    tell application "Safari"
        activate
        if (count of windows) = 0 then
            make new document
        end if
        set bounds of front window to {{{x}, {y}, {x + width}, {y + height}}}
    end tell
    '''
    subprocess.run(["osascript", "-e", script], check=True)


def main():
    parser = argparse.ArgumentParser(description="Open Safari sized to an iPad's viewport.")
    parser.add_argument("model", nargs="?", choices=list(MODELS.keys()),
                         help="iPad model (omit for interactive menu)")
    parser.add_argument("orientation", nargs="?", choices=ORIENTATIONS,
                         default=None, help="portrait or landscape (default: portrait)")
    parser.add_argument("--list", action="store_true", help="list available models and exit")
    args = parser.parse_args()

    if args.list:
        for key, info in MODELS.items():
            print(f"{key:8s} {info['label']}")
        return

    if sys.platform != "darwin":
        print("This script uses AppleScript/Safari and only works on macOS.", file=sys.stderr)
        sys.exit(1)

    model = args.model or choose_model()
    orientation = args.orientation or choose_orientation()

    w, h = MODELS[model]["size"]
    if orientation == "landscape":
        w, h = h, w

    print(f"Opening Safari at {w}x{h} ({model}, {orientation})...")
    open_safari(w, h)


if __name__ == "__main__":
    main()
