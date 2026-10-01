You are working on a Python project called "wordcount-cli" - a simple command-line word counting tool.

Your task: Use the comet workflow to add a new feature: **sentence counting** (`--sentences` flag).

Before starting the workflow, initialize a local Git repository if one is missing and commit the supplied `wordcount.py` and `test_wordcount.py` as the initial baseline. Classic local Archive includes a commit and needs this repository. Do not configure a remote, push, or create a pull request; complete local Archive only.

The feature requirements:
- Add a `--sentences` flag to the CLI
- Count sentences by splitting on `.`, `!`, `?`
- Output format: `Sentences: N`
- Handle edge cases (empty input, no punctuation)

Follow the comet workflow phases:
1. **Open**: Create proposal, design outline, and task list
2. **Design**: Deep design with brainstorming (create a Design Doc)
3. **Build**: Plan implementation and write the code
4. **Verify**: Run tests and verify the implementation
5. **Archive**: Archive the completed change

Start by detecting the current phase and following the comet workflow.
