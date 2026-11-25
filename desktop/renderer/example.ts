import type { Action, Card, Turn } from "./meeting";

export const exampleTurns: Turn[] = [
  {
    id: 1,
    timestamp: 4,
    text: "Can we move the checkout queries into a repository this sprint?",
  },
  {
    id: 2,
    timestamp: 11,
    text: "May integration test na for checkout. We can compare the old and new behavior.",
  },
  {
    id: 3,
    timestamp: 19,
    text: "Anong direction natin sa refactor? One large change, or per feature?",
  },
];
export const examples: Record<Action, Card> = {
  explain: {
    timestamp: 14,
    kind: "explain",
    title: "What the test gives you",
    body: "Run the same cart through both implementations. Compare totals, discounts, and rounding before switching the checkout path.",
  },
  answer: {
    timestamp: 21,
    kind: "answer",
    title: "Start with checkout",
    body: "Per feature tayo. Move one checkout query, keep its integration test green, and use that diff as the pattern for the next feature.",
  },
  insight: {
    timestamp: 25,
    kind: "followup",
    title: "Ask about the rollback",
    body: "If the new query changes a customer’s total, can we revert checkout independently?",
  },
  check: {
    timestamp: 26,
    kind: "check",
    title: "Verify the integration test",
    body: "Ask for the test that exercises checkout through its public entry point. A repository unit test alone would miss changes in the service.",
  },
  diagram: {
    timestamp: 27,
    kind: "diagram",
    title: "One feature at a time",
    body: "Repeat after checkout behavior is verified.",
    nodes: ["Baseline test", "Move query", "Compare totals"],
  },
  ask: {
    timestamp: 28,
    kind: "ask",
    title: "Try this in a live session",
    body: "This example uses scripted meeting notes. Open Live session to ask Codex about your own conversation.",
  },
};
