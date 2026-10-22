module.exports = async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  console.log(`${ctx.updateType} from ${ctx.from?.id} handled in ${Date.now() - startedAt}ms`);
};
