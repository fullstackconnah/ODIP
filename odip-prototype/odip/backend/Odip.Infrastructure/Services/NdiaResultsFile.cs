using System.Globalization;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>One readable row of the NDIA's results file. Row is the file's own row number, header = 1.</summary>
public sealed record ResultRow(int Row, string Reference, ClaimBatchLineOutcome Outcome, string? Code, string? Message, decimal? Amount);

public sealed record UnreadRow(int Row, string Value, string Note);

/// <summary>What was read: the rows, the rows that could not be, or one refusal (<see cref="Error"/>) for the whole file.</summary>
public sealed record ResultsParse(IReadOnlyList<ResultRow> Rows, IReadOnlyList<UnreadRow> Unread, string? Error);

public static class NdiaResultsFile
{
    // shortcut: the aliases are guesses until the owner's real header row arrives; update this table then.
    private static readonly string[] Reference = ["claimreference", "claimref", "reference", "yourreference", "providerreference"];
    private static readonly string[] Result = ["status", "result", "outcome", "claimstatus", "paymentrequeststatus", "requeststatus"];
    private static readonly string[] Code = ["errorcode", "rejectcode", "rejectioncode", "reasoncode", "rejectreasoncode", "code"];
    private static readonly string[] Message = ["errormessage", "message", "rejectionreason", "rejectreason", "reason", "description", "errordescription"];
    private static readonly string[] Amount = ["paidamount", "amountpaid", "paymentamount"];

    private static readonly string[] Successful = ["successful", "success", "accepted", "approved", "pendingpayment", "paid"];
    private static readonly string[] Rejected = ["rejected", "reject", "error", "failed", "invalid"];

    private static string Normalise(string header) =>
        new(header.Trim().ToLowerInvariant().Where(c => c is not (' ' or '_' or '-' or '.')).ToArray());

    public static ResultsParse Parse(byte[] bytes)
    {
        List<IReadOnlyList<string>> records;
        try { records = ImportCsvReader.Read(bytes).Records; }
        catch (ImportException)
        {
            return Refuse("This file isn't readable text. Download the results file from the portal again and upload it unchanged.");
        }

        var headerIndex = records.FindIndex(r => r.Count > 0);
        if (headerIndex < 0) return Refuse("We couldn't read this results file. It has no rows.");
        var header = records[headerIndex].Select(Normalise).ToList();

        // Each role must find exactly one column; nothing is guessed.
        var columns = new Dictionary<string, int>();
        var missing = new List<string>();
        foreach (var (role, aliases, required) in new[] { ("reference", Reference, true), ("result", Result, true), ("code", Code, true), ("message", Message, false), ("amount", Amount, false) })
        {
            var hits = header.Select((h, i) => (h, i)).Where(x => aliases.Contains(x.h)).Select(x => x.i).ToList();
            if (hits.Count == 1) columns[role] = hits[0];
            else if (hits.Count > 1 || required) missing.Add(role);
        }
        if (missing.Count > 0)
            return Refuse($"We couldn't read this results file. We expected columns for {string.Join(", ", missing)}, but found: {string.Join(", ", records[headerIndex].Select(h => h.Trim()))}.");

        string Cell(IReadOnlyList<string> r, string role) => columns.TryGetValue(role, out var i) && i < r.Count ? r[i].Trim() : "";

        var rows = new List<ResultRow>();
        var unread = new List<UnreadRow>();
        for (var i = headerIndex + 1; i < records.Count; i++)
        {
            var r = records[i];
            if (r.Count == 0) continue;
            var number = i + 1;
            var reference = Cell(r, "reference");
            var raw = Cell(r, "result");
            var key = Normalise(raw);
            if (reference.Length == 0) { unread.Add(new UnreadRow(number, raw, "No claim reference.")); continue; }
            ClaimBatchLineOutcome outcome;
            if (Successful.Contains(key)) outcome = ClaimBatchLineOutcome.Successful;
            else if (Rejected.Contains(key)) outcome = ClaimBatchLineOutcome.Rejected;
            else { unread.Add(new UnreadRow(number, raw, "We don't know this result.")); continue; }

            decimal? amount = null;
            var amountText = Cell(r, "amount").Replace("$", "").Replace(",", "");
            if (amountText.Length > 0)
            {
                if (decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)) amount = parsed;
                else unread.Add(new UnreadRow(number, Cell(r, "amount"), "The amount couldn't be read; the result still applies."));
            }
            var code = Cell(r, "code");
            var message = Cell(r, "message");
            rows.Add(new ResultRow(number, reference, outcome, code.Length == 0 ? null : code, message.Length == 0 ? null : message, amount));
        }
        return new ResultsParse(rows, unread, null);

        static ResultsParse Refuse(string error) => new([], [], error);
    }
}
