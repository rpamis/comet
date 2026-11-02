# Optional change walkthrough

The project `.comet/config.yaml` field `change_walkthrough` defaults to `true`, including when absent. Follow this reference to generate a walkthrough; enabling it uses extra explanation tokens. Only explicit `false` skips extra explanation work, detailed instructions and HTML rendering, retaining the existing completion summary without additional diff reads or model requests for the walkthrough.

## Build completion

Reuse the current context, actual changes and existing check results to explain changes by feature. Do not start another Agent, model service or check. One group is enough for a small change; put major changes first for larger work, with the rest collapsed by the template. A Native Supervisor explains integrated results only and marks unintegrated child work as incomplete.

Lead with the result in user-facing terms, then explain before → after and why. Each group lists relevant files, added/modified/deleted/renamed labels and enough key code or local diff to inspect; paths may include line numbers or symbols. Explain removed behavior for deletions; do not invent behavior changes for renames. Reuse the known comparison scope, disclose uncertainty or unrelated user edits, and do not claim unrelated work. Exclude secrets, credentials and unrelated content; do not fill the page with the full diff.

Write the following content into a system temporary JSON file outside the project worktree so renderer input cannot affect implementation checks. This is renderer input, not new workflow state or a required handoff protocol. The model supplies content only, never HTML, CSS or scripts:

```json
{
  "summary": "Search now supports tag filters",
  "scope": "Known comparison scope and limitations, such as HEAD against this worktree change",
  "changes": [
    {
      "title": "Tag filtering",
      "before": "Keyword search only",
      "after": "Keywords and tags can be combined",
      "reason": "Narrow the results",
      "files": [
        { "path": "src/search.ts:12", "kind": "modified", "code": "Key code or local diff" }
      ]
    }
  ],
  "verification": [
    {
      "label": "Builder checks",
      "status": "passed",
      "detail": "Actual command, result and coverage"
    },
    { "label": "Independent verification", "status": "not-run", "detail": "Not yet performed" }
  ]
}
```

`kind` is `added`, `modified`, `deleted` or `renamed`. Verification status is `passed`, `failed`, `not-run` or `unknown`; distinguish Builder checks, Runtime checks, independent verification and unrun items, including actual results, known risks and limitations. Explanation does not replace verification evidence.

### Add diagrams when useful

For changes to execution order, calls or data flow, prefer a short flow diagram showing the main path and important branches. For module splits, replacements or responsibility changes, use a before/after box comparison. Place diagrams after the overview and connect them to files and code in reading order. Simple wording, configuration values or isolated edits can omit diagrams; never invent relationships to fill one. One or two diagrams are usually enough. They do not replace explanation or verification.

Optionally include a `diagrams` array in the same temporary content. The model supplies nodes, edges and labels; the fixed template renders inline SVG. Do not author SVG, HTML, CSS, Mermaid or scripts, or add an Agent or model call. For example, extend the search change above with:

```json
{
  "diagrams": [
    {
      "type": "flow",
      "title": "Search path",
      "nodes": [
        { "id": "input", "label": "Keywords and tags" },
        {
          "id": "filter",
          "label": "Combined filter",
          "file": "src/search.ts:12",
          "kind": "modified"
        },
        { "id": "result", "label": "Matching results" }
      ],
      "edges": [
        { "from": "input", "to": "filter" },
        { "from": "filter", "to": "result" }
      ]
    }
  ]
}
```

For a comparison, use `{"type":"comparison","title":"Responsibility changes","before":{"nodes":[...],"edges":[...]},"after":{"nodes":[...],"edges":[...]}}`, with the same node/edge structure on each side. Optional node `kind` uses the existing added/modified/deleted/renamed file labels; mark real changes only. Optional node `file` must exactly match a `changes[].files[].path`; clicking it locates that code detail. When a path has multiple snippets, use the same line or symbol qualifier in both locations.

Each short graph has 2–6 nodes, 1–8 edges and at most two nodes per level. Node IDs are unique and listed in execution or dependency order; `from`/`to` connect existing nodes in forward order. Optional edge `label` briefly explains a condition. Split large relationships or complex loops into small diagrams, show only a supported main path and explain omitted branches in prose. Omit `diagrams` when unnecessary. A page diagram is not execution evidence.

Run `comet walkthrough <native|classic> <change-name> --project-root <project-root> --file <temporary-json>`. Success returns an absolute `path`; the fixed template writes `walkthrough.html` into the current change directory. Retain a short chat summary and provide `[View change walkthrough](<absolute-path>)` before the existing acceptance or delivery decision. The page opens directly in a browser. On failure, report that the walkthrough was not generated and why; correct the content and retry if useful. Continue the original workflow without adding a phase or approval.

Remove disposable input after use so it does not enter implementation diffs; never delete user files. Do not declare the display page as a formal brief artifact, check input, candidate or additional binding.

## Update the same page during Verify

Use actual checks and independent verification results. For verification-only changes, supply a temporary JSON containing only the `verification` array and add `--verification-only` to the same command. The renderer reuses explanation and diagrams stored in the page, so the model does not reorganize them. If code changed, update the affected explanation, nodes and edges, then replace the same page with full content and accurate results. If the page is missing, generate it from current context when useful; absence does not block acceptance. The independent Verifier first examines requirements and code independently, then treats the Builder explanation as a lead.

Updating the page runs no code checks and changes no Run or approval. Link to the current page in the response. When disabled, do not update or generate; existing pages need not be deleted.

## Preserve during Archive

Preserve an existing page with the change materials and use the archive directory returned by the Runtime for the final local link. Do not generate or reorganize explanations during Archive, or block because the page is absent. Link only when the file exists; otherwise retain the existing completion summary.
