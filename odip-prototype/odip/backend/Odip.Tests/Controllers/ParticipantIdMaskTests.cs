using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>Participant ID-number masking for SupportWorker and ReadOnly (owner Q1, 2026-10-25).</summary>
public class ParticipantIdMaskTests
{
    private const string Dots = "••••••••";

    // ── T1: the mask rule ────────────────────────────────────────────────

    [Theory]
    [InlineData(null, null)]
    [InlineData("", "")]
    [InlineData("  ", "  ")]
    [InlineData("5", Dots)]
    [InlineData("12", Dots + "2")]
    [InlineData("430000017", Dots + "7")]
    [InlineData("430000017 ", Dots + "7")]
    public void Mask_FormatIsTheListRule(string? input, string? expected) =>
        Assert.Equal(expected, ParticipantIdMask.Mask(input));

    // ── Fixtures ─────────────────────────────────────────────────────────

    private static OdipDbContext CreateDb() => TestDb.Create(Guid.NewGuid().ToString());

    internal static ParticipantsController ControllerFor(OdipDbContext db, string? role)
    {
        var controller = new ParticipantsController(db, new StaffCompatibilityLinkService(db), new ParticipantDocumentService(db), new SafetyNoteSyncService(db));
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = role == null ? new ClaimsPrincipal() : new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, role)], "Test")),
            },
        };
        return controller;
    }

    /// <summary>Gives a controller an office principal (full ID numbers); GetById is fail-closed without one.</summary>
    internal static ParticipantsController AsOffice(ParticipantsController controller)
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Role, "Coordinator")], "Test")) },
        };
        return controller;
    }

    internal static Participant Seed(OdipDbContext db, string? ndis = "430000017", string? taxi = "TXI775534")
    {
        var p = new Participant
        {
            Id = Guid.NewGuid(), FirstName = "Sophie", LastName = "Brown", IsActive = true, NdisNumber = ndis,
            MedicareNumber = "2951123451", MedicareExpiry = new DateOnly(2030, 1, 31), PensionCardNumber = "PEN998877",
            CompanionCardNumber = "CMP556612", PrivateHealthFund = "Medibank", PrivateHealthMembershipNumber = "HFM443323",
            TaxiCardNumber = taxi, MedicalSummary = "Asthma",
        };
        db.Participants.Add(p);
        db.SaveChanges();
        return p;
    }

    private static readonly string[] FullValues = ["430000017", "2951123451", "PEN998877", "CMP556612", "HFM443323", "TXI775534"];

    private static string?[] Numbers(ParticipantDetailDto d) =>
        [d.NdisNumber, d.MedicareNumber, d.PensionCardNumber, d.CompanionCardNumber, d.PrivateHealthMembershipNumber, d.TaxiCardNumber];

    private static async Task<ParticipantDetailDto> Detail(string? role, Guid? taxiNullFor = null)
    {
        using var db = CreateDb();
        var p = Seed(db, taxi: taxiNullFor == null ? "TXI775534" : null);
        var result = await ControllerFor(db, role).GetById(p.Id, CancellationToken.None);
        return Assert.IsType<ApiResponse<ParticipantDetailDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    // ── T1: the list's inline copy of the rule matches the helper ────────

    [Fact]
    public async Task GetAll_MaskedNdisNumber_MatchesTheHelper()
    {
        using var db = CreateDb();
        var cases = new[] { "", "  ", "5", "12", "430000017", "430000017 " };
        foreach (var c in cases) Seed(db, ndis: c);
        var result = await ControllerFor(db, "SupportWorker").GetAll(null, null, null, null, null, null, 1, 50, CancellationToken.None);
        var items = Assert.IsType<ApiResponse<PagedResult<ParticipantListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!.Items;
        Assert.Equal(cases.Select(ParticipantIdMask.Mask).OrderBy(x => x), items.Select(i => i.MaskedNdisNumber).OrderBy(x => x));
    }

    // ── T2 to T4: GetById per role ───────────────────────────────────────

    [Theory]
    [InlineData("SuperAdmin")]
    [InlineData("Admin")]
    [InlineData("Coordinator")]
    public async Task GetById_OfficeRoles_SeeFullNumbers(string role) =>
        Assert.Equal(FullValues, Numbers(await Detail(role)));

    [Theory]
    [InlineData("SupportWorker")]
    [InlineData("ReadOnly")]
    public async Task GetById_SupportWorkerAndReadOnly_SeeMaskedNumbers(string role)
    {
        var d = await Detail(role);
        Assert.Equal(FullValues.Select(ParticipantIdMask.Mask), Numbers(d));
        Assert.All(FullValues, v => Assert.DoesNotContain(v, string.Join('|', Numbers(d))));
        Assert.Equal("Medibank", d.PrivateHealthFund);
        Assert.Equal(new DateOnly(2030, 1, 31), d.MedicareExpiry);
        Assert.Equal("Asthma", d.MedicalSummary);
        Assert.Equal("Sophie", d.FirstName);
        Assert.Equal(ParticipantIdMask.Mask("430000017"), d.MaskedNdisNumber);
        Assert.Null((await Detail(role, taxiNullFor: Guid.Empty)).TaxiCardNumber);
    }

    [Fact]
    public async Task GetById_NoPrincipal_IsMasked() =>
        Assert.Equal(FullValues.Select(ParticipantIdMask.Mask), Numbers(await Detail(null)));

    // ── T5: the three participant PDFs per role ──────────────────────────

    // The longest run of the hash with no 'f': an "ff" or "fi" extracts as a ligature, so a window containing one never matches.
    private static string HashProbe(string hash) =>
        hash.Split('f').OrderByDescending(part => part.Length).First();

    private static string PdfText(byte[] bytes)
    {
        using var pdf = UglyToad.PdfPig.PdfDocument.Open(bytes);
        return string.Concat(pdf.GetPages().Select(p => p.Text)).Replace(" ", "").Replace("\n", "").Replace(((char)0).ToString(), "");
    }

    [Theory]
    [InlineData("SuperAdmin", "intake", false)]
    [InlineData("Admin", "profile", false)]
    [InlineData("Coordinator", "overview", false)]
    [InlineData("SupportWorker", "intake", true)]
    [InlineData("SupportWorker", "profile", true)]
    [InlineData("SupportWorker", "overview", true)]
    [InlineData("ReadOnly", "intake", true)]
    [InlineData("ReadOnly", "profile", true)]
    [InlineData("ReadOnly", "overview", true)]
    [InlineData(null, "profile", true)]
    public async Task DocumentPdfs_PerRole(string? role, string document, bool masked)
    {
        using var db = CreateDb();
        var p = Seed(db);
        var controller = ControllerFor(db, role);
        var result = document switch
        {
            "intake" => await controller.DownloadIntakeFormPdf(p.Id, CancellationToken.None),
            "profile" => await controller.DownloadParticipantProfilePdf(p.Id, CancellationToken.None),
            _ => await controller.DownloadClientOverviewPdf(p.Id, null, CancellationToken.None),
        };
        var text = PdfText(Assert.IsType<FileContentResult>(result).FileContents);

        // Positive control: the office copy carries the full NDIS number, so a broken extractor can't pass the masked checks.
        if (!masked) Assert.Contains("430000017", text);
        if (!masked && document == "profile") Assert.All(FullValues, v => Assert.Contains(v, text));
        if (masked) Assert.All(FullValues, v => Assert.DoesNotContain(v, text));
        if (masked) Assert.Contains("7", text);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task ComposeProfile_MaskFlag_MasksHeaderAndKeyIdentifiersOnly(bool mask)
    {
        using var db = CreateDb();
        var p = Seed(db);
        var model = (await new ParticipantDocumentService(db).ComposeParticipantProfileAsync(p.Id, mask, CancellationToken.None))!;
        string F(string label) => model.Sections.SelectMany(s => s.Fields).Single(f => f.Label == label).Value;
        Assert.Equal(mask ? ParticipantIdMask.Mask("430000017") : "430000017", model.NdisNumber);
        Assert.Equal(mask ? ParticipantIdMask.Mask("2951123451") : "2951123451", F("Medicare Number"));
        Assert.Equal("Medibank", F("Private Health Fund"));
        // The tracked entity is never written to.
        Assert.Equal("2951123451", db.Participants.Single().MedicareNumber);
    }

    // ── T6: the intake completion copy per role ──────────────────────────

    [Theory]
    [InlineData("SuperAdmin", false)]
    [InlineData("Admin", false)]
    [InlineData("Coordinator", false)]
    [InlineData("SupportWorker", true)]
    [InlineData("ReadOnly", true)]
    [InlineData(null, true)]
    public async Task IntakeSnapshot_PerRole(string? role, bool masked)
    {
        using var db = CreateDb();
        var p = Seed(db);
        var snapshot = await new ParticipantIntakeSnapshotService(db).CaptureAsync(p, "tester", null, CancellationToken.None);
        var (json, hash, pdf) = (snapshot.SnapshotJson, snapshot.ContentHash, snapshot.PdfContent.ToArray());

        // Decisive check on the string: 7pt unspaced JSON can wrap mid-number in the PDF text.
        var maskedJson = ParticipantIntakeSnapshotService.MaskSnapshotJson(json);
        Assert.DoesNotContain("430000017", maskedJson);
        Assert.Contains("\"ndisNumber\":\"" + Dots + "7\"", maskedJson);

        // Positive control: the stored office copy carries the new title. The 8pt hash line does not extract reliably, so the hash itself is a negative check only.
        var stored = PdfText(pdf);
        var probe = HashProbe(hash);
        Assert.Equal(64, hash.Length);
        Assert.Contains("BunyaSupportIntakeComple", stored); // the "ti" ligature extracts as NUL

        var result = await ControllerFor(db, role).DownloadIntakeSnapshotPdf(p.Id, snapshot.Revision, CancellationToken.None);
        var bytes = Assert.IsType<FileContentResult>(result).FileContents;
        if (!masked) { Assert.True(bytes.SequenceEqual(pdf)); }
        else
        {
            var text = PdfText(bytes);
            Assert.DoesNotContain("430000017", text);
            Assert.DoesNotContain("SHA-256", text);
            Assert.DoesNotContain(probe, text);
            Assert.Contains("BunyaSupportintakecomple", text);
            Assert.Contains("copy", text);
            Assert.Contains("hiddenforyourrole", text);
        }

        // The stored evidence is never changed.
        var row = db.ParticipantIntakeSnapshots.AsNoTracking().Single();
        Assert.Equal(json, row.SnapshotJson);
        Assert.Equal(hash, row.ContentHash);
        Assert.True(row.PdfContent.SequenceEqual(pdf));
    }

    [Fact]
    public void IntakeSnapshotDto_HasOnlyRevisionAndCompletedAt() =>
        Assert.Equal(["CompletedAtUtc", "Revision"], typeof(ParticipantIntakeSnapshotDto).GetProperties().Select(x => x.Name).Order());

    // ── T8: every participant write is office-only ───────────────────────

    [Fact]
    public void ParticipantWrites_AreOfficeOnly()
    {
        var bound = new[] { typeof(CreateParticipantDto), typeof(UpdateParticipantDto), typeof(PatchParticipantDto) };
        var writes = typeof(ParticipantsController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => m.GetParameters().Any(p => bound.Contains(p.ParameterType))).ToList();
        Assert.NotEmpty(writes);
        foreach (var m in writes)
        {
            var roles = m.GetCustomAttributes<AuthorizeAttribute>().Single().Roles;
            Assert.Equal("Admin,Coordinator,SuperAdmin", roles);
        }
    }

    // ── T9: a masked value is rejected on every write DTO ────────────────

    public static IEnumerable<object[]> GuardedProperties() =>
        new[] { typeof(CreateParticipantDto), typeof(UpdateParticipantDto), typeof(PatchKeyIdentifiersDto), typeof(PatchNdisPlanDto) }
            .SelectMany(t => ParticipantIdMask.PropertyNames
                .Where(n => t.GetProperty(n) != null).Select(n => new object[] { t, n }));

    [Theory]
    [MemberData(nameof(GuardedProperties))]
    public void MaskedValue_IsRejected_OnEveryWriteDto(Type type, string property)
    {
        Assert.NotNull(type.GetProperty(property)!.GetCustomAttribute<NoMaskedIdAttribute>());
        Assert.Contains(property, Errors(type, property, Dots + "7"));
        Assert.Empty(Errors(type, property, "430000017"));
        Assert.Empty(Errors(type, property, ""));
        Assert.Empty(Errors(type, property, null));
    }

    [Fact]
    public void GuardedProperties_CoverEveryIdNumberOnTheWriteDtos()
    {
        Assert.Equal(6, GuardedProperties().Count(a => (Type)a[0] == typeof(CreateParticipantDto)));
        Assert.Equal(1, GuardedProperties().Count(a => (Type)a[0] == typeof(PatchNdisPlanDto)));
        Assert.Equal(5, GuardedProperties().Count(a => (Type)a[0] == typeof(PatchKeyIdentifiersDto)));
    }

    private static List<string> Errors(Type type, string property, string? value)
    {
        var dto = Activator.CreateInstance(type)!;
        type.GetProperty(property)!.SetValue(dto, value); // init-only: reflection still sets it
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true);
        return results.SelectMany(r => r.MemberNames).ToList();
    }
}
