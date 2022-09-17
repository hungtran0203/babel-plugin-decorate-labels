import generate from "@babel/generator";

export const assemble = ({types: t, template, options}) => {
  const guard: (ids: {[key: string]: Node}) => Node = template(`
    if (!%%condition%%) throw new Error(%%message%%);
  `);

  const guardFn: (ids: {[key: string]: Node}) => Node = template(`
    const %%id%% = (%%it%%) => {
      %%conditions%%;
      return %%it%%;
    }
  `);

  function staticCheck (expression: NodePath): NodePath {
    const {confident, value} = expression.evaluate();
    if (confident && !value) {
      throw expression.buildCodeFrameError(`Contract always fails.`);
    }

    return expression.node;
  }
  return function assembleInvariant (path: NodePath): Identifier {
    const body: NodePath = path.get('body');
    const fn: NodePath = path.getFunctionParent();
    const name: string = fn.node.id ? `"${fn.node.id.name}" `: ' ';
    const conditions: Node[] = [];

    if (body.isExpressionStatement()) {
      let condition: NodePath = body.get('expression');
      let message: ?Node;
      if (condition.isSequenceExpression()) {
        const expressions = condition.get('expressions');
        condition = expressions[0];
        message = expressions[1].node;
      }
      else {
        message = t.stringLiteral(`Function ${name}invariant failed: ${generate(condition.node).code}`);
      }
      conditions.push(guard({
        condition: staticCheck(condition),
        message
      }));
    }
    else {
      body.traverse({
        "VariableDeclaration|Function|AssignmentExpression|UpdateExpression|YieldExpression|ReturnStatement" (item: NodePath): void {
          throw path.buildCodeFrameError(`Invariants cannot have side effects.`);
        },
        ExpressionStatement (statement: NodePath): void {
          let condition: NodePath = statement.get('expression');
          let message: ?Node;
          if (condition.isSequenceExpression()) {
            const expressions = condition.get('expressions');
            condition = expressions[0];
            message = expressions[1].node;
          }
          else {
            message = t.stringLiteral(`Function ${name}invariant failed: ${generate(condition.node).code}`);
          }
          statement.replaceWith(guard({
            condition: staticCheck(condition),
            message
          }));
        }
      });
      conditions.push(...body.node.body);
    }

    const id = path.scope.generateUidIdentifier(`${fn.node.id ? fn.node.id.name : 'check'}Invariant`);
    path.parentPath.get('body')[0].insertBefore(guardFn({
      id,
      conditions,
      it: t.identifier('it')
    }));
    path.remove();

    // update function
    const parent = path.findParent(t.isBlockStatement);
    const children = parent.get('body');
    const first: NodePath = children[0];
    first.insertAfter(t.expressionStatement(t.callExpression(id, [])))
    parent.traverse({
      Function (path: NodePath): void {
        // This will be handled by the outer visitor, so skip it.
        path.skip();
      },
      ReturnStatement (statement: NodePath): void {
        statement.get('argument').replaceWith(t.callExpression(id, [statement.node.argument]));
      }
    });
    // function without return statment
    const last: NodePath = children[children.length - 1];
    if (!last.isReturnStatement()) {
      last.insertAfter(t.expressionStatement(t.callExpression(id, [])));
    }
    return id;
  };
};

export const name = 'invariant';

export const match = (ctx) => {
  return function matchPrecondition(label) {
    return label.node.name === name;
  }
};
