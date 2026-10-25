namespace Odip.Application.DTOs;

public class WhatsNewEntryDto
{
    public Guid Id { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public bool Important { get; set; }
    public DateTime PublishedAtUtc { get; set; }
}

/// <summary>What the signed-in person sees: the newest 50 entries for their role, how many are unread, and the important unread ones for the pop-up.</summary>
public class WhatsNewFeedDto
{
    public List<WhatsNewEntryDto> Entries { get; set; } = new();
    public int UnreadCount { get; set; }
    public List<WhatsNewEntryDto> Popup { get; set; } = new();
}

public class AdminWhatsNewEntryDto : WhatsNewEntryDto
{
    public string Key { get; set; } = string.Empty;

    /// <summary>"Admin", "Coordinator", "SupportWorker" and "ReadOnly" (a flags enum would serialise as one comma-joined string).</summary>
    public List<string> Roles { get; set; } = new();

    public DateTime? ArchivedAtUtc { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Create and edit share it. Everything is checked and trimmed by <c>AdminWhatsNewController</c>.</summary>
public class SaveWhatsNewEntryDto
{
    public string? Title { get; set; }
    public string? Body { get; set; }
    public List<string>? Roles { get; set; }
    public bool Important { get; set; }
}
