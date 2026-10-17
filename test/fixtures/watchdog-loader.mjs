let targetUrl, replacementUrl;
export function initialize(data) {
  ({ targetUrl, replacementUrl } = data);
}
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  return resolved.url === targetUrl ? { url: replacementUrl, shortCircuit: true } : resolved;
}
