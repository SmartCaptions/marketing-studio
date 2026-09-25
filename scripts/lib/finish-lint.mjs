/**
 * scripts/lib/finish-lint.mjs — refuses visuals that show words not declared in words.json.
 *
 * Every word a finished video shows must pass the factory's promise guard, which reads
 * words.json. So text written straight into the JSX — as JSX text, or as a string or template
 * literal placed as a child — is refused with the file and line, and the session moves it into
 * words.json and shows it through <T k="…"/> or useWord().
 */
import {readdirSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join, relative} from 'node:path';

const HAS_TEXT = /[\p{L}\p{N}]/u;

const sourceFiles = (dir) =>
  readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts|jsx|js)$/.test(entry.name) ? [full] : [];
  });

/**
 * @param {string} srcDir the work directory's src/
 * @param {string} studioDir marketing-studio's studio/ (for its TypeScript)
 * @returns {string[]} one message per literal shown on screen
 */
export const findLiteralText = (srcDir, studioDir) => {
  const ts = createRequire(join(studioDir, 'package.json'))('typescript');
  const problems = [];
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const where = (node) => `${relative(srcDir, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    // A literal reaching a JSX child through ?:, &&, || or parentheses is shown on screen
    const shownLiterals = (expr) => {
      if (!expr) return [];
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return [expr];
      if (ts.isTemplateExpression(expr)) return [expr.head, ...expr.templateSpans.map((s) => s.literal)];
      if (ts.isParenthesizedExpression(expr)) return shownLiterals(expr.expression);
      if (ts.isConditionalExpression(expr)) return [...shownLiterals(expr.whenTrue), ...shownLiterals(expr.whenFalse)];
      if (ts.isBinaryExpression(expr)) return [...shownLiterals(expr.left), ...shownLiterals(expr.right)];
      return [];
    };
    const visit = (node) => {
      if (ts.isJsxText(node) && HAS_TEXT.test(node.text)) {
        problems.push(`${where(node)}: text "${node.text.trim().slice(0, 40)}" is written in the JSX`);
      }
      if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        for (const lit of shownLiterals(node.expression)) {
          if (HAS_TEXT.test(lit.text)) problems.push(`${where(lit)}: text "${lit.text.slice(0, 40)}" is written in the JSX`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return problems;
};
