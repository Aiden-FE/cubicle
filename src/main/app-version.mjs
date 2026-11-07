/**
 * 关于页的版本读取 (ticket 13: 关于页显示版本号，打包 metadata 与 package.json 一致).
 *
 * app.getVersion() 是权威（打包后 = exe metadata；dev 下 = package.json
 * version）。主进程顺手对表 rootDir/package.json：不一致要在证据里说
 * 出来（electron-builder 若改写了 metadata，漂移不该被表演成一致）。
 * seam 是纯函数：node:test 钉语义，e2e-13 现场对三方（磁盘 package.json /
 * app.getVersion() / 关于页 DOM）。
 */

/**
 * @param {string} jsonText package.json 的原始文本
 * @returns {string | null} version 字段；读不懂就 null（诚实，不装懂）
 */
export function readPackageVersion(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    const version = parsed && typeof parsed === "object" ? parsed.version : undefined;
    return typeof version === "string" && version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ appVersion: string | null | undefined, packageVersion: string | null }} input
 * @returns {{ version: string, versionSource: "app" | "package" | "fallback", mismatch: boolean }}
 */
export function resolveAboutVersion({ appVersion, packageVersion }) {
  if (typeof appVersion === "string" && appVersion.length > 0) {
    return {
      version: appVersion,
      versionSource: "app",
      // 未知（packageVersion=null）≠ 不一致：没有对家就不报漂移。
      mismatch: packageVersion !== null && packageVersion !== appVersion,
    };
  }
  if (typeof packageVersion === "string" && packageVersion.length > 0) {
    return { version: packageVersion, versionSource: "package", mismatch: false };
  }
  return { version: "0.0.0-dev", versionSource: "fallback", mismatch: false };
}
