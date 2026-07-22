export type NativeFileIdentityScalar = number | bigint | string;

export interface NativeFileObjectIdentity {
  dev: NativeFileIdentityScalar;
  ino: NativeFileIdentityScalar;
  birthtime: NativeFileIdentityScalar;
}

function hasPlatformIdentity(value: NativeFileIdentityScalar): boolean {
  return value !== 0 && value !== 0n && value !== '0';
}

export function hasComparableNativeFileObject(
  left: NativeFileObjectIdentity,
  right: NativeFileObjectIdentity,
): boolean {
  return (
    hasPlatformIdentity(left.dev) &&
    hasPlatformIdentity(right.dev) &&
    hasPlatformIdentity(left.ino) &&
    hasPlatformIdentity(right.ino)
  );
}

export function sameNativeFileObject(
  left: NativeFileObjectIdentity,
  right: NativeFileObjectIdentity,
): boolean {
  const comparableDevice = hasPlatformIdentity(left.dev) && hasPlatformIdentity(right.dev);
  if (comparableDevice && left.dev !== right.dev) return false;

  const comparableInode = hasPlatformIdentity(left.ino) && hasPlatformIdentity(right.ino);
  if (comparableInode && left.ino !== right.ino) return false;

  if (comparableDevice && comparableInode) return true;
  return left.birthtime === right.birthtime;
}
