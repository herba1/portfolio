// Lets Node run the app's extensionless ESM imports (`./model`) as-is.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if ((specifier.startsWith(".") || specifier.startsWith("/")) && !/\.[cm]?js$/.test(specifier)) {
      for (const ext of [".js", "/index.js"]) {
        try {
          return await next(specifier + ext, context);
        } catch {}
      }
    }
    throw err;
  }
}
