import { DocumentBuilder } from "@nestjs/swagger";

export function buildOpenApiConfig() {
  return new DocumentBuilder()
    .setTitle("Paadi API")
    .setDescription("Paadi backend — auth, pots, payments, settlements")
    .setVersion("1.0")
    .addBearerAuth()
    .addTag(
      "virtual-accounts",
      "Provision and manage a customer's dedicated NUBAN. Funds credited to a virtual account settle into the customer's reconciled wallet balance."
    )
    .addTag(
      "wallet",
      "Read the reconciled wallet balance and move value out of it — withdraw to a bank account or pay a pot split directly from the wallet."
    )
    .addTag(
      "statements",
      "Ledger-derived transaction history and per-customer statements over the reconciled wallet."
    )
    .addTag(
      "reconciliation",
      "Admin queue for misdirected and unmatched payments — inspect exceptions held in suspense and resolve, refund, or hold them."
    )
    .addTag(
      "developer",
      "Register outbound webhook endpoints and receive signed, at-least-once event deliveries (verify each with the paadi-signature header) so a downstream app never has to poll."
    )
    .addTag(
      "pots",
      "Create and manage bill-split pots — the reference consumer that integrates against the same virtual-account and wallet API any downstream developer would use."
    )
    .build();
}
