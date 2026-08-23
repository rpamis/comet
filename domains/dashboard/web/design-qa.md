# Project Knowledge Option 2 Design QA

## Evidence

- Source visual truth: `C:/Users/BENYM/.codex/generated_images/01a02e47-d9fe-7181-b990-5d39e2b7b7ce/exec-46b83e5f-ff9f-4c7e-a6cd-9b2d5696b6d7.png` (1487 × 1058 px).
- Reported wide-screen before state: `C:/Users/BENYM/AppData/Local/Temp/codex-clipboard-c66b2cc1-f66e-4156-8684-bff49ac2d45b.png` (2549 × 1260 px).
- Reported typography before state: `C:/Users/BENYM/AppData/Local/Temp/codex-clipboard-6ff6d417-f718-4b1b-b40e-cc1935f8ea29.png` (2544 × 1251 px).
- Browser-rendered implementation: `D:/Project/Comet/test/domains/dashboard/coverage/project-knowledge-readable-type.png` (1280 × 720 px).
- Personal Memory typography evidence: `D:/Project/Comet/test/domains/dashboard/coverage/personal-memory-readable-type.png` (1280 × 720 px).
- Settings typography evidence: `D:/Project/Comet/test/domains/dashboard/coverage/plugin-settings-readable-type.png` (1280 × 720 px).
- Dark-theme evidence: `D:/Project/Comet/test/domains/dashboard/coverage/project-knowledge-option-2-dark.png` (1440 × 1024 px).
- Normalized source crop: `D:/Project/Comet/test/domains/dashboard/coverage/project-knowledge-option-2-source-1280x720.png` (1280 × 720 px).
- Combined same-size comparison input: `D:/Project/Comet/test/domains/dashboard/coverage/project-knowledge-readable-type-comparison.png` (2560 × 780 px, including labels).
- Focused typography comparison: `D:/Project/Comet/test/domains/dashboard/coverage/project-knowledge-readable-type-focused-comparison.png` (1280 × 480 px).
- First-screen overflow source: `C:/Users/BENYM/AppData/Local/Temp/codex-clipboard-f6adf499-7497-4b89-8abb-3e279e6fa0f8.png` (2546 × 1262 px).
- First-screen implementation: `http://localhost:5174/`, browser-rendered at `2546 × 1262` and emitted with the source in the same comparison input.
- Viewport: 1280 × 720, device scale factor 1. The source was cropped to its corresponding 16:9 above-the-fold region and resampled to 1280 × 720 before comparison.
- State: current real project, Local Provider, no knowledge records, one source diagnostic. The source mock contains populated records, so visual comparison uses the shared structure and treats the expected content-state difference separately.

## Full-view comparison

- The implementation matches the selected enterprise registry structure: compact page title and service state, restrained underline tabs, one primary action, category explorer, flat record ledger, and persistent detail inspector.
- Sidebar selection, thin separators, neutral canvas, compact controls, blue selection state, and low-radius surfaces follow the selected visual language without changing Native or Classic content.
- Empty data remains legible inside the same three-pane structure instead of collapsing into a dashboard of summary cards.
- The Project Knowledge route now opts out of the generic 1620 px centered content cap. Its header, tabs, and registry share the full workspace width inside the Dashboard content padding.
- Sidebar and plugin text now uses a desktop-readable hierarchy: 14 px navigation and body copy, 12–13 px supporting copy, 16 px section titles, and 24–26 px page titles.

## Focused comparison

- The explorer preserves the reference hierarchy while mapping categories to Comet's real Project Knowledge types instead of inventing source-only categories.
- The ledger keeps the reference's filter-and-table rhythm. Diagnostics stay inline and bounded above the rows, so warning content does not displace the workspace.
- The inspector preserves the reference's always-visible review surface and maps it to application conditions, source evidence, verification records, activity, correction, and removal.
- The creation flow uses the same restrained modal language, while retaining every existing Project Knowledge field and real save action.
- A focused crop was required for this pass because full-view scaling made 10–14 px differences difficult to judge. The focused comparison confirms that the sidebar, title, tabs, filters, and category explorer now retain distinct readable levels without looking oversized.

## Fidelity surfaces

- Typography: existing Segoe UI Variable and Chinese system fallbacks preserve the compact B2B product hierarchy.
- Layout: the three-pane registry fills the available first viewport and collapses at the existing responsive breakpoints.
- Color: neutral surfaces, thin cool-gray borders, blue interaction states, and limited amber diagnostics match the source direction in light and dark themes.
- Controls: visible Project Knowledge actions, filters, tabs, state labels, and modal actions are Chinese. Classic and Native naming remains unchanged as requested.
- Assets: the existing Comet mark and Ant Design icon set are retained; no placeholder, handcrafted SVG, CSS-drawn asset, or decorative imagery was introduced.

## Comparison history

### Iteration 1

- P1: the first implementation left too much unused space below the registry on a 1440 × 1024 viewport. Fixed by sizing the registry against the available viewport while retaining an automatic layout below 1180 px.
- P1: a raw provider diagnostic exposed an internal English diagnostic code. Fixed by mapping the code to a Chinese label while preserving its actionable source path.

### Iteration 2

- The final combined comparison confirms that navigation, header, tabs, explorer, ledger, inspector, borders, and primary action retain the selected Option 2 hierarchy.

### Iteration 3

- P1: at 2549 × 1260, the generic Dashboard maximum width centered the complete Project Knowledge route and capped the registry height, making it look like a detached page inside the workbench.
- Fixed by assigning a Project Knowledge-specific full-width content container, removing the duplicate child maximum width, letting the record ledger absorb wide-screen space, clamping only the inspector, and sizing the registry against the desktop viewport height.
- Removed the registry's top border and top corner radii so the tab divider and three-pane workspace read as one continuous surface.
- Post-fix browser evidence and the normalized comparison confirm that the page title, tabs, and registry align to one shared content edge. The user's 2549 px screenshot remains the before-state evidence; the in-app browser's 1280 px viewport cannot reproduce that exact physical width, so the wide-only maximum-width regression is additionally protected by a source contract test.
- No actionable P0, P1, or P2 visual differences remain. The populated reference and empty live project intentionally differ only in record content.

### Iteration 4

- P1: persistent sidebar and plugin copy used 10–12 px in many places, making navigation, table headers, diagnostics, categories, details, and Settings text visibly undersized on the reported 2544 × 1251 desktop.
- Fixed with scoped typography tokens: 14 px navigation and plugin body text, 12 px minimum captions, 13 px supporting copy, 16 px section headings, and 24–26 px page headings. Navigation row heights and line heights were increased with the type scale.
- Personal Memory and Settings inherit the same readable plugin scale. Classic and Native center content remains at its existing 13–14 px workspace scale; only their shared sidebar labels changed.
- At the narrower 1280 px verification viewport, Project Knowledge hides lower-value source and timestamp columns so the larger text does not overlap or clip. Wide layouts continue to show the complete ledger.
- Post-fix full and focused comparisons show a clear hierarchy with no clipped persistent controls or illegible captions.

## Interaction and runtime checks

- Tested Project Knowledge navigation, all three tabs, record search input, retrieval input, creation modal open and cancel, and light/dark theme switching in the in-app browser.
- Confirmed the creation modal retains type, title, summary, scope, source, and verification inputs with localized actions.
- Repeated the final interaction pass in a fresh browser tab; no console errors were present.
- Checked the final content, page, header, tabs, and registry rectangles in the browser; they resolve to the same left and right boundaries within the Dashboard content padding.
- Measured final browser typography: sidebar navigation 14 px; Project Knowledge title 26 px, body and tabs 14 px, supporting copy 13 px, captions 12 px; Personal Memory and Settings titles 24 px with 14 px body text.
- Confirmed Native center remains 13 px with 14 px explorer text, and Classic/Native section headings remain 18 px.

## Findings

- No remaining P0, P1, or P2 findings.
- P3: the source mock includes pagination and bulk selection for a populated dataset. They are intentionally omitted until the real record volume requires them, avoiding inactive controls in the current empty state.

### Iteration 5

- P2: at the reported 2546 × 1262 viewport, the registry's viewport-derived height ignored the real title, tabs, and content padding, so the provider footer required page scrolling and appeared clipped by the app frame.
- Fixed by making the wide-screen Project Knowledge page a bounded column flex layout. The registry, source view, and query view now consume the actual remaining content height and keep scrolling inside their own panes; existing stacked behavior below 1181 px is preserved.
- Post-fix geometry at 2546 × 1262: registry bottom `1215px`, provider footer bottom `1214px`, workbench bottom `1246px`, and content shell `scrollHeight === clientHeight === 1162px` at `scrollTop: 0`.
- The same fix was verified at 1600 × 900. The provider footer is fully visible without page scrolling, and the browser console contains no errors.
- Typography, color tokens, icons, copy, and all non-Project-Knowledge workspace elements remain unchanged.

final result: passed
