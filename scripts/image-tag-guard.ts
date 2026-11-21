export function shouldRefuseLatest(
  cmd: string,
  imageTag: string,
  branch: string,
): boolean {
  return cmd === "publish" && imageTag === "latest" && branch !== "main";
}

export function missingImageTag(tag: string | undefined): boolean {
  return !tag;
}
