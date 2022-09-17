import generate from "@babel/generator";

export const assemble = ({types: t, template, options}) => {
  const guard: (ids: {[key: string]: Node}) => Node = template(`
    if (!%%condition%%) throw new Error(%%message%%);
  `);
  function staticCheck (expression: NodePath): NodePath {
    const {confident, value} = expression.evaluate();
    if (confident && !value) {
      throw expression.buildCodeFrameError(`Contract always fails.`);
    }

    return expression.node;
  }

  return function assemblePrecondition(path) {
    const body = path.get('body');
    const fn = path.getFunctionParent();
    const name = fn.node.id ? `"${fn.node.id.name}" `: ' ';
    if (body.isExpressionStatement()) {
      let condition = body.get('expression');
      let message;
      if (condition.isSequenceExpression()) {
        const expressions = condition.get('expressions');
        condition = expressions[0];
        message = expressions[1].node;
      }
      else {
        message = t.stringLiteral(`Function ${name}precondition failed: ${generate(condition.node).code}`);
      }
      path.replaceWith(guard({
        condition: staticCheck(condition),
        message
      }));
      return;
    }

    body.traverse({
      "VariableDeclaration|Function|AssignmentExpression|UpdateExpression|YieldExpression|ReturnStatement" (item: NodePath): void {
        throw path.buildCodeFrameError(`Preconditions cannot have side effects.`);
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
          message = t.stringLiteral(`Function ${name}precondition failed: ${generate(condition.node).code}`);
        }
        statement.replaceWith(guard({
          condition: staticCheck(condition),
          message
        }));
      }
    });

    if (body.isBlockStatement()) {
      path.replaceWithMultiple(path.get('body').node.body);
    }
    else {
      path.replaceWith(path.get('body'));
    }
  }
}

export const name = 'pre';

export const match = (ctx) => {
  return function matchPrecondition(label) {
    return label.node.name === name;
  }
};
