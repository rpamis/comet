export type FileIdentityScalar = number | bigint | string;

export interface FileObjectIdentity {
  dev: FileIdentityScalar;
  ino: FileIdentityScalar;
  birthtime: FileIdentityScalar;
}

function hasPlatformIdentity(value: FileIdentityScalar): boolean {
  return value !== 0 && value !== 0n && value !== '0';
}

export function hasComparableFileObject(
  left: FileObjectIdentity,
  right: FileObjectIdentity,
): boolean {
  return (
    hasPlatformIdentity(left.dev) &&
    hasPlatformIdentity(right.dev) &&
    hasPlatformIdentity(left.ino) &&
    hasPlatformIdentity(right.ino)
  );
}

export function sameFileObject(left: FileObjectIdentity, right: FileObjectIdentity): boolean {
  const comparableDevice = hasPlatformIdentity(left.dev) && hasPlatformIdentity(right.dev);
  if (comparableDevice && left.dev !== right.dev) return false;

  const comparableInode = hasPlatformIdentity(left.ino) && hasPlatformIdentity(right.ino);
  if (comparableInode && left.ino !== right.ino) return false;

  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}
