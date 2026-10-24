"""Simple word count CLI tool."""

import argparse
import sys


def count_words(text: str) -> int:
    """Count words in text."""
    return len(text.split())


def count_lines(text: str) -> int:
    """Count lines in text."""
    return len(text.splitlines())


def main():
    parser = argparse.ArgumentParser(description="Count words and lines in text")
    parser.add_argument("file", nargs="?", help="Input file (reads stdin if omitted)")
    parser.add_argument("--lines", action="store_true", help="Also count lines")
    parser.add_argument("--words", action="store_true", default=True, help="Count words (default)")
    args = parser.parse_args()

    if args.file:
        with open(args.file) as source:
            text = source.read()
    else:
        text = sys.stdin.read()

    print(f"Words: {count_words(text)}")
    if args.lines:
        print(f"Lines: {count_lines(text)}")


if __name__ == "__main__":
    main()
