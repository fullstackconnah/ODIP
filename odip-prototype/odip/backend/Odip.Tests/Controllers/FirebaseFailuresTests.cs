using Odip.Api.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Which Firebase failure means "this address is malformed" (the admin can correct it) and which do not (retrying is no promise). The
/// exceptions are built by the SDK's own error handler from a backend response body, so they have the shape production sees.
/// </summary>
public class FirebaseFailuresTests
{
    [Fact]
    public void A_400_whose_message_is_INVALID_EMAIL_is_an_invalid_address()
    {
        Assert.True(FirebaseFailures.IsInvalidEmail(FirebaseTestExceptions.InvalidEmail()));
    }

    [Fact]
    public void The_same_refusal_with_extra_words_after_the_code_still_is()
    {
        var withDetail = FirebaseTestExceptions.FromBackendResponse(
            System.Net.HttpStatusCode.BadRequest, "{\"error\":{\"code\":400,\"message\":\"INVALID_EMAIL : Invalid email address\",\"status\":\"INVALID_ARGUMENT\"}}");

        Assert.True(FirebaseFailures.IsInvalidEmail(withDetail));
    }

    [Fact]
    public void Another_400_is_not_an_invalid_address()
    {
        Assert.False(FirebaseFailures.IsInvalidEmail(FirebaseTestExceptions.WeakPassword()));
    }

    [Fact]
    public void A_refusal_of_the_service_account_is_not_an_invalid_address()
    {
        Assert.False(FirebaseFailures.IsInvalidEmail(FirebaseTestExceptions.PermissionDenied()));
    }

    [Fact]
    public void An_account_that_already_exists_is_not_an_invalid_address()
    {
        Assert.False(FirebaseFailures.IsInvalidEmail(FirebaseTestExceptions.EmailAlreadyExists()));
    }

    [Fact]
    public void A_failure_that_is_not_Firebases_is_not_an_invalid_address_even_if_it_says_so()
    {
        Assert.False(FirebaseFailures.IsInvalidEmail(new InvalidOperationException("INVALID_EMAIL")));
        Assert.False(FirebaseFailures.IsInvalidEmail(new ArgumentException("INVALID_EMAIL")));
    }
}
