import Tesseract from 'tesseract.js';

// Nombre suivi d'une devise. Gère "1 500", "1.500", "1500", et les décimales ",00".
const AMOUNT_RE = '(\\d{1,3}(?:[\\s.,]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?\\s*(?:XAF|FCFA|F\\s*CFA|CFA)';
const KEYWORD_AMOUNT_RE = new RegExp(
  `(?:montant|amount|transf[eé]r[eé]?|paiement|payment|envoy[eé]?|sent)[^\\d]{0,25}${AMOUNT_RE}`, 'i'
);
const ANY_AMOUNT_RE = new RegExp(AMOUNT_RE, 'i');

export async function parseMobileMoneyReceipt(imageFile) {
  const { data: { text } } = await Tesseract.recognize(imageFile, 'fra+eng');
  const cleanText = text.replace(/\n+/g, ' ').trim();

  let operator = 'MTN';
  if (/orange|\bom\b|transfert\s*effectu/i.test(cleanText)) operator = 'ORANGE';
  else if (/mtn|momo|financial\s*transaction/i.test(cleanText)) operator = 'MTN';

  // On préfère le montant situé après un mot-clé (évite frais et solde)
  const amountMatch = cleanText.match(KEYWORD_AMOUNT_RE) || cleanText.match(ANY_AMOUNT_RE);
  const amount = amountMatch ? amountMatch[1].replace(/[\s.,]/g, '') : '';

  const refMatch = cleanText.match(/(?:ID|Ref|Reference|Trf\s*ID|Transaction\s*Id)[:\s#]*([A-Za-z0-9.-]{8,20})/i);
  const transactionRef = refMatch ? refMatch[1].toUpperCase() : '';

  // Numéro camerounais isolé (pas au milieu d'une longue suite de chiffres)
  const phoneMatch = cleanText.match(/(?<!\d)(?:\+?237)?\s*(6[5-9]\d{7})(?!\d)/);
  const customerPhone = phoneMatch ? phoneMatch[1] : '';

  return { operator, amount, transactionRef, customerPhone };
}
