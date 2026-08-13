# Dashboard artifact preview

## Purpose

Dashboard displays artifact content in a side drawer and supports an expanded fullscreen reading mode.

## Preview tables

Rendered Markdown, YAML, and JSON preview tables keep header labels on one line. When a header needs more horizontal space than its container, the preview provides horizontal scrolling instead of wrapping the header label. This does not change the existing wrapping behavior of table body cells or force a table to expand to the width of its body content.

## Fullscreen table of contents

The table of contents is visible only while an artifact preview is fullscreen and has headings. Its sidebar is 250px wide. The directory label uses a 14px font size and each directory link uses a 16px font size.

## Keyboard closing

While fullscreen artifact preview is active, pressing Escape closes the artifact preview. The side-drawer preview does not install this Escape shortcut.

## Header alignment

When a preview path is available, its copy button and path text share a vertically centered layout in the preview header. The path text has no paragraph margins that could displace it from the copy button.
