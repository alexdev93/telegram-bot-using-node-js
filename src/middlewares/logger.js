// Logs timing only; user ids are personal data and aren't needed here
module.exports = async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  console.log(`${ctx.updateType} handled in ${Date.now() - startedAt}ms`);
};
