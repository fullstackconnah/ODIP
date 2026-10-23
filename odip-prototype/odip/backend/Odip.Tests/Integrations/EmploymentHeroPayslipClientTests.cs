using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.Extensions.Configuration;
using Odip.Infrastructure.Integrations;
using Xunit;
using static Odip.Tests.Integrations.StubHttpHandler;

namespace Odip.Tests.Integrations;

/// <summary>The two payslip calls: dates only from the list, the PDF read by its bytes (raw or base64), capped, and every failure mapped like the rest of the client.</summary>
public class EmploymentHeroPayslipClientTests
{
    private const string Key = EhFixture.ApiKey;
    private const string ListPath = "/api/v2/ess/42/document/payslip";
    private const string PdfPath = "/api/v2/ess/42/document/payslip/9001";
    private static readonly byte[] Pdf = Encoding.ASCII.GetBytes("%PDF-1.7 payslip 1234.56 %%EOF");

    private static EmploymentHeroClient ClientFor(HttpMessageHandler h) => new(new HttpClient(h), new ConfigurationBuilder().Build());

    /// <summary>Answers any request with the given response; the content is made fresh each time.</summary>
    private sealed class OneAnswer(Func<HttpResponseMessage> answer) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) => Task.FromResult(answer());
    }

    /// <summary>A body with no Content-Length: a prefix, then 'a' up to total bytes, then optionally an IOException.</summary>
    private sealed class GeneratedStream(byte[] prefix, long total, bool thenThrow) : Stream
    {
        private long _pos;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => _pos; set => throw new NotSupportedException(); }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_pos >= total) { if (thenThrow) throw new IOException("connection reset"); return 0; }
            var n = (int)Math.Min(count, total - _pos);
            for (var i = 0; i < n; i++) buffer[offset + i] = _pos + i < prefix.Length ? prefix[_pos + i] : (byte)'a';
            _pos += n;
            return n;
        }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private static HttpResponseMessage Raw(byte[] body, string contentType) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(body) { Headers = { ContentType = new MediaTypeHeaderValue(contentType) } } };

    private static HttpResponseMessage Streamed(Stream s) => new(HttpStatusCode.OK) { Content = new StreamContent(s) };

    [Fact]
    public async Task Lists_one_employees_payslips_with_dates_and_schedule_only()
    {
        var eh = new StubHttpHandler().On(ListPath, HttpStatusCode.OK, new[]
        {
            new { id = 9001, employeeId = 42, paySchedule = "Fortnightly", datePaid = "2026-10-08T00:00:00", payPeriodStart = "2026-09-22T00:00:00", payPeriodEnd = "2026-10-05T00:00:00", netPay = 1234.56, payerAbn = "12 345 678 901" },
            new { id = 9000, employeeId = 42, paySchedule = "Fortnightly", datePaid = "2026-09-24T00:00:00", payPeriodStart = "2026-09-08T00:00:00", payPeriodEnd = "2026-09-21T00:00:00", netPay = 1200.10, payerAbn = "12 345 678 901" },
        });

        var slips = await Client(eh).ListPayslipsAsync(Key, "42", CancellationToken.None);

        Assert.Equal(2, slips.Count);
        Assert.Equal(new EhPayslip(9001, new DateTime(2026, 10, 8), new DateTime(2026, 9, 22), new DateTime(2026, 10, 5), "Fortnightly"), slips[0]);
        // No figure can ever be bound: the record has exactly these properties.
        Assert.Equal(new[] { "DatePaid", "Id", "PayPeriodEnd", "PayPeriodStart", "PaySchedule" }, typeof(EhPayslip).GetProperties().Select(p => p.Name).Order().ToArray());
        var request = Assert.Single(eh.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal(ListPath, request.RequestUri!.AbsolutePath);
        Assert.Equal("Basic", request.Headers.Authorization!.Scheme);
        Assert.Equal(Convert.ToBase64String(Encoding.UTF8.GetBytes(EhFixture.ApiKey + ":")), request.Headers.Authorization.Parameter);
    }

    [Fact]
    public async Task Reads_the_pdf_sent_as_base64_json()
    {
        var eh = new StubHttpHandler().On(PdfPath, HttpStatusCode.OK, Convert.ToBase64String(Pdf));

        var bytes = await Client(eh).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None);

        Assert.Equal(Pdf, bytes);
        Assert.Equal(PdfPath, Assert.Single(eh.Requests).RequestUri!.AbsolutePath);
    }

    [Fact]
    public async Task Reads_a_raw_pdf_body_as_it_is()
    {
        var bytes = await ClientFor(new OneAnswer(() => Raw(Pdf, "application/pdf"))).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None);

        Assert.Equal(Pdf, bytes);
    }

    [Theory]
    [InlineData(false, "application/json")] // a raw PDF under a json Content-Type
    [InlineData(true, "text/plain")]        // bare base64 under text/plain
    public async Task Reads_the_pdf_whatever_the_Content_Type_says(bool base64, string contentType)
    {
        var body = base64 ? Encoding.ASCII.GetBytes(Convert.ToBase64String(Pdf)) : Pdf;

        var bytes = await ClientFor(new OneAnswer(() => Raw(body, contentType))).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None);

        Assert.Equal(Pdf, bytes);
    }

    public static IEnumerable<object[]> NotPdfBodies() => new[]
    {
        new object[] { "base64 of html" },
        new object[] { "json string, not base64" },
        new object[] { "raw pdf over 10 MB" },
        new object[] { "chunked body over the read cap" },
        new object[] { "stream that throws part-way" },
    };

    private static byte[] RawPdfOfLength(int length)
    {
        var body = new byte[length];
        Array.Fill(body, (byte)'a');
        "%PDF-"u8.CopyTo(body);
        return body;
    }

    [Theory]
    [MemberData(nameof(NotPdfBodies))]
    public async Task Something_that_is_not_a_pdf_throws_Unavailable(string which)
    {
        HttpMessageHandler handler = which switch
        {
            "base64 of html" => new OneAnswer(() => Raw(Encoding.ASCII.GetBytes("\"" + Convert.ToBase64String(Encoding.ASCII.GetBytes("<html>")) + "\""), "application/json")),
            "json string, not base64" => new OneAnswer(() => Raw(Encoding.ASCII.GetBytes("\"not base64 !!\""), "application/json")),
            "raw pdf over 10 MB" => new OneAnswer(() => Raw(RawPdfOfLength(10 * 1024 * 1024 + 1), "application/pdf")),
            "chunked body over the read cap" => new OneAnswer(() => Streamed(new GeneratedStream("%PDF-"u8.ToArray(), 20L * 1024 * 1024, false))),
            _ => new OneAnswer(() => Streamed(new GeneratedStream("%PDF-"u8.ToArray(), 100_000, true))),
        };

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => ClientFor(handler).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.Unavailable, ex.Failure);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, EmploymentHeroFailure.KeyRefused)]
    [InlineData(HttpStatusCode.NotFound, EmploymentHeroFailure.BusinessNotFound)]
    [InlineData(HttpStatusCode.TooManyRequests, EmploymentHeroFailure.RateLimited)]
    [InlineData(HttpStatusCode.InternalServerError, EmploymentHeroFailure.Unavailable)]
    public async Task Payslip_failures_map_like_every_other_call(HttpStatusCode status, EmploymentHeroFailure expected)
    {
        var eh = new StubHttpHandler().On(PdfPath, status);

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => Client(eh).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None));

        Assert.Equal(expected, ex.Failure);
        Assert.DoesNotContain(Key, ex.Message);
    }

    [Fact]
    public async Task A_payslip_call_that_cannot_reach_EH_is_Unavailable()
    {
        var eh = new StubHttpHandler().OnThrow(PdfPath, new HttpRequestException());

        var ex = await Assert.ThrowsAsync<EmploymentHeroException>(() => Client(eh).GetPayslipPdfAsync(Key, "42", 9001, CancellationToken.None));

        Assert.Equal(EmploymentHeroFailure.Unavailable, ex.Failure);
    }
}
