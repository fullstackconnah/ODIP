namespace Odip.Domain.Billing.Services;

/// <summary>
/// Destination a <see cref="BillableEvent"/> is routed to once validated.
/// </summary>
public enum BillingRoute
{
    /// <summary>Agency-managed funds: goes into an NDIA PRODA bulk payment request.</summary>
    ProdaClaim,

    /// <summary>Plan-managed funds: goes into a Xero invoice addressed to the plan manager.</summary>
    XeroInvoiceToPlanManager,

    /// <summary>Self-managed funds: goes into a Xero invoice addressed to the participant/nominee.</summary>
    XeroInvoiceToParticipant,

    /// <summary>Private/B2B funds: goes into a Xero invoice addressed to the direct payer/customer.</summary>
    XeroInvoiceToPayer
}

/// <summary>
/// Implements the billing routing rule from the platform plan: every billable event
/// is routed by the <see cref="FundingRouteType"/> of the funding source it draws
/// from — AgencyManaged funds become an NDIS PRODA claim, everything else becomes a
/// Xero invoice addressed to the appropriate party (plan manager, participant, or
/// private/B2B payer). Pure — no I/O, no persistence lookups.
/// </summary>
public static class BillingRouter
{
    /// <summary>Determines where <paramref name="billableEvent"/> should be sent for payment.</summary>
    /// <param name="billableEvent">The event being routed (currently only used for future extensibility; routing is driven entirely by the funding source today).</param>
    /// <param name="fundingSource">The funding source the event draws from.</param>
    public static BillingRoute Route(BillableEvent billableEvent, FundingSource fundingSource)
    {
        ArgumentNullException.ThrowIfNull(billableEvent);
        ArgumentNullException.ThrowIfNull(fundingSource);

        return fundingSource.RouteType switch
        {
            FundingRouteType.AgencyManaged => BillingRoute.ProdaClaim,
            FundingRouteType.PlanManaged => BillingRoute.XeroInvoiceToPlanManager,
            FundingRouteType.SelfManaged => BillingRoute.XeroInvoiceToParticipant,
            FundingRouteType.Private => BillingRoute.XeroInvoiceToPayer,
            FundingRouteType.BusinessToBusiness => BillingRoute.XeroInvoiceToPayer,
            _ => throw new ArgumentOutOfRangeException(
                nameof(fundingSource), fundingSource.RouteType, "Unrecognised FundingRouteType.")
        };
    }
}
