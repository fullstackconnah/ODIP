using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace Odip.Infrastructure.Integrations;

/// <summary>A payslip as EH's employee self-service list gives it: when it was paid, the period and the schedule. Net pay and the payer are in the PDF; ODIP never reads them.</summary>
public sealed record EhPayslip(int Id, DateTime? DatePaid, DateTime? PayPeriodStart, DateTime? PayPeriodEnd, string? PaySchedule);

public partial class EmploymentHeroClient
{
    // A payslip is a page or two. The read stops past the base64 size of this, so nothing bigger is ever buffered.
    private const int MaxPayslipBytes = 10 * 1024 * 1024;
    private const string NotAPayslipMessage = "Employment Hero sent a payslip Bunya Support couldn't open.";

    public Task<List<EhPayslip>> ListPayslipsAsync(string apiKey, string employeeId, CancellationToken ct) =>
        GetAsync<List<EhPayslip>>(apiKey, $"api/v2/ess/{Uri.EscapeDataString(employeeId)}/document/payslip", ct);

    /// <summary>One pay run's payslip PDF, straight from EH and never kept. The swagger types it Byte[]; it is read by its bytes, raw or base64.</summary>
    public async Task<byte[]> GetPayslipPdfAsync(string apiKey, string employeeId, int payRunId, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get,
            $"api/v2/ess/{Uri.EscapeDataString(employeeId)}/document/payslip/{payRunId.ToString(CultureInfo.InvariantCulture)}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(apiKey + ":")));
        try
        {
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            // The one status map: SendAsync uses it too (after its own 400 and 429 Retry-After handling).
            ThrowForStatus(response);
            var body = await ReadCappedAsync(response.Content, MaxPayslipBytes / 3 * 4 + 1024, ct);
            // By the bytes, not the Content-Type: produces lists json, xml, text/plain and octet-stream.
            var pdf = body.AsSpan().StartsWith("%PDF-"u8) ? body : FromBase64(body);
            if (pdf.Length > MaxPayslipBytes || !pdf.AsSpan().StartsWith("%PDF-"u8)) throw NotAPayslip();
            return pdf;
        }
        // A drop or timeout part-way through the body is the same "couldn't be reached" as one before it. EmploymentHeroException passes through.
        catch (Exception ex) when (ex is HttpRequestException or IOException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, "Employment Hero couldn't be reached. Try again in a few minutes.");
        }
    }

    private static void ThrowForStatus(HttpResponseMessage response)
    {
        switch (response.StatusCode)
        {
            case HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden:
                throw new EmploymentHeroException(EmploymentHeroFailure.KeyRefused, "Employment Hero didn't accept the API key. Check it in Employment Hero and connect again.");
            case HttpStatusCode.NotFound:
                throw new EmploymentHeroException(EmploymentHeroFailure.BusinessNotFound, "Employment Hero couldn't find that business or employee for this API key.");
            case HttpStatusCode.TooManyRequests:
                throw new EmploymentHeroException(EmploymentHeroFailure.RateLimited, "Employment Hero is busy. Bunya Support tries again at the next sync.");
        }
        if (!response.IsSuccessStatusCode)
            throw new EmploymentHeroException(EmploymentHeroFailure.Unavailable, $"Employment Hero answered with an error ({(int)response.StatusCode}). Try again in a few minutes.");
    }

    private static async Task<byte[]> ReadCappedAsync(HttpContent content, int cap, CancellationToken ct)
    {
        await using var stream = await content.ReadAsStreamAsync(ct);
        using var copy = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (copy.Length + read > cap) throw NotAPayslip();
            copy.Write(buffer, 0, read);
        }
        return copy.ToArray();
    }

    /// <summary>EH's Byte[]: a JSON string of base64, or the base64 text on its own.</summary>
    private static byte[] FromBase64(byte[] body)
    {
        try
        {
            var text = Encoding.UTF8.GetString(body).Trim();
            if (text.StartsWith('"')) text = JsonSerializer.Deserialize<string>(text) ?? "";
            return Convert.FromBase64String(text);
        }
        catch (Exception ex) when (ex is JsonException or FormatException) { throw NotAPayslip(); }
    }

    private static EmploymentHeroException NotAPayslip() => new(EmploymentHeroFailure.Unavailable, NotAPayslipMessage);
}

public static class EmploymentHeroClientLogging
{
    /// <summary>HttpClient's own category for the typed client.</summary>
    public const string Category = "System.Net.Http.HttpClient.EmploymentHeroClient";

    /// <summary>Keeps each EH request URL (it names the employee and the pay run) out of the Information log.</summary>
    public static ILoggingBuilder QuietEmploymentHeroClient(this ILoggingBuilder logging) => logging.AddFilter(Category, LogLevel.Warning);
}
