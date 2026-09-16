/** Repository-local environment exported by Git, including hooks and `git -c`. */
const REPOSITORY_GIT_ENV = new Set([
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_GRAFT_FILE',
  'GIT_SHALLOW_FILE',
  'GIT_PREFIX',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
]);

/** Keep HOME, global/system configuration and authentication, but switch repositories safely. */
export function independentGitEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => {
      const name = key.toUpperCase();
      return !REPOSITORY_GIT_ENV.has(name) && !/^GIT_CONFIG_(KEY|VALUE)_\d+$/u.test(name);
    }),
  );
}

export function nonInteractiveGitEnvironment(options: {
  authentication: boolean;
  environment?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return {
    ...independentGitEnvironment(options.environment),
    ...(options.authentication
      ? {}
      : {
          GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        }),
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    SSH_ASKPASS_REQUIRE: 'never',
    GIT_NO_REPLACE_OBJECTS: '1',
    GH_PROMPT_DISABLED: '1',
  };
}
