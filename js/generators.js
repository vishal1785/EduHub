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
    simpler: [
      `"Divisible by both" means it must be in the times table of ${a} AND of ${b}.`,
      `"Smallest" such number is the LCM — the lowest common multiple.`,
      `LCM(${a}, ${b}) = ${correct}.`,
      `Check: ${correct} ÷ ${a} = ${correct / a} and ${correct} ÷ ${b} = ${correct / b}, both exact.`,
    ],
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
    simpler: [
      `"Of" means multiply, but it is easier to divide first.`,
      `The bottom number ${b} says how many equal parts: ${total} ÷ ${b} = ${onePart}.`,
      `The top number ${a} says how many of those parts to take: ${onePart} × ${a} = ${correct}.`,
    ],
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

/* ==================== word problems ====================================== */
/*
 * Word problems get their own generator families so a chapter can dial them
 * up or down from data/syllabus.json without touching this file.
 *
 * Every one of these also returns `simpler`: the same solution broken into
 * short, plain steps. The app shows it ONLY when the answer was wrong, on the
 * principle that the student who got it right does not need the scaffolding
 * and the student who did not needs more than "here is the answer".
 *
 * Contexts (bells tolling, stacking books, submarine depths, litres per
 * kilometre, salary spent in fractions) follow the shapes a Grade 7 paper
 * actually uses; only the numbers are fresh each time.
 */

/** Money in rupees, always to two decimals when it is not a whole number. */
function money(paise) {
  const whole = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? `₹${whole}` : `₹${whole}.${String(rest).padStart(2, "0")}`;
}

/* ---------------- family: word-problems-hcf-lcm -------------------------- */

function genWpBells() {
  const a = pick([6, 8, 9, 10, 12]);
  const b = pick([12, 15, 16, 18, 20]);
  const c = pick([20, 24, 25, 30, 36]);
  if (a === b || b === c || a === c) return null;
  const correct = lcm(lcm(a, b), c);
  if (correct > 900) return null;
  const opts = makeOptions(correct, shuffled([a + b + c, lcm(a, b), gcd(gcd(a, b), c), correct * 2, a * b * c]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Three bells ring together at intervals of ${a}, ${b} and ${c} minutes. If they ring together now, after how many minutes will they next ring together?`,
    ...opts,
    explanation: `They ring together again after a time that is a multiple of all three intervals, so take the LCM. LCM(${a}, ${b}, ${c}) = ${correct} minutes.`,
    simpler: [
      `Each bell rings on its own timetable: every ${a}, every ${b}, every ${c} minutes.`,
      `They can only ring together at a time that fits ALL THREE timetables — that is the LCM, not the sum.`,
      `LCM(${a}, ${b}) = ${lcm(a, b)}, then LCM(${lcm(a, b)}, ${c}) = ${correct}.`,
      `So the answer is ${correct} minutes.`,
    ],
    difficulty: "hard",
    tags: ["lcm", "word-problem"],
  };
}

function genWpStacks() {
  const g = pick([6, 8, 12, 14, 16, 18, 24]);
  const a = g * randInt(3, 9);
  const b = g * randInt(10, 22);
  const c = g * randInt(23, 34);
  const correct = gcd(gcd(a, b), c);
  if (correct !== g) return null; // keep the intended answer the true HCF
  const opts = makeOptions(correct, shuffled([lcm(a, b), correct * 2, Math.floor(correct / 2), a - b === 0 ? null : Math.abs(b - a)]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A library has ${a} Science books, ${b} English books and ${c} Maths books. They are stacked so that every stack has the same number of books and each stack holds only one subject. What is the greatest number of books that can be put in a stack?`,
    ...opts,
    explanation: `Each stack size must divide all three totals exactly, and we want the largest such number — that is the HCF. HCF(${a}, ${b}, ${c}) = ${correct}.`,
    simpler: [
      `Every stack must be the same size and must divide each pile exactly, with nothing left over.`,
      `So the stack size has to be a common factor of ${a}, ${b} and ${c}.`,
      `"Greatest" tells you to take the HIGHEST common factor, not the lowest common multiple.`,
      `HCF(${a}, ${b}, ${c}) = ${correct}, so ${correct} books per stack.`,
    ],
    difficulty: "hard",
    tags: ["hcf", "word-problem"],
  };
}

function genWpTrack() {
  const a = pick([40, 45, 60, 72, 90]);
  const b = pick([50, 60, 75, 80, 120]);
  if (a === b) return null;
  const correct = lcm(a, b);
  if (correct > 720) return null;
  const opts = makeOptions(correct, shuffled([a + b, gcd(a, b), a * b, correct * 2]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Two runners start together on a circular track. One completes a lap in ${a} seconds and the other in ${b} seconds. After how many seconds will they next be at the starting point together?`,
    ...opts,
    explanation: `Each runner is back at the start after a multiple of their own lap time, so they meet at the LCM. LCM(${a}, ${b}) = ${correct} seconds.`,
    simpler: [
      `Runner 1 is at the start at ${a}s, ${2 * a}s, ${3 * a}s, …`,
      `Runner 2 is at the start at ${b}s, ${2 * b}s, ${3 * b}s, …`,
      `The first time that appears in BOTH lists is the LCM.`,
      `LCM(${a}, ${b}) = ${correct} seconds.`,
    ],
    difficulty: "medium",
    tags: ["lcm", "word-problem"],
  };
}

function genWpContainer() {
  const g = pick([10, 15, 20, 25, 30]);
  const a = g * randInt(4, 9);
  const b = g * randInt(10, 16);
  const correct = gcd(a, b);
  if (correct !== g) return null;
  const opts = makeOptions(correct, shuffled([lcm(a, b), correct * 2, a - b === 0 ? null : Math.abs(a - b), Math.floor(correct / 2)]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Two tanks hold ${a} litres and ${b} litres of oil. What is the largest container that can measure the oil in either tank an exact number of times?`,
    ...opts,
    explanation: `The container must divide both amounts exactly, and we want the largest one — the HCF. HCF(${a}, ${b}) = ${correct} litres.`,
    simpler: [
      `"Measures exactly" means it divides the amount with no oil left over.`,
      `So the container size must be a common factor of ${a} and ${b}.`,
      `"Largest" means HCF. HCF(${a}, ${b}) = ${correct}.`,
      `Check: ${a} ÷ ${correct} = ${a / correct} and ${b} ÷ ${correct} = ${b / correct}, both whole numbers.`,
    ],
    difficulty: "medium",
    tags: ["hcf", "word-problem"],
  };
}

/* --------------- family: word-problems-integers -------------------------- */

function genWpTemperature() {
  const start = randInt(-5, 25);
  const rate = randInt(2, 6);
  const hours = randInt(3, 8);
  const correct = start - rate * hours;
  const opts = makeOptions(correct, shuffled([start + rate * hours, start - rate, -correct, start - hours]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `The temperature at a hill station is ${start}°C. It falls at a steady ${rate}°C every hour. What is the temperature after ${hours} hours?`,
    ...opts,
    explanation: `Total fall = ${rate} × ${hours} = ${rate * hours}°C. Starting at ${start}°C, the temperature becomes ${start} − ${rate * hours} = ${correct}°C.`,
    simpler: [
      `Falling means subtracting, so this is a subtraction problem.`,
      `In ${hours} hours it falls ${rate} × ${hours} = ${rate * hours} degrees altogether.`,
      `Start at ${start} and take away ${rate * hours}: ${start} − ${rate * hours} = ${correct}.`,
      `A temperature below zero is negative — that is normal here, not a mistake.`,
    ],
    difficulty: "medium",
    tags: ["integers", "word-problem"],
  };
}

function genWpSubmarine() {
  const depth = randInt(200, 800);
  const rise = randInt(50, 300);
  const correct = -depth + rise;
  const opts = makeOptions(correct, shuffled([-depth - rise, depth - rise, -correct, depth + rise]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A submarine is ${depth} m below sea level. It rises ${rise} m. What is its new position relative to sea level?`,
    ...opts,
    explanation: `Below sea level is negative, so the submarine starts at −${depth} m. Rising adds: −${depth} + ${rise} = ${correct} m.`,
    simpler: [
      `Sea level is 0. Below it counts as negative, so the start is −${depth}.`,
      `Rising moves the number UP towards zero, so you add.`,
      `−${depth} + ${rise} = ${correct}.`,
      correct < 0 ? `The answer is still negative, so it is still ${Math.abs(correct)} m below the surface.` : `The answer is positive, so it has reached above the surface.`,
    ],
    difficulty: "medium",
    tags: ["integers", "word-problem"],
  };
}

function genWpExamScore() {
  const total = pick([20, 25, 30]);
  const right = randInt(8, total - 3);
  const plus = pick([3, 4, 5]);
  const minus = pick([1, 2]);
  const wrong = total - right;
  const correct = right * plus - wrong * minus;
  const opts = makeOptions(correct, shuffled([right * plus, right * plus + wrong * minus, total * plus - wrong, -correct]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `In a test of ${total} questions, ${plus} marks are given for each correct answer and ${minus} mark${minus === 1 ? "" : "s"} is deducted for each wrong one. A student attempts every question and gets ${right} right. What is the total score?`,
    ...opts,
    explanation: `Correct: ${right} × ${plus} = ${right * plus}. Wrong: ${wrong} × ${minus} = ${wrong * minus} deducted. Score = ${right * plus} − ${wrong * minus} = ${correct}.`,
    simpler: [
      `Every question was attempted, so wrong answers = ${total} − ${right} = ${wrong}.`,
      `Marks gained: ${right} × ${plus} = ${right * plus}.`,
      `Marks lost: ${wrong} × ${minus} = ${wrong * minus}.`,
      `Score = gained − lost = ${right * plus} − ${wrong * minus} = ${correct}.`,
    ],
    difficulty: "hard",
    tags: ["integers", "word-problem"],
  };
}

function genWpDiver() {
  const rate = randInt(2, 8);
  const secs = randInt(10, 40);
  const correct = -(rate * secs);
  const opts = makeOptions(correct, shuffled([rate * secs, -(rate + secs), correct + rate, -Math.floor(secs / rate)]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A diver starts at the surface and goes down at a steady ${rate} m every second. Where is the diver after ${secs} seconds, relative to the surface?`,
    ...opts,
    explanation: `Distance travelled = ${rate} × ${secs} = ${rate * secs} m downwards. Downwards is negative, so the position is ${correct} m.`,
    simpler: [
      `Speed × time gives the distance: ${rate} × ${secs} = ${rate * secs} m.`,
      `The diver went DOWN from the surface, and down is the negative direction.`,
      `So the position is ${correct} m, meaning ${rate * secs} m below the surface.`,
    ],
    difficulty: "medium",
    tags: ["integers", "word-problem"],
  };
}

/* ---------------- family: word-problems-bodmas --------------------------- */

function genWpShopping() {
  const pens = randInt(3, 9);
  const penCost = randInt(6, 25);
  const books = randInt(2, 6);
  const bookCost = randInt(30, 90);
  const correct = pens * penCost + books * bookCost;
  const opts = makeOptions(correct, shuffled([(pens + books) * (penCost + bookCost), pens * bookCost + books * penCost, correct - penCost, pens + penCost + books + bookCost]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Riya buys ${pens} pens costing ₹${penCost} each and ${books} notebooks costing ₹${bookCost} each. What is the total cost?`,
    ...opts,
    explanation: `Pens: ${pens} × ${penCost} = ₹${pens * penCost}. Notebooks: ${books} × ${bookCost} = ₹${books * bookCost}. Total = ₹${correct}.`,
    simpler: [
      `Work out each kind of item separately, then add. Multiplication comes before addition.`,
      `Pens: ${pens} × ${penCost} = ${pens * penCost}.`,
      `Notebooks: ${books} × ${bookCost} = ${books * bookCost}.`,
      `Total: ${pens * penCost} + ${books * bookCost} = ${correct}.`,
    ],
    difficulty: "easy",
    tags: ["bodmas", "word-problem"],
  };
}

function genWpChange() {
  const note = pick([200, 500, 1000, 2000]);
  const items = randInt(3, 8);
  const cost = randInt(15, 60);
  const spent = items * cost;
  if (spent >= note) return null;
  const correct = note - spent;
  const opts = makeOptions(correct, shuffled([note + spent, spent, note - cost, correct - cost]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Aman pays with a ₹${note} note for ${items} packets of biscuits costing ₹${cost} each. How much change does he get?`,
    ...opts,
    explanation: `Cost = ${items} × ${cost} = ₹${spent}. Change = ${note} − ${spent} = ₹${correct}.`,
    simpler: [
      `Two steps: first find what he spent, then take it off the note.`,
      `Spent: ${items} × ${cost} = ${spent}.`,
      `Change: ${note} − ${spent} = ${correct}.`,
      `Doing the subtraction first would be wrong — BODMAS puts × before −.`,
    ],
    difficulty: "easy",
    tags: ["bodmas", "word-problem"],
  };
}

function genWpBoxes() {
  const boxes = randInt(4, 12);
  const per = randInt(6, 24);
  const given = randInt(5, 40);
  const total = boxes * per;
  if (given >= total) return null;
  const correct = total - given;
  const opts = makeOptions(correct, shuffled([total + given, boxes * (per - given), total, given]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A shopkeeper has ${boxes} boxes with ${per} sweets in each box. He gives away ${given} sweets. How many sweets are left?`,
    ...opts,
    explanation: `Total sweets = ${boxes} × ${per} = ${total}. Left = ${total} − ${given} = ${correct}.`,
    simpler: [
      `First find how many sweets there are altogether: ${boxes} × ${per} = ${total}.`,
      `Then take away the ones given: ${total} − ${given} = ${correct}.`,
      `Multiply before you subtract — that is the BODMAS order.`,
    ],
    difficulty: "easy",
    tags: ["bodmas", "word-problem"],
  };
}

/* --------------- family: word-problems-fractions ------------------------- */

function genWpClassFraction() {
  const den = pick([3, 4, 5, 6, 8]);
  const num = randInt(1, den - 1);
  const groups = randInt(4, 10);
  const total = den * groups;
  const boys = (total / den) * num;
  const correct = total - boys;
  const opts = makeOptions(correct, shuffled([boys, total, total / den, correct + num]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `In a class of ${total} students, ${num}/${den} are boys. How many girls are there?`,
    ...opts,
    explanation: `Boys = ${num}/${den} of ${total} = ${boys}. Girls = ${total} − ${boys} = ${correct}.`,
    simpler: [
      `Split the class into ${den} equal parts: ${total} ÷ ${den} = ${total / den} students in each part.`,
      `Boys are ${num} of those parts: ${total / den} × ${num} = ${boys}.`,
      `The question asks for GIRLS, so subtract: ${total} − ${boys} = ${correct}.`,
      `Stopping at ${boys} is the usual slip — read what is being asked for.`,
    ],
    difficulty: "medium",
    tags: ["fractions", "word-problem"],
  };
}

function genWpCups() {
  const cupDen = pick([2, 3, 4, 5]);
  const cupNum = randInt(1, cupDen - 1);
  const cups = randInt(6, 20);
  const litresNum = cupNum * cups;
  const correct = cups;
  const opts = makeOptions(correct, shuffled([cups * cupDen, Math.round(cups / 2), cups + cupDen, litresNum]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A jug holds ${fracText(litresNum, cupDen)} litres of juice. Glasses of ${cupNum}/${cupDen} litre each are filled from it. How many full glasses can be poured?`,
    ...opts,
    explanation: `Number of glasses = ${fracText(litresNum, cupDen)} ÷ ${cupNum}/${cupDen} = ${litresNum}/${cupDen} × ${cupDen}/${cupNum} = ${correct}.`,
    simpler: [
      `"How many glasses fit into the jug" is a division question.`,
      `Dividing by a fraction means multiplying by it upside down.`,
      `${litresNum}/${cupDen} ÷ ${cupNum}/${cupDen} = ${litresNum}/${cupDen} × ${cupDen}/${cupNum} = ${correct}.`,
      `So ${correct} full glasses.`,
    ],
    difficulty: "hard",
    tags: ["fractions", "word-problem"],
  };
}

function genWpSalary() {
  const parts = pick([[2, 4, 8], [2, 3, 6], [3, 4, 6], [2, 5, 10]]);
  const [a, b, c] = parts;
  const base = a * b * c;
  const salary = base * randInt(2, 12) * 10;
  const spent = salary / a + salary / b + salary / c;
  const correct = salary - spent;
  if (correct <= 0 || !Number.isInteger(correct)) return null;
  const opts = makeOptions(correct, shuffled([spent, salary, salary / a, correct + salary / c]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Out of a monthly income of ₹${salary}, a family spends 1/${a} on food, 1/${b} on rent and 1/${c} on travel. How much is saved?`,
    ...opts,
    explanation: `Food = ₹${salary / a}, rent = ₹${salary / b}, travel = ₹${salary / c}. Spent = ₹${spent}. Saved = ${salary} − ${spent} = ₹${correct}.`,
    simpler: [
      `Work out each amount spent, one at a time.`,
      `Food: ${salary} ÷ ${a} = ${salary / a}. Rent: ${salary} ÷ ${b} = ${salary / b}. Travel: ${salary} ÷ ${c} = ${salary / c}.`,
      `Add them up: ${salary / a} + ${salary / b} + ${salary / c} = ${spent}.`,
      `Saved is what is left: ${salary} − ${spent} = ${correct}.`,
    ],
    difficulty: "hard",
    tags: ["fractions", "word-problem"],
  };
}

/* --------------- family: word-problems-decimals -------------------------- */

function genWpMileage() {
  const perLitre = randInt(80, 220); // tenths of a km
  const litres = randInt(20, 60); // tenths of a litre
  const totalTenths = perLitre * litres; // hundredths of a km
  const correct = decText(perLitre, 1);
  const opts = makeOptions(
    correct,
    shuffled([decText(totalTenths, 2), decText(perLitre * 2, 1), decText(perLitre + 10, 1), decText(litres, 1)]),
    decNudge(perLitre, 1)
  );
  if (!opts) return null;
  return {
    question: `A car travels ${decText(totalTenths, 2)} km using ${decText(litres, 1)} litres of petrol. How far does it travel on 1 litre?`,
    ...opts,
    explanation: `Distance per litre = ${decText(totalTenths, 2)} ÷ ${decText(litres, 1)} = ${correct} km.`,
    simpler: [
      `"On 1 litre" means share the distance equally between the litres — so divide.`,
      `${decText(totalTenths, 2)} ÷ ${decText(litres, 1)} = ${correct}.`,
      `A quick check: ${correct} × ${decText(litres, 1)} = ${decText(totalTenths, 2)}, which matches the distance given.`,
    ],
    difficulty: "medium",
    tags: ["decimals", "word-problem"],
  };
}

function genWpUnitCost() {
  const items = randInt(6, 25);
  const each = randInt(150, 4000); // paise
  const total = items * each;
  const correct = money(each);
  const opts = makeOptions(correct, shuffled([money(total), money(each * 2), money(each + 100), money(Math.round(total / (items + 1)))]), () => []);
  if (!opts) return null;
  return {
    question: `${items} identical notebooks cost ${money(total)} altogether. What does one notebook cost?`,
    ...opts,
    explanation: `Cost of one = ${money(total)} ÷ ${items} = ${correct}.`,
    simpler: [
      `The total is shared between ${items} notebooks, so this is a division.`,
      `${money(total)} ÷ ${items} = ${correct}.`,
      `Check by multiplying back: ${correct} × ${items} = ${money(total)}.`,
    ],
    difficulty: "medium",
    tags: ["decimals", "money", "word-problem"],
  };
}

function genWpCloth() {
  const perShirt = randInt(120, 250); // hundredths of a metre
  const shirts = randInt(8, 25);
  const extra = randInt(1, perShirt - 1);
  const roll = perShirt * shirts + extra;
  const correct = shirts;
  const opts = makeOptions(correct, shuffled([shirts + 1, shirts - 1, Math.round(roll / 100), perShirt]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `A tailor needs ${decText(perShirt, 2)} m of cloth for one shirt. How many complete shirts can be cut from a roll of ${decText(roll, 2)} m?`,
    ...opts,
    explanation: `${decText(roll, 2)} ÷ ${decText(perShirt, 2)} = ${shirts} shirts with ${decText(extra, 2)} m left over, so ${correct} complete shirts.`,
    simpler: [
      `Divide the roll by the cloth needed for one shirt.`,
      `${decText(roll, 2)} ÷ ${decText(perShirt, 2)} gives ${shirts} and a bit left over.`,
      `The leftover ${decText(extra, 2)} m is not enough for another shirt, so it does not count.`,
      `The word "complete" tells you to round DOWN, never up: ${correct}.`,
    ],
    difficulty: "hard",
    tags: ["decimals", "word-problem"],
  };
}

function genWpBill() {
  const note = pick([50000, 100000, 200000]); // paise
  const a = randInt(1000, 20000);
  const b = randInt(1000, 20000);
  const c = randInt(500, 12000);
  const spent = a + b + c;
  if (spent >= note) return null;
  const correct = money(note - spent);
  const opts = makeOptions(correct, shuffled([money(spent), money(note + spent), money(note - a), money(note - spent - 100)]), () => []);
  if (!opts) return null;
  return {
    question: `From ${money(note)}, Ankit spends ${money(a)} on books, ${money(b)} on a bag and ${money(c)} on snacks. How much is left?`,
    ...opts,
    explanation: `Total spent = ${money(a)} + ${money(b)} + ${money(c)} = ${money(spent)}. Left = ${money(note)} − ${money(spent)} = ${correct}.`,
    simpler: [
      `Add up everything he spent first.`,
      `${money(a)} + ${money(b)} + ${money(c)} = ${money(spent)}.`,
      `Then subtract from what he started with: ${money(note)} − ${money(spent)} = ${correct}.`,
      `Line the decimal points up when adding money — that is where most slips happen.`,
    ],
    difficulty: "medium",
    tags: ["decimals", "money", "word-problem"],
  };
}

/* ---------------- family: word-problems-angles --------------------------- */

function genWpLinearPairAlgebra() {
  const x = randInt(8, 25);
  const a = randInt(2, 9);
  const b = randInt(1, 30);
  const c = randInt(2, 9);
  const first = a * x + b;
  const second = 180 - first;
  const d = second - c * x;
  if (first <= 0 || second <= 0 || Math.abs(d) > 60) return null;
  const sign = d < 0 ? "−" : "+";
  const correct = x;
  const opts = makeOptions(correct, shuffled([180 - x, x + 10, Math.round(180 / (a + c)), x * 2]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `Two angles on a straight line are (${a}x + ${b})° and (${c}x ${sign} ${Math.abs(d)})°. What is the value of x?`,
    ...opts,
    explanation: `Angles on a straight line add to 180°, so (${a}x + ${b}) + (${c}x ${sign} ${Math.abs(d)}) = 180. That gives ${a + c}x ${b + d < 0 ? "−" : "+"} ${Math.abs(b + d)} = 180, so x = ${correct}.`,
    simpler: [
      `The two angles sit on a straight line, so together they make 180°.`,
      `Write that as an equation: (${a}x + ${b}) + (${c}x ${sign} ${Math.abs(d)}) = 180.`,
      `Collect the x terms and the numbers: ${a + c}x ${b + d < 0 ? "−" : "+"} ${Math.abs(b + d)} = 180.`,
      `Solve it: x = ${correct}. (Checking: ${first}° + ${second}° = 180°.)`,
    ],
    difficulty: "hard",
    tags: ["angles", "algebra", "word-problem"],
  };
}

function genWpParallelogram() {
  const a = randInt(35, 145);
  if (a === 90) return null;
  const correct = 180 - a;
  const opts = makeOptions(correct, shuffled([a, 360 - a, 90, correct + 10]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `In a parallelogram ABCD, ∠A = ${a}°. What is ∠B?`,
    ...opts,
    explanation: `∠A and ∠B are co-interior angles between the parallel sides AD and BC, so they add to 180°. ∠B = 180° − ${a}° = ${correct}°.`,
    simpler: [
      `In a parallelogram the opposite sides are parallel.`,
      `∠A and ∠B are next to each other between a pair of parallel sides, so they are co-interior — they add to 180°.`,
      `∠B = 180° − ${a}° = ${correct}°.`,
      `Opposite angles (∠A and ∠C) would be EQUAL instead; neighbouring ones add to 180°.`,
    ],
    difficulty: "medium",
    tags: ["angles", "parallelogram", "word-problem"],
  };
}

function genWpTriangleExterior() {
  const p = randInt(35, 85);
  const ext = randInt(p + 25, 155);
  const correct = ext - p;
  if (correct <= 10) return null;
  const opts = makeOptions(correct, shuffled([180 - ext, ext + p, 180 - ext - p, correct + 15]), numericNudge(correct));
  if (!opts) return null;
  return {
    question: `In triangle PQR, side QR is extended to S. If the exterior angle ∠PRS = ${ext}° and ∠P = ${p}°, what is ∠Q?`,
    ...opts,
    explanation: `An exterior angle equals the sum of the two opposite interior angles: ${ext}° = ∠P + ∠Q. So ∠Q = ${ext}° − ${p}° = ${correct}°.`,
    simpler: [
      `There is a rule for this: an exterior angle of a triangle equals the two interior angles FAR from it, added together.`,
      `So ${ext}° = ∠P + ∠Q.`,
      `Put in ∠P: ${ext} = ${p} + ∠Q.`,
      `∠Q = ${ext} − ${p} = ${correct}°.`,
    ],
    difficulty: "hard",
    tags: ["angles", "triangle", "word-problem"],
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

  // Word problems. Separate families so a chapter can ask for more or fewer of
  // them from data/syllabus.json without any code change.
  "word-problems-hcf-lcm": [genWpBells, genWpStacks, genWpTrack, genWpContainer],
  "word-problems-integers": [genWpTemperature, genWpSubmarine, genWpExamScore, genWpDiver],
  "word-problems-bodmas": [genWpShopping, genWpChange, genWpBoxes],
  "word-problems-fractions": [genWpClassFraction, genWpCups, genWpSalary],
  "word-problems-decimals": [genWpMileage, genWpUnitCost, genWpCloth, genWpBill],
  "word-problems-angles": [genWpLinearPairAlgebra, genWpParallelogram, genWpTriangleExterior],
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
  if (d.simpler !== undefined && d.simpler !== null) {
    if (!Array.isArray(d.simpler) || !d.simpler.length) return false;
    if (d.simpler.some((s) => typeof s !== "string" || !s.trim())) return false;
  }
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
      // Shown only after a wrong answer - see renderQuiz in js/app.js.
      simpler: Array.isArray(draft.simpler) && draft.simpler.length ? draft.simpler : null,
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
