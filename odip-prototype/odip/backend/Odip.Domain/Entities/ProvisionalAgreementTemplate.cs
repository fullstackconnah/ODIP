namespace Odip.Domain.Entities;

/// <summary>
/// Immutable development-only source identity for the imported blank agreement assets.
/// The matching DOCX and PDF are repository content under
/// Odip.Infrastructure/SeedData/AgreementTemplates; this metadata is intentionally
/// not an approval, signing, readiness, roster, invoice, or claim transition.
/// </summary>
public static class ProvisionalAgreementTemplate
{
    public const string Version = "ODIP-Service-Agreement-Blank-DRAFT-2026-09-27";
    public const string State = "UnapprovedDraft";
    // This must be deliberately changed only when an approved source is introduced.
    // The draft source imported here is never eligible to create signing evidence.
    public static bool AllowsElectronicSigningEvidence => State == "ApprovedForElectronicSigning";
    public const string DocxFileName = "ODIP-Service-Agreement-Blank-DRAFT.docx";
    public const string PdfFileName = "ODIP-Service-Agreement-Blank-DRAFT.pdf";
    public const string DocxSha256 = "2d87e4c21d569161f22aa2246a0146418d5f14fabe6c607616844a97ecb8648f";
    public const string PdfSha256 = "d26f0d1ea2e78f4b29df37d89d0bad61400c842b4dc090e303969ddd9335d06d";
}
