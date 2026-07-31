export const disablePageAgentScriptExecution = () => ({
  name: 'disable-page-agent-script-execution',
  transform(code, id) {
    if (id.includes('/zod/v4/core/util.js') || id.includes('\\zod\\v4\\core\\util.js')) {
      const evalProbe = 'const F = Function;\n        new F("");\n        return true;';
      if (!code.includes(evalProbe)) {
        throw new Error('Pinned Zod eval probe changed; review before building.');
      }
      return code.replace(evalProbe, 'return false;');
    }

    if (!id.includes('@page-agent/page-controller/dist/lib/page-controller.js')) {
      return null;
    }

    const evalBlock = 'const asyncFunction = eval(`(async (signal) => { ${script} })`);\n\t\t\tconst result = await asyncFunction(signal);';
    if (!code.includes(evalBlock)) {
      throw new Error('Pinned page-controller script execution block changed; review before building.');
    }

    return code.replace(
      evalBlock,
      "throw new Error('JavaScript execution is disabled by Aid policy.');"
    );
  },
});
