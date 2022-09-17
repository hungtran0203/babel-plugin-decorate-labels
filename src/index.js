import path from "path";
import glob from "glob";

const labelsRegex = /[./]label(\.c?js)?$/;
const testLabelsRegex = v => labelsRegex.test(v);

function importAllLabels(pattern) {
  const cwd = process.cwd();
  const searchDir = path.resolve(cwd, 'labels', pattern);
  const modules = [
    require('./labels/pre.label'),
    require('./labels/post.label'),
    require('./labels/assert.label'),
    require('./labels/invariant.label'),
    require('./labels/timer.label'),
  ];
  const moduleNames = {};
  modules.map(item => (moduleNames[item.name] = item));
  const files = glob.sync(searchDir);

  files.map(async (currentFile) => {
    const fileName = currentFile;
    const instance = require(fileName);
    if(!moduleNames[instance.name]) {
      modules.push({
        ...instance,
        fileName,
      });
      moduleNames[instance.name] = instance;
    }
  });

  return modules;
}

/**
 * # Design By Contract Transformer
 */
export default function (ctx) {
  const { types: t, template, options } = ctx;
  const labelTransformers = importAllLabels('**/*.label.js');
  let NAMES = {};
  labelTransformers.map(({ name }) => (NAMES[name] = name));

  return {
    name: 'contracts',
    visitor: {
      Program (path, { opts }) {
        if (opts.names !== undefined) {
          NAMES = Object.assign({}, NAMES, opts.names);
        }
        return path.traverse({
          Function (fn) {
            if (fn.isArrowFunctionExpression() && !fn.get('body').isBlockStatement()) {
              // Naked arrow functions cannot contain contracts.
              return;
            }
            fn.traverse({
              Function (path) {
                // This will be handled by the outer visitor, so skip it.
                path.skip();
              },

              LabeledStatement (path) {
                const label = path.get('label');
                if (opts.strip || (opts.env && opts.env[process.env.NODE_ENV] && opts.env[process.env.NODE_ENV].strip)) {
                  if (NAMES[label.node.name]) path.remove();
                  return;
                }

                for(const labelTransformer of labelTransformers) {
                  if(labelTransformer.name === label.node.name || (labelTransformer.match && labelTransformer.match(ctx)(label))) {
                    labelTransformer.assemble(ctx)(path);
                  }
                }
              }
            });
          },

          LabeledStatement (path) {
            const label = path.get('label');
            if (opts.strip || (opts.env && opts.env[process.env.NODE_ENV] && opts.env[process.env.NODE_ENV].strip)) {
              if (NAMES[label.node.name]) path.remove();
              return;
            }
            for(const labelTransformer of labelTransformers) {
              if(labelTransformer.name === label.node.name || (labelTransformer.match && labelTransformer.match(ctx)(label))) {
                labelTransformer.assemble(ctx)(path);
              }
            }
          }
        });
      }
    }
  }
}
