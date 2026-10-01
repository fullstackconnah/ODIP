using System.ComponentModel.DataAnnotations;
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

namespace Odip.Tests.Controllers;

/// <summary>
/// Fix A: the Enquiries tab and the enquiry form. A prospect with no email address could not be captured (the form posted "",
/// and [EmailAddress] rejects it), and a converted enquiry said "Draft intake" with a "Resume intake" button for ever because
/// the list carried nothing about the participant it became (L1-10, L2-14).
/// </summary>
public class ParticipantInquiryLifecycleTests
{
    private static (OdipDbContext Db, ParticipantInquiriesController Controller, Guid TenantId) Create()
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.SetupGet(x => x.TenantId).Returns(tenantId);
        tenant.SetupGet(x => x.IsSuperAdmin).Returns(false);
        var db = new OdipDbContext(new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant.Object);
        return (db, new ParticipantInquiriesController(db, tenant.Object), tenantId);
    }

    private static T Ok<T>(ActionResult<ApiResponse<T>> result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static List<ValidationResult> Validate(object dto)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results;
    }

    // ── L1-10: no email is a valid enquiry ─────────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("ada@example.test")]
    [InlineData("  ada@example.test  ")]
    public void TheEmailMayBeLeftBlank_OrBeAValidAddress(string? email)
    {
        var dto = new CreateParticipantInquiryDto { FirstName = "Ada", LastName = "Lovelace", Source = "Phone", Email = email };

        Assert.Empty(Validate(dto));
    }

    [Theory]
    [InlineData("not-an-email")]
    [InlineData("ada@")]
    [InlineData("@example.test")]
    public void ANonBlankEmail_StillHasToBeAValidAddress(string email)
    {
        var dto = new CreateParticipantInquiryDto { FirstName = "Ada", LastName = "Lovelace", Source = "Phone", Email = email };

        Assert.Contains(Validate(dto), r => r.MemberNames.Contains(nameof(CreateParticipantInquiryDto.Email)));
    }

    [Fact]
    public async Task Create_StoresBlankEmailPhoneAndProvenanceAsNothing_NotAsEmptyStrings()
    {
        var (db, controller, _) = Create();
        using var _ = db;

        var created = Ok(await controller.Create(new CreateParticipantInquiryDto
        {
            FirstName = "Ada", LastName = "Lovelace", Source = "Phone", Email = "", Phone = "  ", Provenance = "",
        }, CancellationToken.None));

        Assert.Null(created.Email);
        Assert.Null(created.Phone);
        Assert.Null(created.Provenance);
        var stored = await db.ParticipantInquiries.SingleAsync();
        Assert.Null(stored.Email);
        Assert.Null(stored.Phone);
        Assert.Null(stored.Provenance);
    }

    [Fact]
    public async Task Update_StoresBlankEmailAsNothing_AndTrimsWhatItKeeps()
    {
        var (db, controller, tenantId) = Create();
        using var _ = db;
        var inquiry = new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ada", LastName = "Lovelace", Email = "ada@example.test", Phone = "0400", Source = "Web", Provenance = "Dr Patel" };
        db.ParticipantInquiries.Add(inquiry);
        await db.SaveChangesAsync();

        var updated = Ok(await controller.Update(inquiry.Id, new UpdateParticipantInquiryDto
        {
            FirstName = "Ada", LastName = "Lovelace", Source = "Web", Email = "", Phone = " 0400 111 ", Provenance = "  Dr Patel, Brisbane  ",
        }, CancellationToken.None));

        Assert.Null(updated.Email);
        Assert.Equal("0400 111", updated.Phone);
        Assert.Equal("Dr Patel, Brisbane", updated.Provenance);
    }

    // ── L2-14: what a converted enquiry has become ─────────────────────────────────────────

    [Fact]
    public async Task GetAll_CarriesTheLinkedParticipantsLifecycleState()
    {
        var (db, controller, tenantId) = Create();
        using var _ = db;
        var completedAt = new DateTime(2026, 9, 20, 3, 0, 0, DateTimeKind.Utc);
        var draftNoIntake = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "Draft", IsDraft = true, IsActive = false };
        var draftIntakeDone = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "B", LastName = "Intake", IsDraft = true, IsActive = false, IntakeCompletedAt = completedAt };
        var finalised = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "C", LastName = "Final", IsDraft = false, IsActive = true, IntakeCompletedAt = completedAt };
        db.Participants.AddRange(draftNoIntake, draftIntakeDone, finalised);
        db.ParticipantInquiries.AddRange(
            new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "New", LastName = "Enquiry", Source = "Phone" },
            new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "A", LastName = "Draft", Source = "Phone", ParticipantId = draftNoIntake.Id },
            new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "B", LastName = "Intake", Source = "Phone", ParticipantId = draftIntakeDone.Id },
            new ParticipantInquiry { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "C", LastName = "Final", Source = "Phone", ParticipantId = finalised.Id });
        await db.SaveChangesAsync();

        var rows = Ok(await controller.GetAll(CancellationToken.None)).ToDictionary(r => r.LastName);

        Assert.Null(rows["Enquiry"].ParticipantIsDraft);
        Assert.Null(rows["Enquiry"].ParticipantIsActive);
        Assert.Null(rows["Enquiry"].ParticipantIntakeCompletedAt);
        Assert.Equal(true, rows["Draft"].ParticipantIsDraft);
        Assert.Equal(false, rows["Draft"].ParticipantIsActive);
        Assert.Null(rows["Draft"].ParticipantIntakeCompletedAt);
        Assert.Equal(true, rows["Intake"].ParticipantIsDraft);
        Assert.Equal(completedAt, rows["Intake"].ParticipantIntakeCompletedAt);
        Assert.Equal(false, rows["Final"].ParticipantIsDraft);
        Assert.Equal(true, rows["Final"].ParticipantIsActive);
    }
}
