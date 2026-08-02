using Odip.Domain.Interfaces;

namespace Odip.Domain.Dictionary;

/// <summary>
/// A single section within a <see cref="FormTemplate"/>, listing the dictionary
/// field IDs to render, in order.
/// </summary>
public class FormSection
{
    /// <summary>Section heading shown to the user.</summary>
    public string Title { get; set; } = string.Empty;

    /// <summary>
    /// The <see cref="FieldDefinition.FieldId"/> values to render in this section, in display order.
    /// </summary>
    public List<string> FieldIds { get; set; } = new();
}

/// <summary>
/// Minimal skeleton of a renderable form, built from one or more <see cref="FormSection"/>s
/// of dictionary field IDs. This is the seed of the forms engine (see plan doc 02 §6):
/// later work will add validation rules, conditional visibility, and layout metadata
/// on top of this shape.
/// </summary>
public class FormTemplate : ITenantEntity
{
    /// <summary>Surrogate primary key.</summary>
    public Guid Id { get; set; }

    /// <summary>Owning tenant. Auto-populated by OdipDbContext.SaveChangesAsync.</summary>
    public Guid TenantId { get; set; }

    /// <summary>Form name (e.g. "Risk Assessment").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Optional description of the form's purpose.</summary>
    public string? Description { get; set; }

    /// <summary>The form's sections, in display order.</summary>
    public List<FormSection> Sections { get; set; } = new();

    /// <summary>
    /// Builds a single-section <see cref="FormTemplate"/> from every <see cref="FieldDefinition"/>
    /// whose <see cref="FieldDefinition.AppearsInForms"/> contains <paramref name="formName"/>
    /// (case-insensitive substring match), preserving the order the definitions were supplied in.
    /// </summary>
    /// <param name="formName">The form name to match against each field's appearsIn list.</param>
    /// <param name="defs">The candidate field definitions, typically the full dictionary for a tenant.</param>
    public static FormTemplate FromAppearsIn(string formName, IEnumerable<FieldDefinition> defs)
    {
        var fieldIds = defs
            .Where(def => def.AppearsInForms.Any(form =>
                form.Contains(formName, StringComparison.OrdinalIgnoreCase)))
            .Select(def => def.FieldId)
            .ToList();

        return new FormTemplate
        {
            Id = Guid.NewGuid(),
            Name = formName,
            Sections = new List<FormSection>
            {
                new()
                {
                    Title = formName,
                    FieldIds = fieldIds
                }
            }
        };
    }
}
