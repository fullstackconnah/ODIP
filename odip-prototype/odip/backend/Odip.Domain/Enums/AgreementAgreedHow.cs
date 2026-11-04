namespace Odip.Domain.Enums;

/// <summary>How the person agreed to a service agreement, as the coordinator records it when marking it approved. Stored as an int: never renumber.</summary>
public enum AgreementAgreedHow
{
    Email = 0,
    Phone = 1,
    InPerson = 2,
    Other = 3,
}
