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
        with open(args.file) as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    word_count = count_words(text)
    print(f"Words: {word_count}")

    if args.lines:
        line_count = count_lines(text)
        print(f"Lines: {line_count}")


if __name__ == "__main__":
    main()
