import generate from "@babel/generator";

export const assemble = ({types: t, template, options}) => {
  const guard = template(`
    if (!%%condition%%) throw new Error(%%message%%);
  `);
  function staticCheck (expression) {
    const {confident, value} = expression.evaluate();
    if (confident && !value) {
      throw expression.buildCodeFrameError(`Contract always fails.`);
    }

    return expression.node;
  }
  return function assembleAssertion (path) {
    const body = path.get('body');
    const fn = path.getFunctionParent();
    const name = fn && fn.node && fn.node.id ? `"${fn.node.id.name}"` : '';
    if (body.isExpressionStatement()) {
      let condition = body.get('expression');
      let message;
      if (condition.isSequenceExpression()) {
        const expressions = condition.get('expressions');
        condition = expressions[0];
        message = expressions[1].node;
      }
      else if (name) {
        message = t.stringLiteral(`Function ${name} assertion failed: ${generate(condition.node).code}`);
      }
      else {
        message = t.stringLiteral(`Assertion failed: ${generate(condition.node).code}`);
      }
      path.replaceWith(guard({
        condition: staticCheck(condition),
        message
      }));
      return;
    }

    body.traverse({
      "VariableDeclaration|Function|AssignmentExpression|UpdateExpression|YieldExpression|ReturnStatement" (item): void {
        throw path.buildCodeFrameError(`Assertions cannot have side effects.`);
      },
      ExpressionStatement (statement) {
        let condition = statement.get('expression');
        let message;
        if (condition.isSequenceExpression()) {
          const expressions = condition.get('expressions');
          condition = expressions[0];
          message = expressions[1].node;
        }
        else if (name) {
          message = t.stringLiteral(`Function ${name} assertion failed: ${generate(condition.node).code}`);
        }
        else {
          message = t.stringLiteral(`Assertion failed: ${generate(condition.node).code}`);
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
  };
};


export const name = 'assert';

export const match = (ctx) => {
  return function matchAssert(label) {
    return label.node.name === name;
  }
};
