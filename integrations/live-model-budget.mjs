import { mkdirSync, readFileSync, writeFileSync, renameSync, rmdirSync } from 'node:fs';

export function readModelBudget(path) {
  const budget = JSON.parse(readFileSync(path, 'utf8'));
  if (!Number.isSafeInteger(budget.limit) || budget.limit < 1 ||
    !Number.isSafeInteger(budget.used) || budget.used < 0 || budget.used > budget.limit ||
    !Array.isArray(budget.turns) || !Number.isFinite(Date.parse(budget.deadline))) throw Error('invalid_model_budget');
  return budget;
}
export function reserveModelTurn(path, purpose, now = Date.now()) {
  mkdirSync(path + '.lock');
  try {
    const budget = readModelBudget(path);
    if (now >= Date.parse(budget.deadline)) throw Error('model_test_deadline');
    if (budget.used >= budget.limit) throw Error('model_budget_exhausted');
    budget.used++;
    budget.turns.push({ id: budget.used, purpose: String(purpose).slice(0, 80), at: new Date(now).toISOString() });
    const temporary = path + '.writing-' + process.pid;
    writeFileSync(temporary, JSON.stringify(budget, null, 2), { mode: 0o600 });
    renameSync(temporary, path);
    return budget;
  } finally { rmdirSync(path + '.lock'); }
}
