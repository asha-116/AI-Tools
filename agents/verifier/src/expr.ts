// A tiny, safe arithmetic evaluator for the verifier model's answers.
//
// Language models pick the right formula far more reliably than they do long arithmetic such as
// (1 + r)^360, so the model answers each field with an expression and we evaluate it exactly.
// Grammar: numbers, + - * / ^ (right-associative), parentheses, unary +/-, round(x[, digits]),
// ln(x) and ceil(x).
// Nothing else is accepted: no identifiers, no property access, no code.

const MAX_LENGTH = 2000;

type Fn = 'round' | 'ln' | 'ceil';
type Token =
  { kind: 'num'; value: number } | { kind: 'op'; value: string } | { kind: 'fn'; name: Fn };

function tokenize(src: string): Token[] {
  const text = src
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/\*\*/g, '^')
    .replace(/(\d),(\d)/g, '$1$2');
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (num) {
      out.push({ kind: 'num', value: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const fn = /^(round|ln|ceil)\b/.exec(text.slice(i));
    if (fn) {
      out.push({ kind: 'fn', name: fn[1] as Fn });
      i += fn[0].length;
      continue;
    }
    if ('+-*/^(),'.includes(ch)) {
      out.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(`unexpected "${ch}" at position ${String(i)}`);
  }
  return out;
}

/** Evaluate an arithmetic expression; throws on anything outside the grammar or a non-finite result. */
export function evaluate(expression: string): number {
  if (expression.length > MAX_LENGTH) throw new Error('expression too long');
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t?.kind === 'op' && t.value === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new Error(`expected "${v}"`);
    pos++;
  };

  const primary = (): number => {
    const t = peek();
    if (!t) throw new Error('unexpected end of expression');
    if (t.kind === 'num') {
      pos++;
      return t.value;
    }
    if (t.kind === 'fn') {
      pos++;
      expect('(');
      const x = sum();
      if (t.name === 'ln') {
        expect(')');
        if (!(x > 0)) throw new Error('ln needs a positive number');
        return Math.log(x);
      }
      if (t.name === 'ceil') {
        expect(')');
        return Math.ceil(x);
      }
      let digits = 0;
      if (isOp(',')) {
        pos++;
        digits = sum();
      }
      expect(')');
      if (!Number.isInteger(digits) || digits < 0 || digits > 12)
        throw new Error('bad round digits');
      const f = 10 ** digits;
      return Math.round(x * f) / f;
    }
    if (isOp('(')) {
      pos++;
      const x = sum();
      expect(')');
      return x;
    }
    throw new Error(`unexpected "${t.value}"`);
  };
  const unary = (): number => {
    if (isOp('-')) {
      pos++;
      return -unary();
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (isOp('^')) {
      pos++;
      return base ** unary();
    }
    return base;
  };
  const product = (): number => {
    let x = unary();
    while (isOp('*') || isOp('/')) {
      const op = (peek() as { value: string }).value;
      pos++;
      const y = unary();
      x = op === '*' ? x * y : x / y;
    }
    return x;
  };
  const sum = (): number => {
    let x = product();
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { value: string }).value;
      pos++;
      const y = product();
      x = op === '+' ? x + y : x - y;
    }
    return x;
  };

  const value = sum();
  if (pos !== tokens.length) throw new Error('unexpected text after the expression');
  if (!Number.isFinite(value)) throw new Error('result is not a finite number');
  return value;
}
