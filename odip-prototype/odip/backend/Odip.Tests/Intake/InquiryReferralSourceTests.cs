using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Intake;

/// <summary>"Referred by" on an enquiry: a source from the organisation's own list, optional, checked on every save (also for a converted enquiry), kept when it is hidden later.</summary>
public class InquiryReferralSourceTests
{
    private readonly Guid _tenantId = Guid.NewGuid();
    private readonly Guid _otherTenantId = Guid.NewGuid();
    private readonly string _dbName = Guid.NewGuid().ToString();

    private OdipDbContext Db(Guid? tenantId, bool superAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(superAdmin);
        return new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(_dbName).Options, tenant.Object);
    }

    private ParticipantInquiriesController Controller(bool superAdmin = false, string role = "Coordinator")
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(_tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(superAdmin);
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Guid.NewGuid().ToString()), new Claim(ClaimTypes.Role, role)], "test");
        return new ParticipantInquiriesController(Db(_tenantId, superAdmin), tenant.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } },
        };
    }

    private ReferralSource Source(Guid tenantId, string name, bool active = true)
    {
        using var db = Db(null, true);
        var row = new ReferralSource { Id = Guid.NewGuid(), TenantId = tenantId, Name = name, IsActive = active };
        db.ReferralSources.Add(row);
        db.SaveChanges();
        return row;
    }

    private ParticipantInquiry Inquiry(Action<ParticipantInquiry>? with = null)
    {
        using var db = Db(null, true);
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = _tenantId, FirstName = "Noah", LastName = "Lee", Source = "Phone" };
        with?.Invoke(inquiry);
        db.ParticipantInquiries.Add(inquiry);
        db.SaveChanges();
        return inquiry;
    }

    private ParticipantInquiry Stored(Guid id) => Db(null, true).ParticipantInquiries.AsNoTracking().Single(x => x.Id == id);

    private static T Data<T>(IActionResult? result) => Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value).Data!;

    private static IDictionary<string, string[]> Problems(IActionResult? result) =>
        Assert.IsType<ValidationProblemDetails>(Assert.IsAssignableFrom<ObjectResult>(result).Value).Errors;

    private static UpdateParticipantInquiryDto Echo(ParticipantInquiry x, Guid? sourceId) => new()
    {
        FirstName = x.FirstName, LastName = x.LastName, Source = x.Source, Provenance = x.Provenance, ContactIsParticipant = x.ContactIsParticipant, ReferralSourceId = sourceId,
    };

    private const string Pick = "Pick a referral source from the list.";

    [Fact]
    public async Task Create_with_an_active_source_saves_it_and_returns_its_name()
    {
        var hospital = Source(_tenantId, "Hospital");

        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ReferralSourceId = hospital.Id }, CancellationToken.None);

        var dto = Data<ParticipantInquiryDto>(result.Result);
        Assert.Equal((hospital.Id, "Hospital"), (dto.ReferralSourceId, dto.ReferralSourceName));
        Assert.Equal(hospital.Id, Stored(dto.Id).ReferralSourceId);
    }

    [Fact]
    public async Task Create_without_a_source_saves_null()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone" }, CancellationToken.None);

        var dto = Data<ParticipantInquiryDto>(result.Result);
        Assert.Null(dto.ReferralSourceId);
        Assert.Null(dto.ReferralSourceName);
        Assert.Null(Stored(dto.Id).ReferralSourceId);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Create_with_another_tenants_source_is_400_even_for_a_SuperAdmin(bool superAdmin)
    {
        var theirs = Source(_otherTenantId, "Their source");

        var result = await Controller(superAdmin, superAdmin ? "SuperAdmin" : "Coordinator")
            .Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ReferralSourceId = theirs.Id }, CancellationToken.None);

        Assert.Equal([Pick], Problems(result.Result)["referralSourceId"]);
        Assert.Empty(Db(null, true).ParticipantInquiries);
    }

    [Fact]
    public async Task Create_with_an_inactive_source_is_400()
    {
        var hidden = Source(_tenantId, "Closed clinic", active: false);

        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ReferralSourceId = hidden.Id }, CancellationToken.None);

        Assert.Equal([Pick], Problems(result.Result)["referralSourceId"]);
    }

    [Fact]
    public async Task Create_with_an_unknown_id_is_400()
    {
        var result = await Controller().Create(new CreateParticipantInquiryDto { FirstName = "Ari", Source = "Phone", ReferralSourceId = Guid.NewGuid() }, CancellationToken.None);

        Assert.Equal([Pick], Problems(result.Result)["referralSourceId"]);
    }

    [Fact]
    public async Task Update_keeps_an_already_saved_source_after_it_is_deactivated()
    {
        var clinic = Source(_tenantId, "Closed clinic");
        var inquiry = Inquiry(x => x.ReferralSourceId = clinic.Id);
        using (var db = Db(null, true)) { db.ReferralSources.Single(s => s.Id == clinic.Id).IsActive = false; db.SaveChanges(); }

        var result = await Controller().Update(inquiry.Id, Echo(inquiry, clinic.Id) with { Provenance = "Rang twice" }, CancellationToken.None);

        var dto = Data<ParticipantInquiryDto>(result.Result);
        Assert.Equal((clinic.Id, "Closed clinic"), (dto.ReferralSourceId, dto.ReferralSourceName));
        Assert.Equal(clinic.Id, Stored(inquiry.Id).ReferralSourceId);
    }

    [Fact]
    public async Task Update_cannot_switch_to_a_different_hidden_source_but_can_clear_or_change_to_an_active_one()
    {
        var hiddenOld = Source(_tenantId, "Old", active: false);
        var hiddenOther = Source(_tenantId, "Other old", active: false);
        var active = Source(_tenantId, "Hospital");
        var inquiry = Inquiry(x => x.ReferralSourceId = hiddenOld.Id);

        var refused = await Controller().Update(inquiry.Id, Echo(inquiry, hiddenOther.Id), CancellationToken.None);
        var changed = await Controller().Update(inquiry.Id, Echo(inquiry, active.Id), CancellationToken.None);
        var cleared = await Controller().Update(inquiry.Id, Echo(inquiry, null), CancellationToken.None);

        Assert.Equal([Pick], Problems(refused.Result)["referralSourceId"]);
        Assert.Equal(active.Id, Data<ParticipantInquiryDto>(changed.Result).ReferralSourceId);
        Assert.Null(Data<ParticipantInquiryDto>(cleared.Result).ReferralSourceId);
    }

    [Fact]
    public async Task Update_from_a_tab_that_sends_no_source_keeps_the_stored_one_but_an_explicit_null_clears_it()
    {
        var hospital = Source(_tenantId, "Hospital");
        var inquiry = Inquiry(x => x.ReferralSourceId = hospital.Id);
        var old = new UpdateParticipantInquiryDto { FirstName = inquiry.FirstName, LastName = inquiry.LastName, Source = inquiry.Source, Provenance = "Rang twice" };

        await Controller().Update(inquiry.Id, old, CancellationToken.None);
        Assert.Equal(hospital.Id, Stored(inquiry.Id).ReferralSourceId);

        await Controller().Update(inquiry.Id, Echo(inquiry, null), CancellationToken.None);
        Assert.Null(Stored(inquiry.Id).ReferralSourceId);
    }

    [Fact]
    public async Task Update_with_another_tenants_source_is_400_for_a_SuperAdmin_viewing_as_this_tenant()
    {
        var theirs = Source(_otherTenantId, "Their source");
        var inquiry = Inquiry();

        var result = await Controller(superAdmin: true, role: "SuperAdmin").Update(inquiry.Id, Echo(inquiry, theirs.Id), CancellationToken.None);

        Assert.Equal([Pick], Problems(result.Result)["referralSourceId"]);
        Assert.Null(Stored(inquiry.Id).ReferralSourceId);
    }

    [Fact]
    public async Task Update_of_a_converted_enquiry_saves_the_referral_source()
    {
        var hospital = Source(_tenantId, "Hospital");
        var inquiry = Inquiry(x => x.ParticipantId = Guid.NewGuid());

        var result = await Controller().Update(inquiry.Id, Echo(inquiry, hospital.Id), CancellationToken.None);

        Assert.Equal(hospital.Id, Data<ParticipantInquiryDto>(result.Result).ReferralSourceId);
        Assert.Equal(hospital.Id, Stored(inquiry.Id).ReferralSourceId);
    }

    [Fact]
    public async Task The_list_and_the_closed_view_carry_the_source_name()
    {
        var hospital = Source(_tenantId, "Hospital");
        var open = Inquiry(x => x.ReferralSourceId = hospital.Id);
        var closed = Inquiry(x => { x.ReferralSourceId = hospital.Id; x.ClosedAt = DateTime.UtcNow; x.CloseOutcome = Odip.Domain.Enums.InquiryCloseOutcome.NotGoingAhead; });

        var all = Data<List<ParticipantInquiryDto>>((await Controller().GetAll(CancellationToken.None)).Result);
        var gone = Data<PagedResult<ParticipantInquiryDto>>((await Controller().GetClosed(CancellationToken.None)).Result);

        Assert.Equal("Hospital", Assert.Single(all, x => x.Id == open.Id).ReferralSourceName);
        Assert.Equal("Hospital", Assert.Single(gone.Items, x => x.Id == closed.Id).ReferralSourceName);
    }
}
