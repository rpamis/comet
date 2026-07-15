"""Simple word count CLI tool."""

import argparse
import sys


def count_words(text: str) -> int:
    return len(text.split())


def count_lines(text: str) -> int:
    return len(text.splitlines())


def main():
    parser = argparse.ArgumentParser(description="Count words and lines in text")
    parser.add_argument("file", nargs="?", help="Input file (reads stdin if omitted)")
    parser.add_argument("--lines", action="store_true", help="Also count lines")
    args = parser.parse_args()
    text = open(args.file).read() if args.file else sys.stdin.read()
    print(f"Words: {count_words(text)}")
    if args.lines:
        print(f"Lines: {count_lines(text)}")


if __name__ == "__main__":
    main()
