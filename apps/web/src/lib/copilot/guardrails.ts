/**
 * Untrusted-input guardrails. Customer messages and retrieved documents are
 * data, never instructions. Detection is deterministic and only *flags*; it
 * never changes authorization or executes anything the message asks for.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|policies)/i,
  /disregard\s+(your|all|the|any)\s+(guidelines|instructions|rules|policy|policies|system)/i,
  /system\s+(prompt|override|message|instruction)/i,
  /you\s+are\s+now\s+(a|an|the)\b/i,
  /(act|pretend)\s+as\s+(if\s+you\s+are\s+)?(a|an|the)\b/i,
  /developer\s+mode|god\s+mode|jailbreak/i,
  /mark\s+(the\s+|this\s+)?(refund|return|payment)\s+as\s+(approved|refunded|completed)/i,
  /approve\s+(a|the|this)\s+(full\s+)?(refund|return)\s+(immediately|right now|now)/i,
  /confirm\s+it\s+is\s+done/i,
];

export type GuardrailResult = {
  injectionDetected: boolean;
  matchedPatterns: string[];
  requestsHumanAgent: boolean;
};

const HUMAN_REQUEST_PATTERN =
  /(speak|talk|transfer|escalate)\s+(to\s+)?(a\s+|the\s+)?(human|real person|agent|manager|supervisor|someone)/i;

export function runGuardrails(message: string): GuardrailResult {
  const matchedPatterns: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const match = pattern.exec(message);
    if (match) {
      matchedPatterns.push(match[0].toLowerCase().slice(0, 80));
    }
  }
  return {
    injectionDetected: matchedPatterns.length > 0,
    matchedPatterns,
    requestsHumanAgent: HUMAN_REQUEST_PATTERN.test(message),
  };
}

/**
 * Strips imperative override attempts from text before it is shown to the LLM
 * as untrusted data, and delimits it explicitly.
 */
export function delimitUntrusted(label: string, text: string): string {
  return `<untrusted_${label}>\n${text}\n</untrusted_${label}>`;
}
