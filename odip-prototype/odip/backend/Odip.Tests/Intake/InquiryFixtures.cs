using Odip.Application.DTOs;
using Odip.Domain.Entities;

namespace Odip.Tests.Intake;

/// <summary>Shared enquiry fixtures: Start intake needs the full address (owner decision 4), so every enquiry a test converts gets one.</summary>
public static class InquiryFixtures
{
    public static ParticipantInquiry WithFullAddress(this ParticipantInquiry x)
    {
        x.AddressStreet = "12 Smith St"; x.AddressSuburb = "Parramatta"; x.AddressState = "NSW"; x.AddressPostcode = "2150";
        return x;
    }

    public static CreateParticipantInquiryDto WithFullAddress(this CreateParticipantInquiryDto d) =>
        d with { AddressStreet = "12 Smith St", AddressSuburb = "Parramatta", AddressState = "NSW", AddressPostcode = "2150" };

    public static UpdateParticipantInquiryDto WithFullAddress(this UpdateParticipantInquiryDto d) =>
        d with { AddressStreet = "12 Smith St", AddressSuburb = "Parramatta", AddressState = "NSW", AddressPostcode = "2150" };
}
