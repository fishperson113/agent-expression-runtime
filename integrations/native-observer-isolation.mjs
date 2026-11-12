const record = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function observerServers(config) {
  const servers = config?.mcp_servers === undefined ? {} : config.mcp_servers;
  if (!record(servers) || Object.keys(servers).length > 100 || Object.entries(servers).some(([name, value]) =>
    !/^[A-Za-z0-9_-]{1,64}$/.test(name) || !record(value))) throw Error('native_reaction_mcp_config_unverified');
  return Object.keys(servers);
}
export function observerServerArgs(names) {
  if (!Array.isArray(names) || names.length > 100 || names.some(name => !/^[A-Za-z0-9_-]{1,64}$/.test(name))) throw Error('native_reaction_mcp_config_unverified');
  return names.flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
}
export function verifyObserverServers(config, expected) {
  const actual = observerServers(config);
  if (actual.length !== expected.length || actual.some(name => !expected.includes(name) || config.mcp_servers[name].enabled !== false))
    throw Error('native_reaction_mcp_config_unverified');
}
export function emptyObserverCapabilities(catalog, disabledNames) {
  if (!Array.isArray(catalog?.data) || catalog.nextCursor != null || catalog.data.length > disabledNames.length) return false;
  const seen = new Set();
  return catalog.data.every(row => {
    if (!record(row) || !disabledNames.includes(row.name) || seen.has(row.name)) return false;
    seen.add(row.name);
    return record(row.tools) && Object.keys(row.tools).length === 0 &&
      Array.isArray(row.resources) && row.resources.length === 0 &&
      Array.isArray(row.resourceTemplates) && row.resourceTemplates.length === 0;
  });
}
