// Node ESM loader hook for Vite-style `?url` assets used by smoke tests.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?url')) {
    const bare = specifier.slice(0, -4);
    const resolved = await nextResolve(bare, context);
    return { url: `${resolved.url}?sq-url-stub=1`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('?sq-url-stub=1')) {
    const clean = url.slice(0, -14);
    return { format: 'module', source: `export default ${JSON.stringify(clean)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
