#!/usr/bin/env node
import { createRequire as __cometCreateRequire } from 'module';
const require = __cometCreateRequire(import.meta.url);

// domains/comet-classic/classic-intent.ts
var COMET_INTENT_SCHEMA_VERSION = "comet.intent.v1";
var COMET_INTENT_CONFIDENCE_THRESHOLD = 0.7;
var INTENT_NAMES = [
  "start_change",
  "resume_change",
  "fix_bug",
  "make_tweak",
  "ask_question",
  "unknown"
];
var ENTITY_TYPES = [
  "change_id",
  "workflow",
  "file_path",
  "command",
  "capability",
  "bug_signal",
  "risk_signal"
];
var REQUESTED_ACTIONS = [
  "start",
  "resume",
  "continue",
  "fix",
  "modify",
  "create",
  "verify",
  "archive",
  "question",
  "unknown"
];
var WORKFLOWS = ["full", "hotfix", "tweak"];
var SCOPES = ["small", "medium", "large", "unknown"];
var ROUTES = ["full", "hotfix", "tweak", "resume", "ask_user", "out_of_scope"];
var NEXT_SKILLS = [
  "comet-open",
  "comet-hotfix",
  "comet-tweak",
  "comet-design",
  "comet-build",
  "comet-verify",
  "comet-archive"
];
var EVIDENCE_SOURCES = ["user", "repo", "state"];
var CometIntentValidationError = class extends Error {
  constructor(issues) {
    super(`Invalid CometIntentFrame:
${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.issues = issues;
  }
  issues;
};
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function enumValue(value, allowed, field, issues) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(`${field} must be one of: ${allowed.join(", ")}`);
    return null;
  }
  return value;
}
function optionalEnumValue(value, allowed, field, issues) {
  if (value === null || value === void 0) return null;
  return enumValue(value, allowed, field, issues);
}
function stringValue(value, field, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string`);
    return "";
  }
  return value;
}
function optionalStringValue(value, field, issues) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${field} must be a non-empty string or null`);
    return null;
  }
  return value;
}
function optionalBooleanValue(value, field, issues) {
  if (value === null || value === void 0) return null;
  if (typeof value !== "boolean") {
    issues.push(`${field} must be boolean or null`);
    return null;
  }
  return value;
}
function confidenceValue(value, field, issues) {
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    issues.push(`${field} must be a number between 0 and 1`);
    return 0;
  }
  return value;
}
function nonNegativeIntegerValue(value, field, issues) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    issues.push(`${field} must be a non-negative integer`);
    return 0;
  }
  return value;
}
function validateFrame(input) {
  const issues = [];
  if (!isRecord(input)) throw new CometIntentValidationError(["frame must be an object"]);
  const intent = isRecord(input.intent) ? input.intent : {};
  if (!isRecord(input.intent)) issues.push("intent must be an object");
  const slots = isRecord(input.slots) ? input.slots : {};
  if (!isRecord(input.slots)) issues.push("slots must be an object");
  const context = isRecord(input.context) ? input.context : {};
  if (!isRecord(input.context)) issues.push("context must be an object");
  const proposedRouteInput = isRecord(input.proposed_route) ? input.proposed_route : {};
  if (!isRecord(input.proposed_route)) issues.push("proposed_route must be an object");
  const entities = input.entities === void 0 ? [] : Array.isArray(input.entities) ? input.entities : [];
  if (input.entities !== void 0 && !Array.isArray(input.entities)) {
    issues.push("entities must be an array");
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!Array.isArray(input.evidence)) issues.push("evidence must be an array");
  const frame = {
    schema_version: enumValue(
      input.schema_version,
      [COMET_INTENT_SCHEMA_VERSION],
      "schema_version",
      issues
    ),
    utterance: stringValue(input.utterance, "utterance", issues),
    locale: input.locale === void 0 ? "unknown" : stringValue(input.locale, "locale", issues),
    intent: {
      name: enumValue(intent.name, INTENT_NAMES, "intent.name", issues) ?? "unknown",
      confidence: confidenceValue(intent.confidence, "intent.confidence", issues)
    },
    entities: entities.map((entity, index) => {
      const record = isRecord(entity) ? entity : {};
      if (!isRecord(entity)) issues.push(`entities[${index}] must be an object`);
      return {
        type: enumValue(record.type, ENTITY_TYPES, `entities[${index}].type`, issues) ?? "risk_signal",
        value: stringValue(record.value, `entities[${index}].value`, issues),
        text: stringValue(record.text, `entities[${index}].text`, issues)
      };
    }),
    slots: {
      requested_action: enumValue(slots.requested_action, REQUESTED_ACTIONS, "slots.requested_action", issues) ?? "unknown",
      workflow_candidate: optionalEnumValue(
        slots.workflow_candidate,
        WORKFLOWS,
        "slots.workflow_candidate",
        issues
      ),
      user_explicit_workflow: optionalEnumValue(
        slots.user_explicit_workflow,
        WORKFLOWS,
        "slots.user_explicit_workflow",
        issues
      ),
      change_id: optionalStringValue(slots.change_id, "slots.change_id", issues),
      target_area: optionalStringValue(slots.target_area, "slots.target_area", issues),
      scope: slots.scope === void 0 ? "unknown" : enumValue(slots.scope, SCOPES, "slots.scope", issues) ?? "unknown",
      existing_behavior: optionalBooleanValue(
        slots.existing_behavior,
        "slots.existing_behavior",
        issues
      ),
      new_capability: optionalBooleanValue(slots.new_capability, "slots.new_capability", issues),
      public_api_change: optionalBooleanValue(
        slots.public_api_change,
        "slots.public_api_change",
        issues
      ),
      schema_change: optionalBooleanValue(slots.schema_change, "slots.schema_change", issues),
      cross_module_change: optionalBooleanValue(
        slots.cross_module_change,
        "slots.cross_module_change",
        issues
      )
    },
    context: {
      active_changes_count: nonNegativeIntegerValue(
        context.active_changes_count,
        "context.active_changes_count",
        issues
      ),
      active_change_names: isRecord(context) ? (() => {
        if (!Array.isArray(context.active_change_names)) {
          issues.push("context.active_change_names must be an array");
          return [];
        }
        if (!context.active_change_names.every((value) => typeof value === "string")) {
          issues.push("context.active_change_names must only contain strings");
          return [];
        }
        return context.active_change_names;
      })() : [],
      dirty_worktree: optionalBooleanValue(
        context.dirty_worktree,
        "context.dirty_worktree",
        issues
      )
    },
    evidence: evidence.map((item, index) => {
      const record = isRecord(item) ? item : {};
      if (!isRecord(item)) issues.push(`evidence[${index}] must be an object`);
      return {
        field: stringValue(record.field, `evidence[${index}].field`, issues),
        quote: stringValue(record.quote, `evidence[${index}].quote`, issues),
        source: enumValue(record.source, EVIDENCE_SOURCES, `evidence[${index}].source`, issues) ?? "user"
      };
    }),
    proposed_route: {
      name: enumValue(proposedRouteInput.name, ROUTES, "proposed_route.name", issues) ?? "ask_user",
      next_skill: optionalEnumValue(
        proposedRouteInput.next_skill,
        NEXT_SKILLS,
        "proposed_route.next_skill",
        issues
      ),
      confidence: confidenceValue(
        proposedRouteInput.confidence,
        "proposed_route.confidence",
        issues
      ),
      requires_confirmation: typeof proposedRouteInput.requires_confirmation === "boolean" ? proposedRouteInput.requires_confirmation : true,
      fallback_reason: optionalStringValue(
        proposedRouteInput.fallback_reason,
        "proposed_route.fallback_reason",
        issues
      )
    }
  };
  if (issues.length > 0) throw new CometIntentValidationError(issues);
  return frame;
}
function hasEvidence(frame, field) {
  return frame.evidence.some((item) => item.field === field && item.quote.trim() !== "");
}
function hasRiskSignal(frame) {
  return frame.slots.new_capability === true || frame.slots.public_api_change === true || frame.slots.schema_change === true || frame.slots.cross_module_change === true;
}
function route(name, confidence, fallback_reason = null) {
  const nextSkill = {
    full: "comet-open",
    hotfix: "comet-hotfix",
    tweak: "comet-tweak",
    resume: null,
    ask_user: null,
    out_of_scope: null
  };
  return {
    name,
    next_skill: nextSkill[name],
    confidence,
    requires_confirmation: name === "ask_user" || name === "out_of_scope",
    fallback_reason
  };
}
function askUser(reason) {
  return route("ask_user", 0.5, reason);
}
function workflowRoute(workflow, confidence) {
  return route(workflow, confidence);
}
function resolveCometIntentRoute(input) {
  const frame = validateFrame(input);
  const diagnostics = [];
  const confidence = frame.intent.confidence;
  let resolved;
  if (frame.intent.confidence < COMET_INTENT_CONFIDENCE_THRESHOLD) {
    resolved = askUser(
      `intent confidence ${frame.intent.confidence} is below ${COMET_INTENT_CONFIDENCE_THRESHOLD}`
    );
  } else if ((frame.intent.name === "resume_change" || frame.slots.requested_action === "resume" || frame.slots.requested_action === "continue") && !frame.slots.change_id && frame.context.active_changes_count > 1) {
    resolved = askUser("multiple active changes require an explicit change_id");
  } else if ((frame.intent.name === "resume_change" || frame.slots.requested_action === "resume" || frame.slots.requested_action === "continue") && frame.slots.change_id) {
    resolved = frame.context.active_change_names.includes(frame.slots.change_id) ? route("resume", confidence) : askUser(`change_id '${frame.slots.change_id}' is not in active_change_names`);
  } else if (frame.intent.name === "ask_question" || frame.slots.requested_action === "question") {
    resolved = route(
      "out_of_scope",
      confidence,
      "user asked a question without requesting a Comet workflow"
    );
  } else if (frame.slots.user_explicit_workflow && frame.slots.user_explicit_workflow !== "full" && hasRiskSignal(frame)) {
    resolved = askUser(
      `explicit workflow '${frame.slots.user_explicit_workflow}' conflicts with risk signals`
    );
  } else if (frame.slots.user_explicit_workflow) {
    resolved = workflowRoute(frame.slots.user_explicit_workflow, confidence);
  } else if (hasRiskSignal(frame)) {
    resolved = route("full", confidence);
  } else if (frame.intent.name === "fix_bug" && frame.slots.existing_behavior === true && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = route("hotfix", confidence);
  } else if (frame.intent.name === "make_tweak" && frame.slots.workflow_candidate === "tweak" && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = route("tweak", confidence);
  } else if (frame.slots.workflow_candidate && hasEvidence(frame, "slots.workflow_candidate")) {
    resolved = workflowRoute(frame.slots.workflow_candidate, confidence);
  } else {
    resolved = askUser("workflow_candidate evidence is missing or route is ambiguous");
  }
  if (resolved.name !== frame.proposed_route.name) {
    diagnostics.push(
      `agent proposed_route '${frame.proposed_route.name}' normalized to '${resolved.name}'`
    );
  }
  if (resolved.next_skill !== frame.proposed_route.next_skill) {
    diagnostics.push(
      `agent proposed_route next_skill '${frame.proposed_route.next_skill}' normalized to '${resolved.next_skill}'`
    );
  }
  if (resolved.requires_confirmation !== frame.proposed_route.requires_confirmation) {
    diagnostics.push(
      `agent proposed_route requires_confirmation '${frame.proposed_route.requires_confirmation}' normalized to '${resolved.requires_confirmation}'`
    );
  }
  if (resolved.fallback_reason !== frame.proposed_route.fallback_reason) {
    diagnostics.push(
      `agent proposed_route fallback_reason '${frame.proposed_route.fallback_reason}' normalized to '${resolved.fallback_reason}'`
    );
  }
  return {
    route: resolved,
    diagnostics,
    normalizedFrame: { ...frame, route: resolved }
  };
}

// domains/comet-classic/classic-intent-command.ts
function result(exitCode, stdout, stderr) {
  return {
    exitCode,
    ...stdout === void 0 ? {} : { stdout },
    ...stderr === void 0 ? {} : { stderr }
  };
}
function usage() {
  return result(
    64,
    void 0,
    "Usage: comet-intent.mjs route <frame-json>\nUsage: comet-intent.mjs route --stdin"
  );
}
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}
var classicIntentCommand = async (args, _options) => {
  const [subcommand, input] = args;
  if (subcommand !== "route") return usage();
  const source = input === "--stdin" ? await readStdin() : input;
  if (!source) return usage();
  try {
    const resolution = resolveCometIntentRoute(JSON.parse(source));
    return result(0, `${JSON.stringify(resolution, null, 2)}
`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return result(1, void 0, `Invalid JSON: ${error.message}`);
    }
    if (error instanceof CometIntentValidationError) {
      return result(1, void 0, error.message);
    }
    throw error;
  }
};

// domains/comet-classic/classic-script-entry.ts
function jsonResult(result2) {
  return {
    exitCode: result2.exitCode,
    stdout: JSON.stringify({
      exitCode: result2.exitCode,
      ...result2.stdout === void 0 ? {} : { stdout: result2.stdout },
      ...result2.stderr === void 0 ? {} : { stderr: result2.stderr }
    }) + "\n"
  };
}
async function runClassicScript(handler, argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  const args = argv.filter((argument) => argument !== "--json");
  let result2;
  try {
    result2 = await handler(args, { json });
  } catch (error) {
    result2 = {
      exitCode: 70,
      stderr: error instanceof Error ? error.message : String(error)
    };
  }
  const output = json ? jsonResult(result2) : result2;
  if (output.stdout) process.stdout.write(output.stdout);
  if (output.stderr)
    process.stderr.write(output.stderr + (output.stderr.endsWith("\n") ? "" : "\n"));
  return output.exitCode;
}

// domains/comet-classic/classic-intent-entry.ts
process.exitCode = await runClassicScript(classicIntentCommand);
