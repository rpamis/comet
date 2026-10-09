//#region lib/types/matcher.js
/**
* Matcher shared by both hook dialects. Claude treats alphanumeric/underscore/
* pipe patterns as literal alternatives and other patterns as regex; Codex
* treats every non-empty pattern as an unanchored regex. Missing, empty, and
* `*` match all. Runtime matching contains invalid regexes as non-matches;
* config parsers use {@link matcherDiagnostic} to reject them with a diagnostic.
* @module @deepseek-ai/dsh-hook-protocol/matcher
*/
/** True for an absent / empty / `'*'` pattern — the match-all sentinels. */
function isMatchAll(matcher) {
	return matcher === void 0 || matcher === "" || matcher === "*";
}
/** A Claude-literal pattern is purely word chars + `|` (the regex-vs-literal discriminator). */
const CLAUDE_LITERAL = /^[A-Za-z0-9_|]+$/;
/** Compile an unanchored matcher regex; invalid patterns return `undefined`. */
function compileRegex(pattern) {
	try {
		return new RegExp(pattern);
	} catch (_syntaxError) {
		return;
	}
}
/**
* Validate one matcher before a bridge accepts its config group.
* @param matcher - configured pattern; match-all sentinels are valid.
* @param mode - dialect deciding whether a word-and-pipe pattern is literal.
* @returns `undefined` for a valid matcher, otherwise a stable diagnostic.
*/
function matcherDiagnostic(matcher, mode) {
	if (isMatchAll(matcher)) return void 0;
	const pattern = matcher;
	if (mode === "claude-code" && CLAUDE_LITERAL.test(pattern)) return void 0;
	return compileRegex(pattern) === void 0 ? `invalid ${mode} regex matcher ${JSON.stringify(pattern)}` : void 0;
}
/**
* Whether `matcher` selects `query` under the given dialect. Claude literal
* patterns exact-match pipe-separated alternatives; all other patterns are
* unanchored regexes. Invalid regexes return `false` rather than throwing;
* bridge config parsers surface them through {@link matcherDiagnostic} before use.
* @param matcher - the configured pattern; absent/empty/`'*'` are the match-all sentinels.
* @param query - the candidate value (a tool name, a session source, …).
* @param mode - the dialect deciding literal-vs-regex interpretation of the pattern.
* @returns `true` when the pattern selects the query; `false` on a non-match or an invalid
*   regex.
*/
function matchesMatcher(matcher, query, mode) {
	if (isMatchAll(matcher)) return true;
	const pattern = matcher;
	if (mode === "claude-code" && CLAUDE_LITERAL.test(pattern)) return pattern.split("|").includes(query);
	return compileRegex(pattern)?.test(query) ?? false;
}
//#endregion
//#region lib/types/codec.js
/**
* Decode hook process outcomes for both dialects. Exit 0 may carry structured
* JSON or plain stdout; exit 2 blocks with stderr as the reason; every other
* exit is a non-blocking error. Bridges decide which recognized fields apply.
* @module @deepseek-ai/dsh-hook-protocol/codec
*/
/** The exit code a hook uses to signal a blocking error (stderr → model). */
const BLOCKING_EXIT_CODE = 2;
/** Read a string field from a parsed object, or `undefined` if absent/wrong type. */
function str(obj, key) {
	const v = obj[key];
	return typeof v === "string" ? v : void 0;
}
/** Read a boolean field, or `undefined` if absent/wrong type. */
function bool(obj, key) {
	const v = obj[key];
	return typeof v === "boolean" ? v : void 0;
}
/** A plain (non-null, non-array) object, or `undefined`. */
function obj(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
/**
* The legacy TOP-LEVEL `decision` is only `approve`/`block` in both reference
* schemas — `allow`/`deny`/`ask` are reserved for `hookSpecificOutput.
* permissionDecision`. So an out-of-band `{"decision":"deny"}` is invalid and
* ignored here (it must not become a real blocking decision).
*/
function topLevelDecisionOf(value) {
	return value === "approve" || value === "block" ? value : void 0;
}
/** A `hookSpecificOutput.permissionDecision` is `allow`/`deny`/`ask` only. */
function permissionDecisionOf(value) {
	return value === "allow" || value === "deny" || value === "ask" ? value : void 0;
}
/**
* Decode process output into a dialect-neutral hook outcome. This function is
* total: malformed JSON remains plain stdout. When `expectedEventName` is set,
* a missing or different `hookSpecificOutput.hookEventName` discards only its
* event-scoped fields; top-level fields and the claimed discriminator remain.
* Omitting the guard applies the block as-is.
* @param exitCode - process exit, or `undefined` when spawn failed.
* @param stdout - output parsed as structured JSON only on exit 0.
* @param stderr - the captured stderr stream; becomes the blocking `reason` on exit 2.
* @param expectedEventName - firing event used to guard hook-specific fields; omit to disable the guard.
* @returns the dialect-neutral decoded outcome.
*/
function parseHookOutput(exitCode, stdout, stderr, expectedEventName) {
	const trimmedErr = stderr.trim();
	const trimmedOut = stdout.trim();
	const output = {
		exitCode,
		stderr: trimmedErr,
		stdout: trimmedOut
	};
	if (exitCode === BLOCKING_EXIT_CODE) {
		output.decision = "block";
		if (trimmedErr.length > 0) output.reason = trimmedErr;
	}
	if (exitCode === 0) {
		if (trimmedOut.startsWith("{")) {
			let parsed;
			try {
				parsed = obj(JSON.parse(trimmedOut));
			} catch {
				parsed = void 0;
			}
			if (parsed) applyStructured(output, parsed, expectedEventName);
		}
	}
	return output;
}
/**
* Fold a parsed structured-stdout object into `output` (mutates in place).
* `expectedEventName` (the firing event) gates the per-event `hookSpecificOutput`
* block: a block whose `hookEventName` names a different event — OR omits it — has
* its event-scoped fields discarded (any present `hookEventName` is still recorded).
*/
function applyStructured(output, parsed, expectedEventName) {
	const cont = bool(parsed, "continue");
	if (cont !== void 0) output.continue = cont;
	const stopReason = str(parsed, "stopReason");
	if (stopReason !== void 0) output.stopReason = stopReason;
	const sysMsg = str(parsed, "systemMessage");
	if (sysMsg !== void 0) output.systemMessage = sysMsg;
	const topDecision = topLevelDecisionOf(str(parsed, "decision"));
	if (topDecision !== void 0) output.decision = topDecision;
	const topReason = str(parsed, "reason");
	if (topReason !== void 0) output.reason = topReason;
	const hso = obj(parsed.hookSpecificOutput);
	if (hso) {
		const eventName = str(hso, "hookEventName");
		if (eventName !== void 0) output.hookEventName = eventName;
		if (expectedEventName !== void 0 && eventName !== expectedEventName) return;
		const permission = permissionDecisionOf(str(hso, "permissionDecision"));
		if (permission !== void 0) output.decision = permission;
		const permissionReason = str(hso, "permissionDecisionReason");
		if (permissionReason !== void 0) output.reason = permissionReason;
		const addCtx = str(hso, "additionalContext");
		if (addCtx !== void 0) output.additionalContext = addCtx;
		const updated = obj(hso.updatedInput);
		if (updated !== void 0) output.updatedInput = updated;
	}
}
//#endregion

export { matchesMatcher, parseHookOutput };
