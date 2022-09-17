import generate from "@babel/generator";

const cache = new WeakMap();

export const assemble = ({types: t, template, options}) => {
  const timerFn = template(`
  let %%id%% = (function (isReturned, %%it%%){
    let { startAt, endAt } = this.state || {};
    if(isReturned && startAt && endAt) return %%it%%;
    if(!startAt) {
      startAt = Date.now();
      this.state.startAt = startAt;
      console.log('[timerStart]' + %%tag%%, { startAt });
      return %%it%%;
    }
    endAt = Date.now();
    const duration = endAt - startAt;
    console.log('[timerEnd]' + %%tag%%, { startAt, endAt, duration });
    Object.assign(this.state, { startAt: null, endAt: null });
    return %%it%%;
  }).bind({state: {}});
  `);
  const ensureTimerTag = (tag, path) => {
    let currentData;
    const tagStr = tag.value;
    const cacheKey = path.parentPath;
    if(!cache.has(cacheKey)) {
      cache.set(cacheKey, {});
    }
    const dataKey = `${tagStr}`;
    currentData = cache.get(cacheKey);
    if(!currentData[dataKey]) {
      const id = path.scope.generateUidIdentifier(`checkTimer`);
      const fnNode = timerFn({
        id,
        tag,
        it: t.identifier('it')
      });
      currentData[dataKey] = { id, fnNode };
      path.parentPath.get('body')[0].insertBefore(fnNode);
    }
    return currentData[dataKey].id;
  };

  return function assembleTimer (path) {
    const body = path.get('body');
    const fn = path.getFunctionParent();
    const name = fn.node.id ? `"${fn.node.id.name}" `: ' ';
    let tag = 'timer';

    if (body.isExpressionStatement()) {
      let condition = body.get('expression');
      let message;
      if (condition.isSequenceExpression()) {
        const expressions = condition.get('expressions');
        condition = expressions[0];
        message = expressions[1].node;
      }
      else {
        message = t.stringLiteral(`Function ${name}invariant failed: ${generate(condition.node).code}`);
      }
      tag = condition.node;
    }
    else {
      body.traverse({
        "VariableDeclaration|Function|AssignmentExpression|UpdateExpression|YieldExpression|ReturnStatement" (item) {
          throw path.buildCodeFrameError(`Timers cannot have side effects.`);
        },
        ExpressionStatement (statement) {
          let condition = statement.get('expression');
          let message;
          if (condition.isSequenceExpression()) {
            const expressions = condition.get('expressions');
            condition = expressions[0];
            message = expressions[1].node;
          }
          else {
            message = t.stringLiteral(`Function ${name}invariant failed: ${generate(condition.node).code}`);
          }
        }
      });
      tag = body.node;
    }

    const id = ensureTimerTag(tag, path);
    path.replaceWith(template(`%%id%%();`)({ id }));

    // update function
    const parent = path.findParent(t.isBlockStatement);
    const children = parent.get('body');
    parent.traverse({
      Function (path) {
        // This will be handled by the outer visitor, so skip it.
        path.skip();
      },
      ReturnStatement (statement) {
        statement.get('argument').replaceWith(template(`%%id%%(true, %%args%%);`)({ id, args: statement.node.argument }));
      }
    });
    // function without return statment
    const last = children[children.length - 1];
    if (!last.isReturnStatement()) {
      last.insertAfter(template(`%%id%%(true);`)({ id }));
    }
    return id;
  };
};

export const name = 'timer';

export const match = (ctx) => {
  return function matchPrecondition(label) {
    return label.node.name === name;
  }
};
