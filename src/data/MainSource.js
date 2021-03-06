import semver from "semver";
import DocsSource from "./DocsSource";

const branchBlacklist = new Set(["docs", "v3-dev"]);
export default new DocsSource({
  id: "DisTube",
  name: "DisTube",
  repo: "skick1234/DisTube",
  global: "DisTube",
  defaultTag: "v2",
  branchFilter: branch => !branchBlacklist.has(branch) && !branch.startsWith("dependabot/"),
  tagFilter: tag => semver.gte(tag, "3.0.0") || semver.gte(tag, "3.0.0-0"),
  defaultClass: "DisTube",
});
