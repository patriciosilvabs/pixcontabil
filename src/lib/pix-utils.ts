import { isValidCPF, isValidCNPJ } from "@/lib/utils";

export type PixKeyType = "cpf" | "cnpj" | "email" | "phone" | "random";

/**
 * Detects the Pix key type from user input using regex heuristics.
 * Order: email → EVP → phone → CPF → CNPJ
 * Returns null if no pattern matches.
 */
export function detectPixKeyType(input: string): PixKeyType | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // E-mail
  if (/^\S+@\S+\.\S+$/.test(trimmed)) return "email";

  // EVP (UUID / Chave aleatória) — 36 chars
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return "random";

  // Strip non-digits for numeric checks
  const digits = trimmed.replace(/\D/g, "");

  // Phone — with or without +55, 10-13 digits
  if (/^(\+?55)?\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(trimmed)) return "phone";
  // Also match raw digits that look like phone (10 or 11 digits starting with area code)
  if ((digits.length === 10 || digits.length === 11) && /^[1-9]{2}9?\d{8}$/.test(digits)) {
    // Could also be CPF (11 digits) — only return phone if it starts with valid area code + 9
    if (digits.length === 11 && digits[2] === "9") {
      // Ambiguous: 11 digits starting with 9 in 3rd position = likely phone
      // But could be CPF — check CPF validity first
      if (!isValidCPF(digits)) return "phone";
      // If valid CPF, fall through to CPF check below
    }
    if (digits.length === 10) return "phone";
  }

  // CPF — 11 digits (with or without mask)
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(trimmed) && digits.length === 11) {
    if (isValidCPF(digits)) return "cpf";
  }

  // CNPJ — 14 digits (with or without mask)
  if (/^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed) && digits.length === 14) {
    if (isValidCNPJ(digits)) return "cnpj";
  }

  return null;
}

export const PIX_KEY_TYPE_LABELS: Record<PixKeyType, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random: "Aleatória",
};
