const TRUSTED_IDENTITY = Symbol('comet.native.trusted-execution-identity');
const TRUSTED_ENVELOPE = Symbol('comet.native.trusted-verifier-envelope');

export const NATIVE_SKILL_COORDINATION = 'skill-coordinated' as const;

export interface NativeRunnerExecutionIdentityInput {
  identityProvider: string;
  executionRef: string;
}

export interface NativeTrustedExecutionIdentity {
  readonly identityProvider: string;
  readonly executionRef: string;
  readonly [TRUSTED_IDENTITY]: true;
}

export interface NativeTrustedVerifierEnvelope<TPayload> {
  readonly candidateId: string;
  readonly identityProvider: string;
  readonly verifierExecutionRef: string;
  readonly payload: TPayload;
  readonly [TRUSTED_ENVELOPE]: true;
}

export interface NativeRunnerChannel {
  captureExecutionIdentity(
    input: NativeRunnerExecutionIdentityInput,
  ): NativeTrustedExecutionIdentity;
  envelopeVerifierResponse<TPayload>(options: {
    candidateId: string;
    identity: NativeTrustedExecutionIdentity;
    payload: TPayload;
  }): NativeTrustedVerifierEnvelope<TPayload>;
}

function requiredOpaqueText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

/**
 * Create the package-local Runner seam.
 *
 * This constructor is shipped with Comet and can be called by any local
 * process, so it can only create Skill-coordinated identities. A future host
 * attestation path must live outside this package boundary instead of trusting
 * caller-provided provider strings.
 */
export function createNativeRunnerChannel(): NativeRunnerChannel {
  const identities = new WeakSet<object>();
  return Object.freeze({
    captureExecutionIdentity(
      input: NativeRunnerExecutionIdentityInput,
    ): NativeTrustedExecutionIdentity {
      requiredOpaqueText(input.identityProvider, 'Native identity provider');
      const identity = Object.freeze({
        identityProvider: NATIVE_SKILL_COORDINATION,
        executionRef: requiredOpaqueText(input.executionRef, 'Native execution ref'),
        [TRUSTED_IDENTITY]: true as const,
      });
      identities.add(identity);
      return identity;
    },
    envelopeVerifierResponse<TPayload>(options: {
      candidateId: string;
      identity: NativeTrustedExecutionIdentity;
      payload: TPayload;
    }): NativeTrustedVerifierEnvelope<TPayload> {
      if (!identities.has(options.identity)) {
        throw new Error('Native execution identity was not captured by this Runner channel');
      }
      return Object.freeze({
        candidateId: requiredOpaqueText(options.candidateId, 'Native candidate ID'),
        identityProvider: options.identity.identityProvider,
        verifierExecutionRef: options.identity.executionRef,
        payload: options.payload,
        [TRUSTED_ENVELOPE]: true as const,
      });
    },
  });
}

export function isNativeTrustedVerifierEnvelope<TPayload>(
  value: unknown,
): value is NativeTrustedVerifierEnvelope<TPayload> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[TRUSTED_ENVELOPE] === true
  );
}

export function isNativeTrustedExecutionIdentity(
  value: unknown,
): value is NativeTrustedExecutionIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[TRUSTED_IDENTITY] === true
  );
}
