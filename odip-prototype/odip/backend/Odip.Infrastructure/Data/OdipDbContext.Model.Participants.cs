using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

public partial class OdipDbContext
{
    private void ConfigureParticipants(ModelBuilder modelBuilder)
    {
        // ── Participant ──────────────────────────────────────────
        modelBuilder.Entity<Participant>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.PreferredName).HasMaxLength(100);
            entity.Property(e => e.NdisNumber).HasMaxLength(20);
            entity.Property(e => e.Region).HasMaxLength(100);
            entity.Property(e => e.FundingOrganisation).HasMaxLength(200);
            entity.Property(e => e.MobilitySupportOptions).HasColumnType("text[]");
            // DIAG-01
            entity.Property(e => e.PrimaryDiagnosis).HasMaxLength(200);
            entity.Property(e => e.OtherDiagnoses).HasColumnType("text[]");
            // LIVING-02/03/04
            entity.Property(e => e.MainSupportPersonName).HasMaxLength(200);
            entity.Property(e => e.MainSupportPersonRelationship).HasMaxLength(100);
            entity.Property(e => e.WhoLivesWith).HasMaxLength(2000);
            entity.Property(e => e.SilProviderName).HasMaxLength(200);
            entity.Property(e => e.SilProviderContactPhone).HasMaxLength(20);
            entity.Property(e => e.AccommodationType).HasMaxLength(100);
            entity.Property(e => e.OnSiteSupportHours).HasMaxLength(100);
            entity.Property(e => e.LivingArrangementNotes).HasMaxLength(2000);
            // INTAKE-06
            entity.Property(e => e.AddressStreet).HasMaxLength(200);
            entity.Property(e => e.AddressSuburb).HasMaxLength(100);
            entity.Property(e => e.AddressState).HasMaxLength(10);
            entity.Property(e => e.AddressPostcode).HasMaxLength(4);
            // INTAKE sub-wave A — Participant Details additions.
            entity.Property(e => e.MiddleName).HasMaxLength(100);
            entity.Property(e => e.PlaceOfBirth).HasMaxLength(200);
            entity.Property(e => e.Country).HasMaxLength(100);
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Email).HasMaxLength(200);
            // INTAKE sub-wave A — Key Identifiers step.
            entity.Property(e => e.PensionCardNumber).HasMaxLength(50);
            entity.Property(e => e.MedicareNumber).HasMaxLength(50);
            entity.Property(e => e.CompanionCardNumber).HasMaxLength(50);
            entity.Property(e => e.PrivateHealthFund).HasMaxLength(100);
            entity.Property(e => e.PrivateHealthMembershipNumber).HasMaxLength(50);
            entity.Property(e => e.TaxiCardNumber).HasMaxLength(50);
            entity.Property(e => e.HairColour).HasMaxLength(50);
            entity.Property(e => e.EyeColour).HasMaxLength(50);
            entity.Property(e => e.WeightKg).HasPrecision(5, 2);
            entity.Property(e => e.HeightCm).HasPrecision(5, 2);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.IsActive);
            entity.HasIndex(e => e.Region);
            entity.HasIndex(e => e.NdisNumber);
            entity.HasIndex(e => e.SupportRatio);
        });

        // ── Contact ──────────────────────────────────────────────
        modelBuilder.Entity<Contact>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.Mobile).HasMaxLength(20);
            entity.Property(e => e.Phone).HasMaxLength(20);
            entity.Property(e => e.Organisation).HasMaxLength(200);
            entity.Property(e => e.RoleRelationship).HasMaxLength(100);
            entity.Property(e => e.Suburb).HasMaxLength(100);
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Postcode).HasMaxLength(10);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.IsActive);
        });

        // ── ParticipantContact (M:N join) ────────────────────────
        modelBuilder.Entity<ParticipantContact>(entity =>
        {
            entity.HasKey(e => new { e.ParticipantId, e.ContactId });

            entity.HasOne(e => e.Participant)
                .WithMany(p => p.ParticipantContacts)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Contact)
                .WithMany(c => c.ParticipantContacts)
                .HasForeignKey(e => e.ContactId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // ── Person (CONTACT-01/02/03) ─────────────────────────────
        modelBuilder.Entity<Person>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.FirstName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.LastName).HasMaxLength(100).IsRequired();
            entity.Property(e => e.Phone).HasMaxLength(30);
            entity.Property(e => e.Mobile).HasMaxLength(30);
            entity.Property(e => e.Email).HasMaxLength(200);
            entity.Property(e => e.AddressLine).HasMaxLength(200);
            entity.Property(e => e.Suburb).HasMaxLength(100);
            entity.Property(e => e.State).HasMaxLength(10);
            entity.Property(e => e.Postcode).HasMaxLength(4);
            entity.Property(e => e.Organisation).HasMaxLength(200);
            entity.Property(e => e.Notes).HasMaxLength(2000);
            entity.Ignore(e => e.FullName);

            entity.HasIndex(e => e.LastName);
        });

        // ── ParticipantContactRole (CONTACT-01/02/03) ─────────────
        modelBuilder.Entity<ParticipantContactRole>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.RelationshipToParticipant).HasMaxLength(100);
            entity.Property(e => e.AppointingTribunal).HasMaxLength(50);
            entity.Property(e => e.OrderScopeDomains).HasColumnType("text[]");
            entity.Property(e => e.ReasonForAppointment).HasMaxLength(500);
            entity.Property(e => e.AlternateRepresentativeName).HasMaxLength(200);
            entity.Property(e => e.FundingLineItemType).HasMaxLength(100);
            entity.Property(e => e.OrganisationName).HasMaxLength(200);
            entity.Property(e => e.RegistrationNumber).HasMaxLength(100);
            entity.Property(e => e.Discipline).HasMaxLength(100);
            entity.Property(e => e.FrequencyOfContact).HasMaxLength(200);
            entity.Property(e => e.RoleTitle).HasMaxLength(100);
            entity.Property(e => e.ScopeNotes).HasMaxLength(500);
            entity.Property(e => e.AuthorisationDocumentReference).HasMaxLength(200);
            entity.Property(e => e.PreferredLanguage).HasMaxLength(100);
            entity.Property(e => e.Notes).HasMaxLength(2000);

            // Restrict, same idiom as ParticipantNote/ParticipantRoutine/ParticipantRiskEntry →
            // Participant — a participant with contact-role history must not be silently
            // cascade-deleted out from under it.
            entity.HasOne(e => e.Participant)
                .WithMany(p => p.ContactRoles)
                .HasForeignKey(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Restrict);

            // Restrict, not Cascade: a Person referenced by role rows must not silently disappear
            // rows out from under an audit trail — the frontend blocks deleting a Person still in
            // use instead (there is no Person delete endpoint at all for CONTACT-01's MVP).
            entity.HasOne(e => e.Person)
                .WithMany(p => p.ContactRoles)
                .HasForeignKey(e => e.PersonId)
                .OnDelete(DeleteBehavior.Restrict);

            entity.HasIndex(e => e.ParticipantId);
            entity.HasIndex(e => e.PersonId);
            entity.HasIndex(e => e.RoleType);
        });

        // ── SupportProfile (1:1 with Participant) ────────────────
        modelBuilder.Entity<SupportProfile>(entity =>
        {
            entity.HasKey(e => e.Id);

            entity.HasOne(e => e.Participant)
                .WithOne(p => p.SupportProfile)
                .HasForeignKey<SupportProfile>(e => e.ParticipantId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasIndex(e => e.ParticipantId).IsUnique();
        });

        // ── ParticipantGroupRevision (one row per participant section) ──
        modelBuilder.Entity<ParticipantGroupRevision>(e =>
        {
            e.HasKey(x => new { x.ParticipantId, x.GroupKey });
            e.Property(x => x.GroupKey).HasMaxLength(40);
            e.Property(x => x.Revision).IsConcurrencyToken();
            e.HasOne<Participant>().WithMany().HasForeignKey(x => x.ParticipantId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
