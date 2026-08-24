/**
 * generators.js
 * ---------------------------------------------------------------------
 * Dynamic question generators.
 *
 * For chapters where correctness can be GUARANTEED by computation
 * (arithmetic, fractions, decimals, angle rules, spreadsheet formulas)
 * we generate fresh randomised questions on every quiz build instead of
 * replaying the same handful of entries from data/questions.json. That
 * removes the repetition problem for those chapters entirely.
 *
 * Chapters that depend on textbook prose (Science, SST, English, Hindi,
 * German) are deliberately NOT generated - a generator cannot invent
 * verifiable chapter facts. Those keep using the static bank.
 *
 * Contract for every generator function:
 *   fn() -> { question, options: string[4], answer: 0..3,
 *             explanation, difficulty, tags[] }  |  null
 * Returning null means "that random draw was degenerate, try again";
 * the batch builder simply draws once more. The wrapper below stamps
 * id/subject/chapter/type onto whatever a generator returns.
 *
 * All arithmetic is done on INTEGERS (decimals are carried as scaled
 * integers and only turned into text at print time) so floating-point
 * noise can never make a generated answer wrong.
 * ---------------------------------------------------------------------
 */

/* -------------------------------- helpers -------------------------------- */

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shuffled(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function gcd(a, b) {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function lcm(a, b) {
  return Math.abs(a * b) / gcd(a, b);
}

/** All divisors of a positive integer, ascending. */
function divisors(n) {
  const out = [];
  for (let i = 1; i <= n; i++) if (n % i === 0) out.push(i);
  return out;
}

/**
 * Build a 4-option MCQ from one correct answer plus candidate distractors.
 *
 * Distractors are de-duplicated and any that collide with the correct
 * answer are dropped. If that leaves fewer than three, `nudge(i)` is asked
 * for extra near-miss values until the set is full - so a generator can
 * never emit a question with a repeated or missing option. Returns null if
 * even that fails, which tells the caller to redraw.
 */
function makeOptions(correct, candidates, nudge) {
  const correctStr = String(correct);
  const seen = new Set([correctStr]);
  const distractors = [];

  for (const c of candidates) {
    if (distractors.length === 3) break;
    if (c === null || c === undefined) continue;
    const s = String(c);
    if (seen.has(s)) continue;
    seen.add(s);
    distractors.push(s);
  }

  // Top up with near-miss values if the caller's list was too thin.
  for (let i = 1; distractors.length < 3 && i <= 200; i++) {
    for (const v of nudge ? nudge(i) : []) {
      if (distractors.length === 3) break;
      if (v === null || v === undefined) continue;
      const s = String(v);
      if (seen.has(s)) continue;
      seen.add(s);
      distractors.push(s);
    }
  }
  if (distractors.length < 3) return null;

  const options = shuffled([correctStr, ...distractors]);
  return { options, answer: options.indexOf(correctStr) };
}

/** Near-miss generator suitable for most integer answers. */
function numericNudge(correct) {
  return (i) => [Number(correct) + i, Number(correct) - i, Number(correct) + 10 * i];
}

/* -------------------- family: hcf-lcm-factors ----------------------------- */

function genHCF() {
  const g = randInt(2, 12);
  const a = g * randInt(2, 9);
  const b = g * randInt(2, 9);
  if (a === b) return null;
  const correct = gcd(a, b);
  const opts = makeOptions(
    correct,
    shuffled([lcm(a, b), correct * 2, Math.max(1, Math.floor(correct / 2)), Math.abs(a - b), correct + 1]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `What is the HCF of ${a} and ${b}?`,
    ...opts,
    explanation: `The common factors of ${a} and ${b} are ${divisors(correct).join(", ")}. The highest of these is ${correct}, so HCF(${a}, ${b}) = ${correct}.`,
    difficulty: "medium",
    tags: ["hcf", "factors"],
  };
}

function genLCM() {
  const a = randInt(3, 18);
  const b = randInt(3, 18);
  if (a === b) return null;
  const correct = lcm(a, b);
  const opts = makeOptions(
    correct,
    shuffled([a * b, gcd(a, b), correct * 2, correct + a, correct - b]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `What is the LCM of ${a} and ${b}?`,
    ...opts,
    explanation: `HCF(${a}, ${b}) = ${gcd(a, b)}, and LCM = (${a} × ${b}) ÷ HCF = ${a * b} ÷ ${gcd(a, b)} = ${correct}.`,
    difficulty: "medium",
    tags: ["lcm", "multiples"],
  };
}

function genIsFactor() {
  const n = randInt(20, 96);
  const divs = divisors(n).filter((d) => d !== 1 && d !== n);
  if (!divs.length) return null;
  const correct = pick(divs);
  const nonFactors = [];
  for (let i = 2; i < n && nonFactors.length < 10; i++) if (n % i !== 0) nonFactors.push(i);
  const opts = makeOptions(correct, shuffled(nonFactors), (i) => (n % (correct + i) !== 0 ? [correct + i] : []));
  if (!opts) return null;
  return {
    question: `Which of these numbers is a factor of ${n}?`,
    ...opts,
    explanation: `${n} ÷ ${correct} = ${n / correct} with no remainder, so ${correct} is a factor of ${n}. Each of the other choices leaves a remainder.`,
    difficulty: "easy",
    tags: ["factors", "divisibility"],
  };
}

function genSmallestDivisibleBy() {
  const a = randInt(4, 15);
  const b = randInt(4, 15);
  if (a === b) return null;
  const correct = lcm(a, b);
  const opts = makeOptions(
    correct,
    shuffled([a * b, gcd(a, b), a + b, correct + a, Math.floor(correct / 2)]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `What is the smallest number that is divisible by both ${a} and ${b}?`,
    ...opts,
    explanation: `The smallest number divisible by both is their LCM. LCM(${a}, ${b}) = ${correct}, and indeed ${correct} ÷ ${a} = ${correct / a} and ${correct} ÷ ${b} = ${correct / b}.`,
    difficulty: "medium",
    tags: ["lcm", "word-problem"],
  };
}

function genFactorCount() {
  const n = randInt(12, 72);
  const all = divisors(n);
  const correct = all.length;
  const opts = makeOptions(correct, shuffled([correct + 1, correct - 1, correct + 2, correct * 2]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `How many factors does ${n} have altogether?`,
    ...opts,
    explanation: `The factors of ${n} are ${all.join(", ")} — that is ${correct} factors in total.`,
    difficulty: "hard",
    tags: ["factors", "counting"],
  };
}

function genHCFThree() {
  const g = randInt(2, 9);
  const a = g * randInt(2, 7);
  const b = g * randInt(2, 7);
  const c = g * randInt(2, 7);
  if (a === b || b === c || a === c) return null;
  const correct = gcd(gcd(a, b), c);
  const opts = makeOptions(
    correct,
    shuffled([correct * 2, correct + 1, gcd(a, b), Math.max(1, correct - 1)]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `What is the HCF of ${a}, ${b} and ${c}?`,
    ...opts,
    explanation: `Take the HCF two at a time: HCF(${a}, ${b}) = ${gcd(a, b)}, then HCF(${gcd(a, b)}, ${c}) = ${correct}.`,
    difficulty: "hard",
    tags: ["hcf", "factors"],
  };
}

/* -------------------- family: integer-operations -------------------------- */

/** Wrap negatives in brackets the way a textbook writes them. */
function signed(n) {
  return n < 0 ? `(${n})` : `${n}`;
}

function genIntegerAdd() {
  const a = randInt(-40, 40);
  const b = randInt(-40, 40);
  if (a === 0 || b === 0) return null;
  const correct = a + b;
  const opts = makeOptions(correct, shuffled([a - b, b - a, -(a + b), Math.abs(a) + Math.abs(b)]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Calculate: ${signed(a)} + ${signed(b)}`,
    ...opts,
    explanation:
      a < 0 === b < 0
        ? `Both numbers have the same sign, so add their values and keep that sign: ${Math.abs(a)} + ${Math.abs(b)} = ${Math.abs(a) + Math.abs(b)}, giving ${correct}.`
        : `The signs are different, so subtract the smaller value from the larger and keep the sign of the larger: ${correct}.`,
    difficulty: "easy",
    tags: ["integers", "addition"],
  };
}

function genIntegerSubtract() {
  const a = randInt(-40, 40);
  const b = randInt(-40, 40);
  if (b === 0) return null;
  const correct = a - b;
  const opts = makeOptions(correct, shuffled([a + b, b - a, -(a - b), Math.abs(a - b)]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Calculate: ${signed(a)} − ${signed(b)}`,
    ...opts,
    explanation: `Subtracting is the same as adding the opposite: ${signed(a)} − ${signed(b)} = ${signed(a)} + ${signed(-b)} = ${correct}.`,
    difficulty: "medium",
    tags: ["integers", "subtraction"],
  };
}

function genIntegerMultiply() {
  const a = randInt(-12, 12);
  const b = randInt(-12, 12);
  if (Math.abs(a) <= 1 || Math.abs(b) <= 1) return null;
  const correct = a * b;
  const sameSign = a < 0 === b < 0;
  const opts = makeOptions(correct, shuffled([-correct, a + b, correct + a, correct - b]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Calculate: ${signed(a)} × ${signed(b)}`,
    ...opts,
    explanation: `${Math.abs(a)} × ${Math.abs(b)} = ${Math.abs(correct)}. The two signs are ${sameSign ? "the same, so the product is positive" : "different, so the product is negative"}: ${correct}.`,
    difficulty: "medium",
    tags: ["integers", "multiplication"],
  };
}

function genIntegerDivide() {
  const q = randInt(-12, 12);
  const b = randInt(-12, 12);
  if (q === 0 || Math.abs(b) <= 1) return null;
  const a = q * b; // exact by construction
  const correct = q;
  const sameSign = a < 0 === b < 0;
  const opts = makeOptions(correct, shuffled([-correct, a - b, correct + 1, correct - 1]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Calculate: ${signed(a)} ÷ ${signed(b)}`,
    ...opts,
    explanation: `${Math.abs(a)} ÷ ${Math.abs(b)} = ${Math.abs(correct)}. The two signs are ${sameSign ? "the same, so the answer is positive" : "different, so the answer is negative"}: ${correct}.`,
    difficulty: "medium",
    tags: ["integers", "division"],
  };
}

function genIntegerThreeTerm() {
  const a = randInt(-25, 25);
  const b = randInt(-25, 25);
  const c = randInt(-25, 25);
  if (b === 0 || c === 0) return null;
  const correct = a + b - c;
  const opts = makeOptions(correct, shuffled([a + b + c, a - b - c, a - b + c, -correct]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Calculate: ${signed(a)} + ${signed(b)} − ${signed(c)}`,
    ...opts,
    explanation: `Work left to right: ${signed(a)} + ${signed(b)} = ${a + b}. Then ${a + b} − ${signed(c)} = ${correct}.`,
    difficulty: "hard",
    tags: ["integers", "multi-step"],
  };
}

function genIntegerNumberLine() {
  const a = randInt(-30, 30);
  const which = pick(["predecessor", "successor"]);
  const correct = which === "successor" ? a + 1 : a - 1;
  const opts = makeOptions(correct, shuffled([which === "successor" ? a - 1 : a + 1, -a, a, correct + 2]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `What is the ${which} of ${a} on the number line?`,
    ...opts,
    explanation: `The ${which} is the integer immediately to the ${which === "successor" ? "right" : "left"} of ${a} on the number line, which is ${correct}.`,
    difficulty: "easy",
    tags: ["integers", "number-line"],
  };
}

/* -------------------- family: arithmetic-expressions ---------------------- */

function genBodmasAddMul() {
  const a = randInt(2, 20);
  const b = randInt(2, 12);
  const c = randInt(2, 12);
  const correct = a + b * c;
  const wrong = (a + b) * c;
  const opts = makeOptions(correct, shuffled([wrong, a * b + c, a + b + c, correct + c]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Simplify: ${a} + ${b} × ${c}`,
    ...opts,
    explanation: `BODMAS puts multiplication before addition: ${b} × ${c} = ${b * c}, then ${a} + ${b * c} = ${correct}. (Adding first would wrongly give ${wrong}.)`,
    difficulty: "easy",
    tags: ["bodmas", "order-of-operations"],
  };
}

function genBodmasBrackets() {
  const a = randInt(2, 20);
  const b = randInt(2, 15);
  const c = randInt(2, 9);
  const correct = (a + b) * c;
  const wrong = a + b * c;
  const opts = makeOptions(correct, shuffled([wrong, (a - b) * c, a + b + c, correct - c]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Simplify: (${a} + ${b}) × ${c}`,
    ...opts,
    explanation: `Brackets come first: ${a} + ${b} = ${a + b}. Then ${a + b} × ${c} = ${correct}. (Ignoring the brackets would give ${wrong}.)`,
    difficulty: "easy",
    tags: ["bodmas", "brackets"],
  };
}

function genBodmasDivideMul() {
  const c = randInt(2, 9);
  const q = randInt(2, 12);
  const d = q * c; // guarantees an exact division
  const a = randInt(2, 12);
  const b = randInt(2, 12);
  const correct = a * b - q;
  const opts = makeOptions(correct, shuffled([a * (b - q), a * b - d, a * b + q, correct + q]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Simplify: ${a} × ${b} − ${d} ÷ ${c}`,
    ...opts,
    explanation: `Do × and ÷ before −: ${a} × ${b} = ${a * b} and ${d} ÷ ${c} = ${q}. Then ${a * b} − ${q} = ${correct}.`,
    difficulty: "medium",
    tags: ["bodmas", "order-of-operations"],
  };
}

function genBodmasFourTerm() {
  const a = randInt(3, 20);
  const b = randInt(2, 10);
  const c = randInt(2, 10);
  const d = randInt(2, 10);
  const correct = a - b + c * d;
  const opts = makeOptions(correct, shuffled([(a - b + c) * d, a - (b + c * d), a - b + c + d, correct - c]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Simplify: ${a} − ${b} + ${c} × ${d}`,
    ...opts,
    explanation: `Multiplication first: ${c} × ${d} = ${c * d}. Then work left to right: ${a} − ${b} = ${a - b}, and ${a - b} + ${c * d} = ${correct}.`,
    difficulty: "medium",
    tags: ["bodmas", "multi-step"],
  };
}

function genBodmasNested() {
  const a = randInt(2, 12);
  const b = randInt(2, 12);
  const c = randInt(2, 9);
  const d = randInt(2, 9);
  const correct = a * (b + c) - d;
  const opts = makeOptions(correct, shuffled([a * b + c - d, a * (b + c - d), a * (b + c) + d, correct + d]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Simplify: ${a} × (${b} + ${c}) − ${d}`,
    ...opts,
    explanation: `Brackets first: ${b} + ${c} = ${b + c}. Then ${a} × ${b + c} = ${a * (b + c)}, and finally ${a * (b + c)} − ${d} = ${correct}.`,
    difficulty: "hard",
    tags: ["bodmas", "brackets"],
  };
}

function genBodmasMissingBracket() {
  const a = randInt(2, 12);
  const b = randInt(2, 12);
  const c = randInt(2, 9);
  const target = (a + b) * c;
  // The distractors must all evaluate to something *other* than the target,
  // otherwise the question would have two correct answers.
  const alternatives = [
    { text: `${a} + ${b} × ${c}`, value: a + b * c },
    { text: `${a} × (${b} + ${c})`, value: a * (b + c) },
    { text: `${a} + (${b} × ${c})`, value: a + b * c },
    { text: `(${a} × ${b}) + ${c}`, value: a * b + c },
    { text: `${a} × ${b} + ${b} × ${c}`, value: a * b + b * c },
  ].filter((alt) => alt.value !== target);
  const opts = makeOptions(`(${a} + ${b}) × ${c}`, shuffled(alternatives).map((alt) => alt.text), () => []);
  if (!opts) return null;
  return {
    question: `Which expression has the value ${target}?`,
    ...opts,
    explanation: `(${a} + ${b}) × ${c} = ${a + b} × ${c} = ${target}. Without the brackets, ${a} + ${b} × ${c} would give ${a + b * c} instead, because BODMAS does the multiplication first.`,
    difficulty: "hard",
    tags: ["bodmas", "brackets"],
  };
}

/* -------------------- family: fractions ----------------------------------- */

/** Reduce n/d and render it as an integer or an "n/d" string. */
function fracText(n, d) {
  if (d === 0) return "undefined";
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1;
  const rn = n / g;
  const rd = d / g;
  return rd === 1 ? `${rn}` : `${rn}/${rd}`;
}

/** Near-miss fractions built by tweaking the numerator or denominator. */
function fracNudge(n, d) {
  return (i) => [fracText(n + i, d), fracText(n - i, d), fracText(n, d + i)];
}

function genFractionAdd() {
  const b = randInt(2, 12);
  const d = randInt(2, 12);
  if (b === d) return null;
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const n = a * d + c * b;
  const den = b * d;
  const correct = fracText(n, den);
  const opts = makeOptions(
    correct,
    shuffled([fracText(a + c, b + d), fracText(a * d - c * b, den), fracText(a + c, den), fracText(n + 1, den)]),
    fracNudge(n, den)
  );
  if (!opts) return null;
  return {
    question: `Add: ${a}/${b} + ${c}/${d}`,
    ...opts,
    explanation: `Use the common denominator ${den}: ${a}/${b} = ${a * d}/${den} and ${c}/${d} = ${c * b}/${den}. Adding gives ${n}/${den} = ${correct}.`,
    difficulty: "medium",
    tags: ["fractions", "addition"],
  };
}

function genFractionSubtract() {
  const b = randInt(2, 12);
  const d = randInt(2, 12);
  if (b === d) return null;
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const n = a * d - c * b;
  if (n <= 0) return null; // keep the answer positive at Grade 7 level
  const den = b * d;
  const correct = fracText(n, den);
  const opts = makeOptions(
    correct,
    shuffled([fracText(a * d + c * b, den), fracText(Math.abs(a - c), den), fracText(n + 1, den), fracText(n, den + 1)]),
    fracNudge(n, den)
  );
  if (!opts) return null;
  return {
    question: `Subtract: ${a}/${b} − ${c}/${d}`,
    ...opts,
    explanation: `Use the common denominator ${den}: ${a}/${b} = ${a * d}/${den} and ${c}/${d} = ${c * b}/${den}. Subtracting gives ${n}/${den} = ${correct}.`,
    difficulty: "medium",
    tags: ["fractions", "subtraction"],
  };
}

function genFractionMultiply() {
  const b = randInt(2, 10);
  const d = randInt(2, 10);
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const n = a * c;
  const den = b * d;
  const correct = fracText(n, den);
  const opts = makeOptions(
    correct,
    shuffled([fracText(a * d, b * c), fracText(a + c, b + d), fracText(a * d + c * b, den), fracText(n + 1, den)]),
    fracNudge(n, den)
  );
  if (!opts) return null;
  return {
    question: `Multiply: ${a}/${b} × ${c}/${d}`,
    ...opts,
    explanation: `Multiply the numerators together and the denominators together: (${a} × ${c})/(${b} × ${d}) = ${n}/${den}, which simplifies to ${correct}.`,
    difficulty: "easy",
    tags: ["fractions", "multiplication"],
  };
}

function genFractionDivide() {
  const b = randInt(2, 10);
  const d = randInt(2, 10);
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const n = a * d;
  const den = b * c;
  const correct = fracText(n, den);
  const opts = makeOptions(
    correct,
    shuffled([fracText(a * c, b * d), fracText(b * c, a * d), fracText(a + d, b + c), fracText(n + 1, den)]),
    fracNudge(n, den)
  );
  if (!opts) return null;
  return {
    question: `Divide: ${a}/${b} ÷ ${c}/${d}`,
    ...opts,
    explanation: `Dividing by a fraction means multiplying by its reciprocal: ${a}/${b} × ${d}/${c} = ${n}/${den} = ${correct}.`,
    difficulty: "hard",
    tags: ["fractions", "division"],
  };
}

function genFractionCompare() {
  const b = randInt(2, 12);
  const d = randInt(2, 12);
  const a = randInt(1, b - 1);
  const c = randInt(1, d - 1);
  const left = a * d;
  const right = c * b;
  if (left === right) return null;
  const correct = left > right ? `${a}/${b}` : `${c}/${d}`;
  const other = left > right ? `${c}/${d}` : `${a}/${b}`;
  if (correct === other) return null;
  const opts = makeOptions(correct, [other, "They are equal", "It cannot be decided"], () => []);
  if (!opts) return null;
  return {
    question: `Which fraction is greater: ${a}/${b} or ${c}/${d}?`,
    ...opts,
    explanation: `Cross-multiply: ${a} × ${d} = ${left} and ${c} × ${b} = ${right}. Since ${Math.max(left, right)} > ${Math.min(left, right)}, ${correct} is the greater fraction.`,
    difficulty: "medium",
    tags: ["fractions", "comparing"],
  };
}

function genFractionOfQuantity() {
  const b = randInt(2, 9);
  const a = randInt(1, b - 1);
  const total = b * randInt(2, 15);
  const onePart = total / b;
  const correct = onePart * a;
  const opts = makeOptions(correct, shuffled([total - correct, onePart, correct + b, total]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `What is ${a}/${b} of ${total}?`,
    ...opts,
    explanation: `Split ${total} into ${b} equal parts: ${total} ÷ ${b} = ${onePart}. Then take ${a} of those parts: ${onePart} × ${a} = ${correct}.`,
    difficulty: "medium",
    tags: ["fractions", "word-problem"],
  };
}

/* -------------------- family: decimals ------------------------------------ */

/**
 * Decimals are carried as scaled integers throughout: a value like 3.45 is
 * held as (345, 2 places) and only turned into text here. That is why
 * 0.1 + 0.2 can never come out of this file as 0.30000000000000004.
 */
function decText(scaledValue, places) {
  const neg = scaledValue < 0;
  const digits = String(Math.abs(scaledValue)).padStart(places + 1, "0");
  const whole = digits.slice(0, digits.length - places);
  const frac = places ? "." + digits.slice(digits.length - places) : "";
  return `${neg ? "−" : ""}${whole}${frac}`;
}

function decNudge(scaled, places) {
  return (i) => [decText(scaled + i, places), decText(Math.max(0, scaled - i), places), decText(scaled + 10 * i, places)];
}

function genDecimalAdd() {
  const places = randInt(1, 2);
  const scale = Math.pow(10, places);
  const a = randInt(scale, 200 * scale);
  const b = randInt(scale, 200 * scale);
  const correct = a + b;
  const opts = makeOptions(
    decText(correct, places),
    shuffled([decText(Math.abs(a - b), places), decText(correct, places + 1), decText(correct + scale, places), decText(correct - 1, places)]),
    decNudge(correct, places)
  );
  if (!opts) return null;
  return {
    question: `Add: ${decText(a, places)} + ${decText(b, places)}`,
    ...opts,
    explanation: `Line up the decimal points, then add column by column: ${decText(a, places)} + ${decText(b, places)} = ${decText(correct, places)}.`,
    difficulty: "easy",
    tags: ["decimals", "addition"],
  };
}

function genDecimalSubtract() {
  const places = randInt(1, 2);
  const scale = Math.pow(10, places);
  let a = randInt(scale, 300 * scale);
  let b = randInt(scale, 300 * scale);
  if (a === b) return null;
  if (b > a) [a, b] = [b, a];
  const correct = a - b;
  const opts = makeOptions(
    decText(correct, places),
    shuffled([decText(a + b, places), decText(correct + scale, places), decText(correct - 1, places), decText(correct, places + 1)]),
    decNudge(correct, places)
  );
  if (!opts) return null;
  return {
    question: `Subtract: ${decText(a, places)} − ${decText(b, places)}`,
    ...opts,
    explanation: `Line up the decimal points, then subtract column by column: ${decText(a, places)} − ${decText(b, places)} = ${decText(correct, places)}.`,
    difficulty: "easy",
    tags: ["decimals", "subtraction"],
  };
}

function genDecimalTimesWhole() {
  const places = randInt(1, 2);
  const scale = Math.pow(10, places);
  const a = randInt(scale, 60 * scale);
  const m = randInt(2, 12);
  const correct = a * m;
  const opts = makeOptions(
    decText(correct, places),
    shuffled([decText(correct, places + 1), decText(a + m * scale, places), decText(correct + scale, places), decText(correct - 1, places)]),
    decNudge(correct, places)
  );
  if (!opts) return null;
  return {
    question: `Multiply: ${decText(a, places)} × ${m}`,
    ...opts,
    explanation: `Ignore the decimal point first: ${a} × ${m} = ${correct}. The first number has ${places} decimal place${places === 1 ? "" : "s"}, so the answer has ${places} too: ${decText(correct, places)}.`,
    difficulty: "medium",
    tags: ["decimals", "multiplication"],
  };
}

function genDecimalDivideWhole() {
  const places = randInt(1, 2);
  const scale = Math.pow(10, places);
  const d = randInt(2, 12);
  const q = randInt(scale, 40 * scale);
  const a = q * d; // exact division by construction
  const opts = makeOptions(
    decText(q, places),
    shuffled([decText(q, places + 1), decText(a, places), decText(q + scale, places), decText(q - 1, places)]),
    decNudge(q, places)
  );
  if (!opts) return null;
  return {
    question: `Divide: ${decText(a, places)} ÷ ${d}`,
    ...opts,
    explanation: `Ignore the decimal point first: ${a} ÷ ${d} = ${q}. Then put the point back ${places} place${places === 1 ? "" : "s"} from the right: ${decText(q, places)}.`,
    difficulty: "medium",
    tags: ["decimals", "division"],
  };
}

function genDecimalTimesDecimal() {
  const a = randInt(11, 99); // one decimal place
  const b = randInt(11, 99); // one decimal place
  const correct = a * b; // two decimal places
  const opts = makeOptions(
    decText(correct, 2),
    shuffled([decText(correct, 1), decText(correct, 3), decText(correct + 10, 2), decText(a + b, 1)]),
    decNudge(correct, 2)
  );
  if (!opts) return null;
  return {
    question: `Multiply: ${decText(a, 1)} × ${decText(b, 1)}`,
    ...opts,
    explanation: `Ignore the points and multiply: ${a} × ${b} = ${correct}. Each number has 1 decimal place, so the answer has 1 + 1 = 2 decimal places: ${decText(correct, 2)}.`,
    difficulty: "hard",
    tags: ["decimals", "multiplication"],
  };
}

function genDecimalCompare() {
  const a = randInt(100, 9999);
  const b = randInt(100, 9999);
  if (a === b) return null;
  const bigger = Math.max(a, b);
  const smaller = Math.min(a, b);
  const opts = makeOptions(decText(bigger, 2), [decText(smaller, 2), "They are equal", "It cannot be decided"], () => []);
  if (!opts) return null;
  return {
    question: `Which decimal is greater: ${decText(a, 2)} or ${decText(b, 2)}?`,
    ...opts,
    explanation: `Compare the whole-number parts first, then the tenths, then the hundredths. That makes ${decText(bigger, 2)} greater than ${decText(smaller, 2)}.`,
    difficulty: "easy",
    tags: ["decimals", "comparing"],
  };
}

function genDecimalPlaceValue() {
  const places = 3;
  const scaled = randInt(1000, 99999);
  const text = decText(scaled, places);
  const digits = String(scaled).padStart(places + 1, "0");
  const posNames = ["tenths", "hundredths", "thousandths"];
  const idx = randInt(0, 2);
  const digit = digits[digits.length - places + idx];
  const opts = makeOptions(
    digit,
    shuffled(digits.split("").filter((d) => d !== digit)),
    (i) => [String((Number(digit) + i) % 10)]
  );
  if (!opts) return null;
  return {
    question: `In the number ${text}, which digit is in the ${posNames[idx]} place?`,
    ...opts,
    explanation: `After the decimal point the places run tenths, hundredths, then thousandths. In ${text} the digit in the ${posNames[idx]} place is ${digit}.`,
    difficulty: "medium",
    tags: ["decimals", "place-value"],
  };
}

/* -------------------- family: lines-and-angles ---------------------------- */

function genComplementSupplement() {
  const isSupp = Math.random() < 0.5;
  const total = isSupp ? 180 : 90;
  const a = randInt(10, total - 10);
  const correct = total - a;
  if (correct === a) return null;
  const opts = makeOptions(correct, shuffled([a, (isSupp ? 90 : 180) - a, total + a, correct + 10]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `What is the ${isSupp ? "supplement" : "complement"} of an angle of ${a}°?`,
    ...opts,
    explanation: `${isSupp ? "Supplementary" : "Complementary"} angles add up to ${total}°, so the answer is ${total}° − ${a}° = ${correct}°.`,
    difficulty: "easy",
    tags: ["angles", isSupp ? "supplementary" : "complementary"],
  };
}

function genVerticallyOpposite() {
  const a = randInt(25, 155);
  const correct = a;
  const opts = makeOptions(correct, shuffled([180 - a, 360 - a, 90 + a, a + 10]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Two straight lines cross each other. One of the angles formed measures ${a}°. What is the measure of the angle vertically opposite it?`,
    ...opts,
    explanation: `Vertically opposite angles are always equal, so the opposite angle also measures ${a}°.`,
    difficulty: "easy",
    tags: ["angles", "vertically-opposite"],
  };
}

function genLinearPair() {
  const a = randInt(20, 160);
  const correct = 180 - a;
  if (correct === a) return null;
  const opts = makeOptions(correct, shuffled([a, 360 - a, 90 + a, correct + 10]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Two angles form a linear pair on a straight line. If one of them is ${a}°, what is the other?`,
    ...opts,
    explanation: `The two angles in a linear pair add up to 180°, so the other angle is 180° − ${a}° = ${correct}°.`,
    difficulty: "easy",
    tags: ["angles", "linear-pair"],
  };
}

function genParallelEqualAngles() {
  const a = randInt(25, 155);
  const kind = pick(["corresponding", "alternate interior", "alternate exterior"]);
  const correct = a;
  const opts = makeOptions(correct, shuffled([180 - a, 360 - a, 90 + a, a + 15]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A transversal cuts two parallel lines. One angle measures ${a}°. What is the measure of its ${kind} angle?`,
    ...opts,
    explanation: `When a transversal cuts a pair of parallel lines, ${kind} angles are equal. So that angle is also ${a}°.`,
    difficulty: "medium",
    tags: ["angles", "parallel-lines", "transversal"],
  };
}

function genCoInterior() {
  const a = randInt(30, 150);
  const correct = 180 - a;
  if (correct === a) return null;
  const opts = makeOptions(correct, shuffled([a, 360 - a, 90 + a, correct + 20]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A transversal cuts two parallel lines. One co-interior (allied) angle measures ${a}°. What is the other co-interior angle?`,
    ...opts,
    explanation: `Co-interior angles lie on the same side of the transversal between the parallel lines, and they are supplementary — they add to 180°. So the other angle is 180° − ${a}° = ${correct}°.`,
    difficulty: "medium",
    tags: ["angles", "parallel-lines", "co-interior"],
  };
}

function genAnglesOnStraightLine() {
  const a = randInt(20, 80);
  const b = randInt(20, 80);
  const correct = 180 - a - b;
  if (correct <= 10) return null;
  const opts = makeOptions(correct, shuffled([a + b, 180 - a, 180 - b, correct + 10]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Three angles sit side by side on a straight line. Two of them measure ${a}° and ${b}°. What is the third angle?`,
    ...opts,
    explanation: `Angles on a straight line add up to 180°, so the third angle is 180° − ${a}° − ${b}° = ${correct}°.`,
    difficulty: "medium",
    tags: ["angles", "straight-line"],
  };
}

function genAnglesAtAPoint() {
  const a = randInt(40, 120);
  const b = randInt(40, 120);
  const c = randInt(40, 120);
  const correct = 360 - a - b - c;
  if (correct <= 10) return null;
  const opts = makeOptions(correct, shuffled([a + b + c, 180 - a, 360 - a, correct + 20]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Four angles meet at a point. Three of them measure ${a}°, ${b}° and ${c}°. What is the fourth angle?`,
    ...opts,
    explanation: `Angles at a point add up to 360°, so the fourth angle is 360° − ${a}° − ${b}° − ${c}° = ${correct}°.`,
    difficulty: "hard",
    tags: ["angles", "angles-at-a-point"],
  };
}

/* -------------------- family: excel-formulas ------------------------------ */

/** Render a small column of values as readable "A1=4, A2=9, ..." text. */
function cellList(values, col = "A", startRow = 1) {
  return values.map((v, i) => `${col}${startRow + i}=${v}`).join(", ");
}

function genExcelSum() {
  const n = randInt(4, 6);
  const values = Array.from({ length: n }, () => randInt(2, 40));
  const correct = values.reduce((s, v) => s + v, 0);
  const opts = makeOptions(
    correct,
    shuffled([n, Math.round(correct / n), Math.max(...values), correct - Math.min(...values)]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `A worksheet contains ${cellList(values)}. What does =SUM(A1:A${n}) return?`,
    ...opts,
    explanation: `SUM adds every value in the range: ${values.join(" + ")} = ${correct}.`,
    difficulty: "easy",
    tags: ["excel", "sum", "formulas"],
  };
}

function genExcelAverage() {
  const n = randInt(4, 5);
  const base = Array.from({ length: n - 1 }, () => randInt(2, 40));
  const target = randInt(5, 40);
  // Force the last value so the mean is a whole number - cleaner as an option.
  const last = target * n - base.reduce((s, v) => s + v, 0);
  if (last < 1 || last > 99) return null;
  const values = [...base, last];
  const total = values.reduce((s, v) => s + v, 0);
  const opts = makeOptions(target, shuffled([total, Math.max(...values), Math.min(...values), n]), numericNudge(target));
  if (!opts) return null;
  return {
    question: `A worksheet contains ${cellList(values)}. What does =AVERAGE(A1:A${n}) return?`,
    ...opts,
    explanation: `AVERAGE adds the values and divides by how many there are: (${values.join(" + ")}) ÷ ${n} = ${total} ÷ ${n} = ${target}.`,
    difficulty: "medium",
    tags: ["excel", "average", "formulas"],
  };
}

function genExcelMaxMin() {
  const n = randInt(4, 6);
  // Non-overlapping bands keep every value distinct, so MAX/MIN are unambiguous.
  const values = shuffled(Array.from({ length: n }, (_, i) => randInt(2 + i * 15, 13 + i * 15)));
  const useMax = Math.random() < 0.5;
  const correct = useMax ? Math.max(...values) : Math.min(...values);
  const opts = makeOptions(
    correct,
    shuffled([useMax ? Math.min(...values) : Math.max(...values), values.reduce((s, v) => s + v, 0), n, ...values]),
    numericNudge(correct)
  );
  if (!opts) return null;
  return {
    question: `A worksheet contains ${cellList(values)}. What does =${useMax ? "MAX" : "MIN"}(A1:A${n}) return?`,
    ...opts,
    explanation: `${useMax ? "MAX" : "MIN"} returns the ${useMax ? "largest" : "smallest"} value in the range. Among ${values.join(", ")} that is ${correct}.`,
    difficulty: "easy",
    tags: ["excel", useMax ? "max" : "min", "formulas"],
  };
}

function genExcelCount() {
  const n = randInt(5, 7);
  const numeric = randInt(3, n - 1);
  const words = ["Ravi", "Meera", "Absent", "N/A", "Total"];
  const values = shuffled([
    ...Array.from({ length: numeric }, () => String(randInt(10, 90))),
    ...shuffled(words).slice(0, n - numeric),
  ]);
  const opts = makeOptions(numeric, shuffled([n, n - numeric, numeric + 1, 0]), numericNudge(numeric));
  if (!opts) return null;
  return {
    question: `A worksheet contains ${cellList(values)}. What does =COUNT(A1:A${n}) return?`,
    ...opts,
    explanation: `COUNT only counts cells holding numbers and ignores text. There are ${numeric} numeric entries in that range, so it returns ${numeric}. (COUNTA would count all ${n} non-empty cells.)`,
    difficulty: "hard",
    tags: ["excel", "count", "formulas"],
  };
}

function genExcelFormulaChoice() {
  const n = randInt(5, 9);
  const task = pick([
    { want: `=SUM(A1:A${n})`, text: `add up all the values in cells A1 to A${n}`, why: "SUM totals every value in the range." },
    { want: `=AVERAGE(A1:A${n})`, text: `find the mean of the values in cells A1 to A${n}`, why: "AVERAGE adds the values and divides by how many there are." },
    { want: `=MAX(A1:A${n})`, text: `find the highest value in cells A1 to A${n}`, why: "MAX returns the largest value in the range." },
    { want: `=MIN(A1:A${n})`, text: `find the lowest value in cells A1 to A${n}`, why: "MIN returns the smallest value in the range." },
  ]);
  const all = [`=SUM(A1:A${n})`, `=AVERAGE(A1:A${n})`, `=MAX(A1:A${n})`, `=MIN(A1:A${n})`, `=COUNT(A1:A${n})`];
  const opts = makeOptions(task.want, shuffled(all.filter((f) => f !== task.want)), () => []);
  if (!opts) return null;
  return {
    question: `Which formula would you type to ${task.text}?`,
    ...opts,
    explanation: `${task.why} Remember that every Excel formula starts with an = sign, and A1:A${n} names the range it works on.`,
    difficulty: "easy",
    tags: ["excel", "formulas"],
  };
}

function genExcelReference() {
  const col = pick(["A", "B", "C", "D"]);
  const row = randInt(1, 20);
  const kind = pick([
    {
      ref: `$${col}$${row}`,
      name: "absolute",
      why: `Both the column and the row are locked with $ signs, so ${col}${row} stays exactly the same wherever the formula is copied.`,
    },
    {
      ref: `${col}${row}`,
      name: "relative",
      why: `There are no $ signs, so both the column and the row shift when the formula is copied to another cell.`,
    },
    {
      ref: `$${col}${row}`,
      name: "mixed",
      why: `Only the column is locked with a $ sign, so the column stays fixed while the row can still change — that is a mixed reference.`,
    },
  ]);
  const opts = makeOptions(kind.name, shuffled(["absolute", "relative", "mixed", "circular"].filter((k) => k !== kind.name)), () => []);
  if (!opts) return null;
  return {
    question: `In Excel, what kind of cell reference is ${kind.ref}?`,
    ...opts,
    explanation: kind.why,
    difficulty: "medium",
    tags: ["excel", "cell-references"],
  };
}

/* ------------------------------- registry -------------------------------- */

/**
 * Named generator families.
 *
 * Chapters are NOT listed here. A chapter opts in from data/syllabus.json
 * with a "generators" field naming one or more families, e.g.
 *
 *   { "id": "maths-ch6", "name": "Working With Fractions",
 *     "generators": ["fractions"] }
 *
 * That way a chapter can be added, removed, renamed or renumbered by editing
 * data/syllabus.json alone, with no change to any JavaScript. A family may
 * also be reused by more than one chapter, and a chapter may combine several.
 */
const FAMILIES = {
  "hcf-lcm-factors": [genHCF, genLCM, genIsFactor, genSmallestDivisibleBy, genFactorCount, genHCFThree],
  "integer-operations": [genIntegerAdd, genIntegerSubtract, genIntegerMultiply, genIntegerDivide, genIntegerThreeTerm, genIntegerNumberLine],
  "arithmetic-expressions": [genBodmasAddMul, genBodmasBrackets, genBodmasDivideMul, genBodmasFourTerm, genBodmasNested, genBodmasMissingBracket],
  "fractions": [genFractionAdd, genFractionSubtract, genFractionMultiply, genFractionDivide, genFractionCompare, genFractionOfQuantity],
  "decimals": [genDecimalAdd, genDecimalSubtract, genDecimalTimesWhole, genDecimalDivideWhole, genDecimalTimesDecimal, genDecimalCompare, genDecimalPlaceValue],
  "lines-and-angles": [genComplementSupplement, genVerticallyOpposite, genLinearPair, genParallelEqualAngles, genCoInterior, genAnglesOnStraightLine, genAnglesAtAPoint],
  "excel-formulas": [genExcelSum, genExcelAverage, genExcelMaxMin, genExcelCount, genExcelFormulaChoice, genExcelReference],
};

let idCounter = 0;

function nextId(chapterId) {
  idCounter += 1;
  return `gen-${chapterId}-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Structural guard - nothing malformed is ever handed to the quiz engine. */
function validDraft(d) {
  if (!d || typeof d.question !== "string" || !d.question.trim()) return false;
  if (!Array.isArray(d.options) || d.options.length !== 4) return false;
  if (d.options.some((o) => typeof o !== "string" || !o.trim())) return false;
  if (new Set(d.options).size !== 4) return false;
  if (!Number.isInteger(d.answer) || d.answer < 0 || d.answer > 3) return false;
  if (typeof d.explanation !== "string" || !d.explanation.trim()) return false;
  return true;
}

/** Every family name this module provides, for tooling and tests. */
export function familyNames() {
  return Object.keys(FAMILIES);
}

/** The generator functions a chapter has opted into, flattened across families. */
function generatorsFor(chapter) {
  const names = (chapter && chapter.generators) || [];
  const fns = [];
  for (const name of names) {
    if (FAMILIES[name]) fns.push(...FAMILIES[name]);
  }
  return fns;
}

/** Does this chapter produce dynamic questions? */
export function hasGenerator(chapter) {
  return generatorsFor(chapter).length > 0;
}

/**
 * Family names a chapter asked for that this module does not provide.
 * A typo in syllabus.json shows up here rather than as a silently empty
 * chapter; tests/verify.html fails on any non-empty result.
 */
export function unknownFamilies(chapter) {
  const names = (chapter && chapter.generators) || [];
  return names.filter((name) => !FAMILIES[name]);
}

/**
 * Produce up to `count` fresh questions for a chapter.
 *
 * `chapter` is the entry from data/syllabus.json as the app indexes it:
 * { id, name, subjectName, generators: [...] }. Subject and chapter name are
 * read from it rather than duplicated here, so renaming a chapter in the
 * syllabus is enough - nothing in this file needs touching.
 *
 * Generators return null on a degenerate draw (a repeated option, a negative
 * fraction, a non-exact division), so we simply draw again. Question text is
 * de-duplicated within the batch, so a single quiz can never show the same
 * question twice.
 */
export function generateForChapter(chapter, count) {
  const fns = generatorsFor(chapter);
  if (!fns.length || count <= 0) return [];

  const out = [];
  const seenText = new Set();
  // Rotate through the generator functions so one quiz covers varied skills
  // rather than ten of the same kind of sum.
  let order = shuffled(fns);
  let cursor = 0;
  const maxAttempts = count * 60;

  for (let attempt = 0; attempt < maxAttempts && out.length < count; attempt++) {
    if (cursor >= order.length) {
      order = shuffled(fns);
      cursor = 0;
    }
    const fn = order[cursor++];
    let draft = null;
    try {
      draft = fn();
    } catch {
      draft = null;
    }
    if (!validDraft(draft)) continue;
    if (seenText.has(draft.question)) continue;
    seenText.add(draft.question);

    out.push({
      id: nextId(chapter.id),
      subject: chapter.subjectName,
      chapterId: chapter.id,
      chapter: chapter.name,
      type: "mcq",
      difficulty: draft.difficulty || "medium",
      question: draft.question,
      options: draft.options,
      answer: draft.answer,
      explanation: draft.explanation,
      tags: draft.tags || [],
      generated: true,
    });
  }
  return out;
}

export const generators = {
  familyNames,
  hasGenerator,
  unknownFamilies,
  generateForChapter,
};
