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
  return function assemblePostcondition (path: NodePath): Identifier {
    const body: NodePath = path.get('body');
    const fn: NodePath = path.getFunctionParent();
    const name: string = fn.node.id ? `"${fn.node.id.name}" `: ' ';
    const conditions: Node[] = [];
    const captures: Node[] = [];

    if (body.isExpressionStatement()) {
      let condition: NodePath = body.get('expression');
      let message: ?Node;
      if (condition.isSequenceExpression()) {
        const expressions = condition.get('expressions');
        condition = expressions[0];
        message = expressions[1].node;
      }
      else {
        message = t.stringLiteral(`Function ${name}postcondition failed: ${generate(condition.node).code}`);
      }
      conditions.push(guard({
        condition: staticCheck(condition),
        message
      }));
    }
    else {
      body.traverse({
        "VariableDeclaration|Function|AssignmentExpression|UpdateExpression|YieldExpression|ReturnStatement" (item: NodePath): void {
          throw path.buildCodeFrameError(`Postconditions cannot have side effects.`);
        },
        CallExpression (call: NodePath): void {
          const callee: NodePath = call.get('callee');
          const args: NodePath[] = call.get('arguments');
          if (!callee.isIdentifier() || callee.node.name !== 'old' || call.scope.hasBinding('old') || args.length === 0) {
            return;
          }
          const argument: NodePath = args[0];
          const id = call.scope.generateUidIdentifierBasedOnNode(argument.node);
          fn.scope.push({id, init: argument.node, kind: 'const'});
          call.replaceWith(id);
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
            message = t.stringLiteral(`Function ${name}postcondition failed: ${generate(condition.node).code}`);
          }
          statement.replaceWith(guard({
            condition: staticCheck(condition),
            message
          }));
        }
      });
      conditions.push(...body.node.body);
    }

    const id = path.scope.generateUidIdentifier(`${fn.node.id ? fn.node.id.name : 'check'}Postcondition`);

    fn.get('body').get('body')[0].insertBefore(guardFn({
      id,
      conditions,
      it: t.identifier('it')
    }));

    path.remove();

    // update function
    const children = fn.get('body').get('body');
    const parent = fn;
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
  }
};

export const name = 'post';

export const match = (ctx) => {
  return function matchPrecondition(label) {
    return label.node.name === name;
  }
};
