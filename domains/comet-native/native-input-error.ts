export interface NativeInputIssue {
  code: 'invalid-fields';
  path: string;
  context: string;
  missingFields: string[];
  unknownFields: string[];
  expectedFields: string[];
}

/** Field names only: diagnostics must not echo potentially sensitive input values. */
export class NativeInputValidationError extends Error {
  readonly issues: NativeInputIssue[];

  constructor(issue: NativeInputIssue) {
    const detail = [
      issue.missingFields.length ? `missing: ${issue.missingFields.join(', ')}` : '',
      issue.unknownFields.length ? `unknown: ${issue.unknownFields.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    super(`${issue.context} fields are invalid at ${issue.path || '/'} (${detail})`);
    this.name = 'NativeInputValidationError';
    this.issues = [issue];
  }
}

export function assertNativeInputKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  context: string,
  inputPath = '',
): void {
  const actual = Object.keys(value);
  const missingFields = keys.filter((key) => !Object.hasOwn(value, key));
  const unknownFields = actual.filter((key) => !keys.includes(key));
  if (missingFields.length || unknownFields.length) {
    throw new NativeInputValidationError({
      code: 'invalid-fields',
      path: inputPath,
      context,
      missingFields,
      unknownFields,
      expectedFields: [...keys],
    });
  }
}
