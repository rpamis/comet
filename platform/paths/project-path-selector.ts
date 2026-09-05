/** Match a repository-relative file or subtree selector, including globstar. */
export function projectPathSelectorMatches(selector: string, projectPath: string): boolean {
  selector = selector.replaceAll('\\', '/').replace(/^\.\//u, '').toLocaleLowerCase();
  projectPath = projectPath.replaceAll('\\', '/').replace(/^\.\//u, '').toLocaleLowerCase();
  if (!/[?*]/u.test(selector)) {
    return (
      selector === projectPath ||
      projectPath.startsWith(selector.endsWith('/') ? selector : `${selector}/`)
    );
  }
  let pattern = '^';
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]!;
    const next = selector[index + 1];
    if (character === '*' && next === '*') {
      if (selector[index + 2] === '/') {
        pattern += '(?:.*/)?';
        index += 2;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (character === '*') pattern += '[^/]*';
    else if (character === '?') pattern += '[^/]';
    else pattern += character.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&');
  }
  return new RegExp(`${pattern}$`, 'u').test(projectPath);
}
